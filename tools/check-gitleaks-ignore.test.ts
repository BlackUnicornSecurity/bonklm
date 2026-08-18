import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runGitleaksIgnoreCheck, verifyGitleaksIgnore } from './check-gitleaks-ignore.js';

const temporary: string[] = [];

afterEach(() => temporary.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })));

function fixture(line: string) {
  const root = mkdtempSync(join(tmpdir(), 'bonklm-gitleaks-ignore-'));
  temporary.push(root);
  mkdirSync(join(root, 'fixtures'));
  writeFileSync(join(root, 'fixtures', 'token.test.ts'), `${line}\n`);
  const hash = createHash('sha256').update(line).digest('hex');
  writeFileSync(join(root, '.gitleaksignore'), `# line-sha256:${hash}\nfixtures/token.test.ts:generic-api-key:1\n`);
  return root;
}

describe('gitleaks ignore integrity', () => {
  it('accepts a fingerprint only while the reviewed source line is byte-identical', () => {
    const root = fixture('const synthetic = "fixture-value";');
    expect(verifyGitleaksIgnore(root)).toEqual([]);
  });

  it('rejects a different value placed at an ignored file/rule/line', () => {
    const root = fixture('const synthetic = "fixture-value";');
    writeFileSync(join(root, 'fixtures', 'token.test.ts'), 'const synthetic = "changed-value";\n');

    expect(verifyGitleaksIgnore(root)).toEqual(['source line changed: fixtures/token.test.ts:generic-api-key:1']);
  });

  it.each([
    ['missing line hash', 'fixtures/token.test.ts:generic-api-key:1\n', 'unverified ignore entry'],
    ['orphaned line hash', `# line-sha256:${'a'.repeat(64)}\n`, 'orphaned line hash'],
    ['absolute path', `# line-sha256:${'a'.repeat(64)}\n/tmp/token.test.ts:generic-api-key:1\n`, 'source line changed'],
    ['traversal path', `# line-sha256:${'a'.repeat(64)}\n../token.test.ts:generic-api-key:1\n`, 'source line changed']
  ])('rejects an unsafe %s entry', (_label, ignore, expected) => {
    const root = fixture('const synthetic = "fixture-value";');
    writeFileSync(join(root, '.gitleaksignore'), ignore);
    expect(verifyGitleaksIgnore(root).join('\n')).toContain(expected);
  });

  it('reports CLI success and failure without exposing source-line contents', () => {
    const success = fixture('const synthetic = "fixture-value";');
    const failure = fixture('const synthetic = "fixture-value";');
    writeFileSync(join(failure, 'fixtures', 'token.test.ts'), 'const synthetic = "changed-value";\n');
    const output = { error: vi.fn(), log: vi.fn() };

    expect(runGitleaksIgnoreCheck(success, output)).toBe(0);
    expect(runGitleaksIgnoreCheck(failure, output)).toBe(1);
    expect(output.log).toHaveBeenCalledWith('Gitleaks ignore integrity: PASS');
    expect(output.error).toHaveBeenCalledWith(expect.stringContaining('source line changed'));
  });

  it('uses the console reporter by default', () => {
    const root = fixture('const synthetic = "fixture-value";');
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    expect(runGitleaksIgnoreCheck(root)).toBe(0);
    expect(log).toHaveBeenCalledWith('Gitleaks ignore integrity: PASS');
  });
});
