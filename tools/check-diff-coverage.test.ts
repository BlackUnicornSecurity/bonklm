import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  command,
  createRunner,
  evaluateDiffCoverage,
  isCoveredSource,
  main,
  parseUnifiedDiff,
  runCli
} from './check-diff-coverage.js';

const fileCoverage = {
  path: '/repo/tools/example.js',
  statementMap: {
    '0': { start: { line: 2, column: 0 }, end: { line: 2, column: 10 } },
    '1': { start: { line: 4, column: 0 }, end: { line: 4, column: 10 } }
  },
  s: { '0': 1, '1': 0 },
  branchMap: {
    '0': {
      loc: { start: { line: 3, column: 0 }, end: { line: 5, column: 1 } },
      locations: [
        { start: { line: 3, column: 0 }, end: { line: 3, column: 8 } },
        { start: { line: 4, column: 0 }, end: { line: 4, column: 8 } }
      ]
    }
  },
  b: { '0': [1, 0] }
};

describe('diff coverage parsing', () => {
  it('collects added lines from modified and new files', () => {
    const changed = parseUnifiedDiff(
      [
        'diff --git a/tools/example.js b/tools/example.js',
        '+++ b/tools/example.js',
        '@@ -1,2 +1,3 @@',
        ' unchanged',
        '+covered();',
        '+if (value) {',
        'diff --git a/scripts/new.mjs b/scripts/new.mjs',
        '+++ b/scripts/new.mjs',
        '@@ -0,0 +1,2 @@',
        '+one();',
        '+two();'
      ].join('\n')
    );
    expect([...changed.entries()]).toEqual([
      ['tools/example.js', new Set([2, 3])],
      ['scripts/new.mjs', new Set([1, 2])]
    ]);
  });

  it('ignores deletions, metadata, and deleted files', () => {
    const changed = parseUnifiedDiff(
      [
        'diff --git a/tools/gone.js b/tools/gone.js',
        '+++ /dev/null',
        '@@ -1 +0,0 @@',
        '-gone();',
        'diff --git a/README.md b/README.md',
        '+++ b/README.md',
        '@@ -1 +1 @@',
        '-old',
        '+new'
      ].join('\n')
    );
    expect([...changed.entries()]).toEqual([['README.md', new Set([1])]]);
  });

  it('recognizes production JavaScript and TypeScript but not tests or declarations', () => {
    expect(isCoveredSource('packages/fastify-plugin/src/plugin.ts')).toBe(true);
    expect(isCoveredSource('scripts/license-audit.mjs')).toBe(true);
    expect(isCoveredSource('tools/release-npm.js')).toBe(true);
    expect(isCoveredSource('tools/release-npm.test.ts')).toBe(false);
    expect(isCoveredSource('tools/release-npm-test-helpers.js')).toBe(false);
    expect(isCoveredSource('packages/core/src/index.d.ts')).toBe(false);
    expect(isCoveredSource('packages/bonklm-server/src/types.ts')).toBe(false);
    expect(isCoveredSource('packages/fastify-plugin/src/types.ts')).toBe(false);
    expect(isCoveredSource('docs/architecture.md')).toBe(false);
  });
});

describe('diff coverage evaluation', () => {
  it('requires touched statements and branch arms to execute', () => {
    const failures = evaluateDiffCoverage({
      coverage: { '/repo/tools/example.js': fileCoverage },
      changed: new Map([['tools/example.js', new Set([2, 3, 4])]]),
      root: '/repo'
    });
    expect(failures).toEqual([
      'tools/example.js:4 changed statement is not covered',
      'tools/example.js:4 changed branch arm 2 is not covered'
    ]);
  });

  it('checks only the touched arm when the branch condition is unchanged', () => {
    expect(
      evaluateDiffCoverage({
        coverage: { '/repo/tools/example.js': fileCoverage },
        changed: new Map([['tools/example.js', new Set([4])]]),
        root: '/repo'
      })
    ).toEqual([
      'tools/example.js:4 changed statement is not covered',
      'tools/example.js:4 changed branch arm 2 is not covered'
    ]);
  });

  it('checks every arm when a later line of a multiline condition changes', () => {
    const multiline = {
      path: '/repo/tools/example.js',
      statementMap: {},
      s: {},
      branchMap: {
        '0': {
          loc: { start: { line: 3, column: 0 }, end: { line: 4, column: 20 } },
          locations: [
            { start: { line: 6, column: 0 }, end: { line: 6, column: 8 } },
            { start: { line: 7, column: 0 }, end: { line: 7, column: 8 } }
          ]
        }
      },
      b: { '0': [1, 0] }
    };

    expect(
      evaluateDiffCoverage({
        coverage: { '/repo/tools/example.js': multiline },
        changed: new Map([['tools/example.js', new Set([4])]]),
        root: '/repo'
      })
    ).toEqual(['tools/example.js:7 changed branch arm 2 is not covered']);
  });

  it('falls back to the condition line when Istanbul omits an arm line', () => {
    const missingArmLine = {
      path: '/repo/tools/example.js',
      statementMap: {},
      s: {},
      branchMap: {
        '0': {
          loc: { start: { line: 3, column: 0 }, end: { line: 3, column: 20 } },
          locations: [
            { start: { line: 3, column: 0 }, end: { line: 3, column: 8 } },
            { start: { line: undefined, column: 0 }, end: { line: undefined, column: 8 } }
          ]
        }
      },
      b: { '0': [1, 0] }
    };

    expect(
      evaluateDiffCoverage({
        coverage: { '/repo/tools/example.js': missingArmLine },
        changed: new Map([['tools/example.js', new Set([3])]]),
        root: '/repo'
      })
    ).toEqual(['tools/example.js:3 changed branch arm 2 is not covered']);
  });

  it('fails closed when a changed production file is absent from coverage', () => {
    expect(
      evaluateDiffCoverage({ coverage: {}, changed: new Map([['scripts/new.mjs', new Set([1])]]), root: '/repo' })
    ).toEqual(['scripts/new.mjs is changed production code but is absent from coverage']);
  });

  it('passes covered changes and ignores non-production files', () => {
    const covered = {
      ...fileCoverage,
      s: { '0': 1, '1': 1 },
      b: { '0': [1, 1] }
    };
    expect(
      evaluateDiffCoverage({
        coverage: { '/repo/tools/example.js': covered },
        changed: new Map([
          ['tools/example.js', new Set([2, 3, 4])],
          ['README.md', new Set([1])]
        ]),
        root: '/repo'
      })
    ).toEqual([]);
  });
});

