import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyGitleaksIgnore } from './check-gitleaks-ignore.js';

const temporary: string[] = [];

afterEach(() => temporary.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })));

function scanFixture(path: string) {
  const root = mkdtempSync(join(tmpdir(), 'bonklm-gitleaks-config-'));
  temporary.push(root);
  const file = join(root, path);
  mkdirSync(resolve(file, '..'), { recursive: true });
  const alphabet = '0a1B2c3D4e5F6g7H8i9J';
  const synthetic = `${['github', 'pat'].join('_')}_${alphabet.repeat(5).slice(0, 82)}`;
  writeFileSync(file, `const token = '${synthetic}';\n`);
  try {
    execFileSync(
      'gitleaks',
      ['detect', '--no-git', '--source', root, '--config', resolve('.gitleaks.toml'), '--redact', '--exit-code', '3'],
      { stdio: 'pipe' }
    );
    return 0;
  } catch (error) {
    return (error as { status?: number }).status;
  }
}

describe('gitleaks allowlist scope', () => {
  it('binds every global fingerprint to the reviewed source-line bytes', () => {
    expect(verifyGitleaksIgnore(resolve('.'))).toEqual([]);
  });

  it.each(['packages/core/tests/new-fixture.ts', 'docs/new-guide.md', 'packages/examples/new-example.ts'])(
    'still detects a newly introduced credential under %s',
    path => expect(scanFixture(path)).toBe(3)
  );
});
