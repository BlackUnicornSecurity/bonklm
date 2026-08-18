import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporary: string[] = [];

function temporaryDirectory(prefix: string) {
  const path = mkdtempSync(join(tmpdir(), prefix));
  temporary.push(path);
  return path;
}

function suppliedBundle() {
  const workspace = temporaryDirectory('bonklm-supplied-tarball-');
  const content = join(workspace, 'content', 'package', 'dist');
  const tarballs = join(workspace, 'tarballs');
  mkdirSync(content, { recursive: true });
  mkdirSync(tarballs);
  writeFileSync(join(content, 'index.js'), 'export const suppliedArtifactMarker = true;\n');
  writeFileSync(join(workspace, 'content', 'package', 'package.json'), '{"name":"fixture"}\n');
  execFileSync('tar', ['-czf', join(tarballs, 'fixture.tgz'), '-C', join(workspace, 'content'), '.']);
  return { tarballs, workspace };
}

function mockTools(workspace: string) {
  const bin = join(workspace, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'npm'), '#!/bin/sh\nprintf called > "$MOCK_NPM_CALLED"\nexit 99\n');
  writeFileSync(
    join(bin, 'gitleaks'),
    `#!/bin/sh
source_dir=''
report=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    --source) source_dir="$2"; shift 2 ;;
    --report-path) report="$2"; shift 2 ;;
    *) shift ;;
  esac
done
grep -R -q suppliedArtifactMarker "$source_dir" || exit 8
printf '[]\n' > "$report"
printf scanned > "$MOCK_GITLEAKS_CALLED"
`
  );
  chmodSync(join(bin, 'npm'), 0o755);
  chmodSync(join(bin, 'gitleaks'), 0o755);
  return bin;
}

function environment(bin: string, workspace: string, tarballs: string) {
  return {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    BONKLM_TARBALL_DIR: tarballs,
    MOCK_GITLEAKS_CALLED: join(workspace, 'gitleaks-called'),
    MOCK_NPM_CALLED: join(workspace, 'npm-called')
  };
}

afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('exact supplied-tarball secret scanner', () => {
  it('secret-scans supplied bytes without invoking npm pack', () => {
    const { tarballs, workspace } = suppliedBundle();
    const bin = mockTools(workspace);
    const result = spawnSync('bash', ['scripts/scan-tarballs.sh'], {
      cwd: root,
      encoding: 'utf8',
      env: environment(bin, workspace, tarballs)
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('across 1 tarballs');
    expect(existsSync(join(workspace, 'gitleaks-called'))).toBe(true);
    expect(existsSync(join(workspace, 'npm-called'))).toBe(false);
  });

  it('fails closed when the supplied directory is missing or empty', () => {
    const workspace = temporaryDirectory('bonklm-empty-tarball-');
    const bin = mockTools(workspace);
    const missing = join(workspace, 'missing');
    const empty = join(workspace, 'empty');
    mkdirSync(empty);
    for (const tarballs of [missing, empty]) {
      const result = spawnSync('bash', ['scripts/scan-tarballs.sh'], {
        cwd: root,
        encoding: 'utf8',
        env: environment(bin, workspace, tarballs)
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/does not exist|empty|nothing scanned/);
      expect(existsSync(join(workspace, 'npm-called'))).toBe(false);
    }
  });
});
