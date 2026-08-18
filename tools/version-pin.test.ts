import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { describe, expect, it, onTestFinished } from 'vitest';

const sourceScript = fileURLToPath(new URL('../scripts/check-version-pin.sh', import.meta.url));
const sourceSemver = fileURLToPath(new URL('./semver.js', import.meta.url));

function fixture(rootVersion: string, packageVersion: string) {
  const root = mkdtempSync(join(tmpdir(), 'bonklm-version-pin-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'scripts'));
  mkdirSync(join(root, 'tools'));
  mkdirSync(join(root, 'packages', 'core'), { recursive: true });
  mkdirSync(join(root, 'packages', 'private-tool'), { recursive: true });
  mkdirSync(join(root, 'docs', 'user'), { recursive: true });
  copyFileSync(sourceScript, join(root, 'scripts', 'check-version-pin.sh'));
  copyFileSync(sourceSemver, join(root, 'tools', 'semver.js'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ type: 'module', version: rootVersion }));
  writeFileSync(join(root, 'packages', 'core', 'package.json'), JSON.stringify({ version: packageVersion }));
  writeFileSync(
    join(root, 'packages', 'private-tool', 'package.json'),
    JSON.stringify({ name: '@x/private-tool', version: '9.9.9', private: true })
  );
  writeFileSync(join(root, 'RELEASE-NOTES.md'), `Latest in-tree family version:** \`${rootVersion}\``);
  writeFileSync(join(root, 'CHANGELOG.md'), `historical 0.2.0\n## [${rootVersion}]`);
  writeFileSync(join(root, 'docs', 'architecture.md'), `historical 0.2.0\nProject version: \`${rootVersion}\``);
  writeFileSync(join(root, 'docs', 'user', 'package-matrix.md'), `v${rootVersion} package surface`);
  writeFileSync(join(root, 'docs', 'user', 'public-api-surface.md'), `(v${rootVersion} freeze)`);
  writeFileSync(join(root, 'docs', 'user', 'known-limitations.md'), `(v${rootVersion})`);
  writeFileSync(join(root, 'docs', 'user', 'threat-surfaces.md'), `current release v${rootVersion}`);
  return root;
}

function runVersionPin(root: string, expected?: string) {
  const args = [join(root, 'scripts', 'check-version-pin.sh')];
  if (expected) args.push('--expected', expected);
  return execFileSync('bash', args, { cwd: root, encoding: 'utf8' });
}

function runVersionPinArgs(root: string, args: string[]) {
  return execFileSync('bash', [join(root, 'scripts', 'check-version-pin.sh'), ...args], {
    cwd: root,
    encoding: 'utf8'
  });
}

describe('check-version-pin', () => {
  it('accepts an aligned root and public family while ignoring private package versions', () => {
    expect(runVersionPin(fixture('1.0.1', '1.0.1'), '1.0.1')).toContain('PASS');
  });

  it('rejects root metadata that drifts from the package family', () => {
    expect(() => runVersionPin(fixture('1.0.0', '1.0.1'))).toThrow(/version drift detected/);
  });

  it('rejects stale current-version documentation without mistaking historical versions for the marker', () => {
    const root = fixture('1.0.1', '1.0.1');
    writeFileSync(join(root, 'docs', 'user', 'package-matrix.md'), 'historical v1.0.1 note\nv1.0.0 package surface');
    expect(() => runVersionPin(root, '1.0.1')).toThrow(/current-version marker is stale/);
  });

  it.each([
    ['unknown arguments', ['--unknown']],
    ['extra arguments', ['--expected', '1.0.1', 'trailing']],
    ['a missing expected version', ['--expected']]
  ])('rejects %s', (_label, args) => {
    expect(() => runVersionPinArgs(fixture('1.0.1', '1.0.1'), args)).toThrow(/usage/i);
  });

  it.each(['01.0.0', '1.0.0-rc.01', 'latest'])('rejects invalid SemVer %s', version => {
    expect(() => runVersionPin(fixture(version, version), version)).toThrow(/semver/i);
  });

  it('rejects an explicitly empty expected version', () => {
    expect(() => runVersionPinArgs(fixture('1.0.1', '1.0.1'), ['--expected', ''])).toThrow(/semver/i);
  });
});