describe('diff coverage command boundary', () => {
  it('accepts a first public-genesis root after repository coverage passes', () => {
    const root = mkdtempSync(join(tmpdir(), 'bonklm-diff-coverage-'));
    try {
      mkdirSync(join(root, 'coverage'));
      writeFileSync(join(root, 'coverage/coverage-final.json'), JSON.stringify({}));
      const run = vi.fn((_tool: string, args: string[]) => {
        if (args[0] === 'rev-parse') throw Object.assign(new Error('root commit'), { status: 128 });
        throw new Error(`unexpected command: ${args[0]}`);
      });
      const log = vi.fn();

      expect(main({ root, base: '0'.repeat(40), coveragePath: 'coverage/coverage-final.json', run, log })).toBe(true);
      expect(run).toHaveBeenCalledWith('git', ['rev-parse', '--verify', 'HEAD^'], { cwd: root });
      expect(log).toHaveBeenCalledWith(
        'Diff coverage PASS (fresh public genesis; repository coverage thresholds enforced)'
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('compares an unrelated public history against the empty tree', () => {
    const root = mkdtempSync(join(tmpdir(), 'bonklm-diff-coverage-'));
    const base = 'b'.repeat(40);
    try {
      mkdirSync(join(root, 'coverage'));
      writeFileSync(
        join(root, 'coverage/coverage-final.json'),
        JSON.stringify({
          [join(root, 'tools/example.js')]: { ...fileCoverage, s: { '0': 1, '1': 1 }, b: { '0': [1, 1] } }
        })
      );
      const run = vi.fn((_tool: string, args: string[]) => {
        if (args[0] === 'merge-base') {
          throw Object.assign(new Error('no merge base'), { status: 1 });
        }
        if (args.includes(`${base}...HEAD`)) {
          throw Object.assign(new Error('bad revision range'), { status: 128 });
        }
        return [
          'diff --git a/tools/example.js b/tools/example.js',
          '+++ b/tools/example.js',
          '@@ -0,0 +2 @@',
          '+covered();'
        ].join('\n');
      });

      expect(main({ root, base, coveragePath: 'coverage/coverage-final.json', run, log: vi.fn() })).toBe(true);
      expect(run).toHaveBeenCalledWith('git', ['merge-base', base, 'HEAD'], { cwd: root });
      expect(run).toHaveBeenCalledWith(
        'git',
        ['diff', '--unified=0', '--no-color', '4b825dc642cb6eb9a060e54bf8d69288fbee4904', 'HEAD', '--'],
        { cwd: root }
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('compares against the empty tree when the previous public commit is absent', () => {
    const root = mkdtempSync(join(tmpdir(), 'bonklm-diff-coverage-'));
    const base = 'c'.repeat(40);
    try {
      mkdirSync(join(root, 'coverage'));
      writeFileSync(join(root, 'coverage/coverage-final.json'), JSON.stringify({}));
      const run = vi.fn((_tool: string, args: string[]) => {
        if (args[0] === 'cat-file') throw Object.assign(new Error('missing object'), { status: 128 });
        if (args[0] === 'rev-parse') throw Object.assign(new Error('root commit'), { status: 128 });
        throw new Error(`unexpected command: ${args[0]}`);
      });
      const log = vi.fn();

      expect(main({ root, base, coveragePath: 'coverage/coverage-final.json', run, log })).toBe(true);
      expect(run).toHaveBeenCalledWith('git', ['cat-file', '-e', `${base}^{commit}`], { cwd: root });
      expect(run).toHaveBeenCalledWith('git', ['rev-parse', '--verify', 'HEAD^'], { cwd: root });
      expect(log).toHaveBeenCalledWith(
        'Diff coverage PASS (fresh public genesis; repository coverage thresholds enforced)'
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([
    ['cat-file', 2],
    ['merge-base', 128]
  ])('propagates unexpected %s failures', (failingCommand, status) => {
    const root = mkdtempSync(join(tmpdir(), 'bonklm-diff-coverage-'));
    try {
      mkdirSync(join(root, 'coverage'));
      writeFileSync(join(root, 'coverage/coverage-final.json'), JSON.stringify({}));
      const run = vi.fn((_tool: string, args: string[]) => {
        if (args[0] === failingCommand) throw Object.assign(new Error(`${failingCommand} failed`), { status });
        return '';
      });

      expect(() =>
        main({ root, base: 'd'.repeat(40), coveragePath: 'coverage/coverage-final.json', run, log: vi.fn() })
      ).toThrow(`${failingCommand} failed`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('propagates unexpected root-commit inspection failures', () => {
    const root = mkdtempSync(join(tmpdir(), 'bonklm-diff-coverage-'));
    try {
      mkdirSync(join(root, 'coverage'));
      writeFileSync(join(root, 'coverage/coverage-final.json'), JSON.stringify({}));
      const run = vi.fn((_tool: string, args: string[]) => {
        if (args[0] === 'cat-file') throw Object.assign(new Error('missing object'), { status: 128 });
        throw Object.assign(new Error('root inspection failed'), { status: 2 });
      });

      expect(() =>
        main({ root, base: 'e'.repeat(40), coveragePath: 'coverage/coverage-final.json', run, log: vi.fn() })
      ).toThrow('root inspection failed');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('checks a configured base revision and reports success', () => {
    const root = mkdtempSync(join(tmpdir(), 'bonklm-diff-coverage-'));
    try {
      mkdirSync(join(root, 'coverage'));
      writeFileSync(
        join(root, 'coverage/coverage-final.json'),
        JSON.stringify({
          [join(root, 'tools/example.js')]: { ...fileCoverage, s: { '0': 1, '1': 1 }, b: { '0': [1, 1] } }
        })
      );
      const run = vi.fn(() =>
        [
          'diff --git a/tools/example.js b/tools/example.js',
          '+++ b/tools/example.js',
          '@@ -1 +2 @@',
          '+covered();'
        ].join('\n')
      );
      const log = vi.fn();
      expect(main({ root, base: 'base-sha', coveragePath: 'coverage/coverage-final.json', run, log })).toBe(true);
      expect(createRunner({ root, base: 'base-sha', coveragePath: 'coverage/coverage-final.json', run, log })()).toBe(
        true
      );
      expect(run).toHaveBeenCalledWith('git', ['diff', '--unified=0', '--no-color', 'base-sha...HEAD', '--'], {
        cwd: root
      });
      expect(log).toHaveBeenCalledWith('Diff coverage PASS (1 changed source files)');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('includes untracked production files and fails on uncovered changes', () => {
    const root = mkdtempSync(join(tmpdir(), 'bonklm-diff-coverage-'));
    try {
      mkdirSync(join(root, 'coverage'));
      mkdirSync(join(root, 'scripts'));
      writeFileSync(join(root, 'scripts/new.mjs'), 'uncovered();\n');
      writeFileSync(
        join(root, 'coverage/coverage-final.json'),
        JSON.stringify({
          [join(root, 'scripts/new.mjs')]: {
            path: join(root, 'scripts/new.mjs'),
            statementMap: { '0': { start: { line: 1 }, end: { line: 1 } } },
            s: { '0': 0 },
            branchMap: {},
            b: {}
          }
        })
      );
      const run = vi.fn((_tool: string, args: string[]) => (args[0] === 'diff' ? '' : 'scripts/new.mjs\n'));
      expect(() =>
        main({ root, base: undefined, coveragePath: 'coverage/coverage-final.json', run, log: vi.fn() })
      ).toThrow(/scripts\/new\.mjs:1/);
      expect(run).toHaveBeenCalledWith('git', ['ls-files', '--others', '--exclude-standard'], { cwd: root });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('runs only at its entrypoint and reports Error and non-Error failures', () => {
    expect(runCli({ argv1: '/other', scriptPath: '/script', run: vi.fn(), exit: vi.fn() })).toBe(false);
    const output = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const exit = vi.fn();
    expect(runCli({ argv1: '/script', scriptPath: '/script', run: () => true, exit })).toBe(true);
    runCli({
      argv1: '/script',
      scriptPath: '/script',
      run: () => {
        throw new Error('boom');
      },
      exit
    });
    runCli({
      argv1: '/script',
      scriptPath: '/script',
      run: () => {
        throw 'plain';
      },
      exit
    });
    expect(exit).toHaveBeenCalledTimes(2);
    expect(command(process.execPath, ['--version'], {})).toMatch(/^v/);
    expect(command(process.execPath, ['-e', "process.stdout.write('x'.repeat(2 * 1024 * 1024))"], {}).length).toBe(
      2 * 1024 * 1024
    );
    output.mockRestore();
  });
});
