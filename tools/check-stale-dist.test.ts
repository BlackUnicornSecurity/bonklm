/**
 * tools/check-stale-dist.test.ts
 * ===============================
 *
 * Unit + regression suite for the stale-`dist/` guard. Uses real on-disk
 * fixtures under a tmpdir (the gate walks directories, which a path-map vfs
 * cannot represent) plus injected `listFiles` failures and a dangling symlink
 * for the defensive catch branches.
 *
 * Regression intent (biting): the fixture tree reproduces the historical
 * incident class — a renamed `src/wrap-livekit.ts` → `src/wrap-session.ts`
 * whose old `dist/wrap-livekit.*` emit survived — and the gate MUST fail on
 * it. Delete the stale fixture files and the same test tree passes; delete
 * `hasSourceTwin` and every staleness assertion below goes red.
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import {
  checkStaleDist,
  formatFailure,
  hasSourceTwin,
  main,
  runCli,
  sourceCandidates,
  walkFiles
} from './check-stale-dist.js';

let tmpRoot: string | null = null;

/** Create an isolated fixture root; registered for teardown. */
function fixtureRoot(): string {
  tmpRoot = mkdtempSync(join(tmpdir(), 'bonklm-stale-dist-'));
  return tmpRoot;
}

afterEach(() => {
  if (tmpRoot !== null) {
    rmSync(tmpRoot, { recursive: true, force: true });
    tmpRoot = null;
  }
});

/** Write `files` (path → content) under `root`; parent dirs auto-created. */
function writeTree(root: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content);
  }
}

describe('sourceCandidates', () => {
  it('maps plain JS emit to ts/tsx source twins', () => {
    expect(sourceCandidates('index.js')).toEqual(['index.ts', 'index.tsx']);
  });

  it('maps sourcemaps to the same source twins as their emit', () => {
    expect(sourceCandidates('deep/index.js.map')).toEqual(['deep/index.ts', 'deep/index.tsx']);
  });

  it('maps mjs/cjs emit through mts/cts (then ts)', () => {
    expect(sourceCandidates('a.mjs')).toEqual(['a.mts', 'a.ts']);
    expect(sourceCandidates('a.mjs.map')).toEqual(['a.mts', 'a.ts']);
    expect(sourceCandidates('a.cjs')).toEqual(['a.cts', 'a.ts']);
  });

  it('maps declaration emit to its source (incl. copied .d.ts)', () => {
    expect(sourceCandidates('a.d.ts')).toEqual(['a.ts', 'a.tsx', 'a.d.ts']);
    expect(sourceCandidates('a.d.ts.map')).toEqual(['a.ts', 'a.tsx', 'a.d.ts']);
    expect(sourceCandidates('a.d.cts')).toEqual(['a.cts', 'a.ts']);
    expect(sourceCandidates('a.d.mts.map')).toEqual(['a.mts', 'a.ts']);
  });

  it('keeps non-tsc assets name-identical (map suffix stripped)', () => {
    expect(sourceCandidates('schema.json')).toEqual(['schema.json']);
    expect(sourceCandidates('schema.json.map')).toEqual(['schema.json']);
  });
});

describe('hasSourceTwin', () => {
  it('resolves twins through the injected exists() (hit and miss)', () => {
    const present = new Set(['/p/src/index.ts']);
    const exists = (p: string) => present.has(p);
    expect(hasSourceTwin('/p', 'index.js', exists)).toBe(true);
    expect(hasSourceTwin('/p', 'index.d.ts', exists)).toBe(true);
    expect(hasSourceTwin('/p', 'gone.js', exists)).toBe(false);
  });
});

describe('walkFiles', () => {
  it('recursively lists files (sorted), descending into subdirectories', () => {
    const root = fixtureRoot();
    writeTree(root, {
      'dist/b.js': '',
      'dist/a.js': '',
      'dist/nested/deep/c.js': ''
    });
    expect(walkFiles(join(root, 'dist'))).toEqual(['a.js', 'b.js', 'nested/deep/c.js']);
  });

  it('tolerates an unreadable directory (skip, keep walking)', () => {
    const root = fixtureRoot();
    writeTree(root, { 'dist/ok.js': '' });
    const real = (d: string) => {
      if (d.endsWith('bad')) throw new Error('EACCES');
      return readdirSync(d) as string[];
    };
    expect(walkFiles(root, real)).toContain('dist/ok.js');
  });

  it('tolerates a dangling symlink (stat failure is skipped)', () => {
    const root = fixtureRoot();
    writeTree(root, { 'dist/real.js': '' });
    symlinkSync(join(root, 'dist', 'nowhere.js'), join(root, 'dist', 'dangling.js'));
    expect(walkFiles(join(root, 'dist'))).toEqual(['real.js']);
  });
});

