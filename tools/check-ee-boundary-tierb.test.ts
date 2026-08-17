import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it, onTestFinished } from 'vitest';
import { checkEeBoundary, formatFailure } from './check-ee-boundary.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const SCRIPT = realpathSync(join(HERE, 'check-ee-boundary.js'));

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'bonklm-ee-tierb-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const packagesDir = join(root, 'packages');
  const toolsDir = join(root, 'tools');
  mkdirSync(join(packagesDir, 'core', 'src'), { recursive: true });
  writeFileSync(join(packagesDir, 'core', 'package.json'), JSON.stringify({ name: '@x/core', license: 'Apache-2.0' }));
  writeFileSync(join(packagesDir, 'core', 'src', 'index.ts'), 'export {};\n');
  mkdirSync(join(toolsDir, 'internal'), { recursive: true });
  writeFileSync(join(toolsDir, 'internal', 'package.json'), JSON.stringify({ name: '@x/internal', private: true }));
  return { packagesDir, root, toolsDir };
}

function writeTool(root: string, name: string, manifest: object, source = 'export {};\n') {
  const dir = join(root, 'tools', name);
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ workspacePolicy: 'tier-b-publishable', ...manifest }));
  writeFileSync(join(dir, 'src', 'index.ts'), source);
}

it('fails closed for nameless, missing, unknown, and non-permissive Tier-B licenses', () => {
  for (const [name, manifest] of [
    ['nameless', { license: 'MIT' }],
    ['missing', { name: '@blackunicorn/missing' }],
    ['unknown', { name: '@blackunicorn/unknown', license: 'Unknown-License' }],
    ['ee', { name: '@blackunicorn/ee-tool', license: 'BUSL-1.1' }]
  ] as const) {
    const { packagesDir, root, toolsDir } = fixture();
    writeTool(root, name, manifest);
    writeFileSync(join(toolsDir, 'README.md'), 'not a package');
    const result = checkEeBoundary({ packagesDir, toolsDir });
    expect(result.ok).toBe(false);
    expect(result.licenseErrors).toContainEqual(expect.objectContaining({ dir: `../tools/${name}` }));
  }
});

it('accepts MIT Tier-B and blocks its declared and imported EE edges', () => {
  const { packagesDir, root, toolsDir } = fixture();
  const eeDir = join(packagesDir, 'bonklm-ee', 'x');
  mkdirSync(eeDir, { recursive: true });
  writeFileSync(join(eeDir, 'package.json'), JSON.stringify({ name: '@x/ee', license: 'BUSL-1.1', private: true }));
  writeTool(
    root,
    'public-tool',
    { name: '@blackunicorn/public-tool', license: 'MIT', dependencies: { '@x/ee': 'workspace:*' } },
    "import '@x/ee';\n"
  );
  const result = checkEeBoundary({ packagesDir, toolsDir });
  expect(result.violations).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ from: '@blackunicorn/public-tool', kind: 'oss-depends-ee' }),
      expect.objectContaining({ from: '@blackunicorn/public-tool', kind: 'oss-imports-ee' })
    ])
  );
  expect(formatFailure(result)).toContain('tools/public-tool/package.json');
});

it('runs the real CLI clean against the repository', () => {
  expect(execFileSync('node', [SCRIPT], { cwd: REPO_ROOT, encoding: 'utf8' })).toMatch(/no OSS→EE boundary violations/);
});

it('fails the real CLI for an OSS import of EE', () => {
  const { packagesDir, root } = fixture();
  const eeDir = join(packagesDir, 'ee');
  mkdirSync(join(eeDir, 'src'), { recursive: true });
  writeFileSync(join(eeDir, 'package.json'), JSON.stringify({ name: '@x/ee', license: 'BUSL-1.1', private: true }));
  writeFileSync(join(eeDir, 'src', 'index.ts'), 'export {};\n');
  writeFileSync(join(packagesDir, 'core', 'src', 'index.ts'), "import '@x/ee';\n");
  const toolsDir = join(root, 'tools');
  mkdirSync(toolsDir, { recursive: true });
  const fixtureScript = join(toolsDir, 'check-ee-boundary.js');
  cpSync(SCRIPT, fixtureScript);
  expect(() => execFileSync('node', [realpathSync(fixtureScript)], { encoding: 'utf8' })).toThrow();
});