describe('checkStaleDist', () => {
  it('passes a clean tsc tree: every emit has a src twin', () => {
    const root = fixtureRoot();
    writeTree(root, {
      'packages/alpha/src/index.ts': 'export {};',
      'packages/alpha/src/nested/util.ts': 'export {};',
      'packages/alpha/dist/index.js': '',
      'packages/alpha/dist/index.js.map': '',
      'packages/alpha/dist/index.d.ts': '',
      'packages/alpha/dist/index.d.ts.map': '',
      'packages/alpha/dist/nested/util.js': ''
    });
    const result = checkStaleDist({ packagesDir: join(root, 'packages') });
    expect(result.ok).toBe(true);
    expect(result.staleCount).toBe(0);
    expect(result.packagesChecked).toBe(1);
    expect(result.distFilesChecked).toBe(5);
    expect(result.packages[0]!.distFiles).toBe(5);
    expect(result.packages[0]!.stale).toEqual([]);
  });

  it('FAILS on the historical class: renamed src file leaves orphaned emit', () => {
    const root = fixtureRoot();
    writeTree(root, {
      // The rename: source moved wrap-livekit.ts -> wrap-session.ts ...
      'packages/livekit/src/index.ts': 'export {};',
      'packages/livekit/src/wrap-session.ts': 'export {};',
      // ... but tsc never cleaned the old emit:
      'packages/livekit/dist/index.js': '',
      'packages/livekit/dist/wrap-livekit.js': '',
      'packages/livekit/dist/wrap-livekit.js.map': '',
      'packages/livekit/dist/wrap-livekit.d.ts': '',
      'packages/livekit/dist/wrap-livekit.d.ts.map': '',
      'packages/livekit/dist/wrap-session.js': ''
    });
    const result = checkStaleDist({ packagesDir: join(root, 'packages') });
    expect(result.ok).toBe(false);
    expect(result.staleCount).toBe(4);
    const staleFiles = result.packages[0]!.stale.map(s => s.file);
    expect(staleFiles).toEqual([
      'wrap-livekit.d.ts',
      'wrap-livekit.d.ts.map',
      'wrap-livekit.js',
      'wrap-livekit.js.map'
    ]);
    expect(result.packages[0]!.stale[0]!.expected).toEqual([
      'wrap-livekit.ts',
      'wrap-livekit.tsx',
      'wrap-livekit.d.ts'
    ]);
  });

  it('skips packages without dist/ and ignores non-directory entries', () => {
    const root = fixtureRoot();
    writeTree(root, {
      'packages/beta/src/index.ts': 'export {};',
      'packages/README.md': 'not a package directory'
    });
    const result = checkStaleDist({ packagesDir: join(root, 'packages') });
    expect(result.ok).toBe(true);
    expect(result.skipped).toEqual(['beta']);
    expect(result.packagesChecked).toBe(0);
    expect(result.packages).toEqual([]);
  });

  it('handles a missing packages/ root as vacuously clean', () => {
    const root = fixtureRoot();
    const result = checkStaleDist({ packagesDir: join(root, 'nope') });
    expect(result.ok).toBe(true);
    expect(result.packages).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  it('accepts a src .d.ts twin for copied declaration files', () => {
    const root = fixtureRoot();
    writeTree(root, {
      'packages/gamma/src/global.d.ts': 'declare global {};',
      'packages/gamma/dist/global.d.ts': ''
    });
    const result = checkStaleDist({ packagesDir: join(root, 'packages') });
    expect(result.ok).toBe(true);
  });
});

describe('formatFailure', () => {
  it('renders package, file, expected twins, and the clean-rebuild fix', () => {
    const root = fixtureRoot();
    writeTree(root, {
      'packages/alpha/src/index.ts': 'export {};',
      'packages/alpha/dist/index.js': '',
      'packages/alpha/dist/orphan.js': ''
    });
    const result = checkStaleDist({ packagesDir: join(root, 'packages') });
    const text = formatFailure(result);
    expect(text).toContain('Stale-dist check failed.');
    expect(text).toContain('alpha/dist/orphan.js');
    expect(text).toContain('orphan.ts');
    expect(text).toContain('rm -rf packages/<pkg>/dist');
    expect(text).toContain('do not');
  });
});

describe('main', () => {
  it('logs success and does not exit when the tree is clean', () => {
    const root = fixtureRoot();
    writeTree(root, {
      'packages/alpha/src/index.ts': 'export {};',
      'packages/alpha/dist/index.js': ''
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    onTestFinished(() => vi.restoreAllMocks());

    main({ packagesDir: join(root, 'packages') });

    expect(log).toHaveBeenCalledWith(expect.stringMatching(/check-stale-dist: 1 package\(s\) checked/));
    expect(exit).not.toHaveBeenCalled();
  });

  it('prints the failure report and exits 1 on stale emit', () => {
    const root = fixtureRoot();
    writeTree(root, {
      'packages/alpha/src/index.ts': 'export {};',
      'packages/alpha/dist/orphan.js': ''
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    onTestFinished(() => vi.restoreAllMocks());

    main({ packagesDir: join(root, 'packages') });

    expect(error).toHaveBeenCalledWith(expect.stringMatching(/Stale-dist check failed/));
    expect(exit).toHaveBeenCalledWith(1);
  });
});

describe('runCli', () => {
  it('returns false (no-op) when argv1 is not this script', () => {
    expect(runCli({ argv1: '/some/other/file.js', scriptUrl: 'file:///x/script.js' })).toBe(false);
  });

  it('runs and returns true when argv1 matches the script path', () => {
    const run = vi.fn();
    const ran = runCli({ argv1: '/x/script.js', scriptUrl: 'file:///x/script.js', run, exit: vi.fn() });
    expect(ran).toBe(true);
    expect(run).toHaveBeenCalledOnce();
  });

  it('catches an Error thrown by run and exits 1', () => {
    const exit = vi.fn();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    onTestFinished(() => vi.restoreAllMocks());
    runCli({
      argv1: '/x/script.js',
      scriptUrl: 'file:///x/script.js',
      run: () => {
        throw new Error('boom');
      },
      exit
    });
    expect(exit).toHaveBeenCalledWith(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('boom'));
  });

  it('stringifies a non-Error thrown value', () => {
    const exit = vi.fn();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    onTestFinished(() => vi.restoreAllMocks());
    runCli({
      argv1: '/x/script.js',
      scriptUrl: 'file:///x/script.js',
      run: () => {
        throw 'plain-string-failure';
      },
      exit
    });
    expect(exit).toHaveBeenCalledWith(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('plain-string-failure'));
  });
});
