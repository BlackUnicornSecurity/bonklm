/**
 * tools/check-edge-node-builtins.test.ts
 * ======================================
 *
 * Unit + integration coverage for the edge-bundle `node:*` allowlist gate
 * (`tools/check-edge-node-builtins.js`). The gate statically walks the import
 * graph of `packages/core/src/edge/index.ts` and asserts the set of `node:*`
 * built-ins it reaches EQUALS the canonical allowlist (mirrored by the
 * architecture.md §6 marker block). These tests prove the green-today path
 * (set = {node:async_hooks, node:crypto, node:fs, node:path}) AND that the gate
 * fires when a forbidden built-in (e.g. `node:vm`) is dragged into the edge graph.
 */
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import {
  ARCH_DOC,
  DOC_ALLOWLIST_END,
  DOC_ALLOWLIST_START,
  EDGE_ENTRY,
  EDGE_NODE_BUILTIN_ALLOWLIST,
  checkEdgeNodeBuiltins,
  formatFailure,
  main,
  parseDocAllowlist,
  resolveSourceImport,
  runCli,
  setDiff,
  sourceCandidates,
  walkEdgeGraph
} from './check-edge-node-builtins.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
// realpath so the script's `import.meta.url` matches the argv[1] passed when it
// is spawned as a child process (macOS /var -> /private/var symlink).
const SCRIPT = realpathSync(join(HERE, 'check-edge-node-builtins.js'));
const EE_SCRIPT = realpathSync(join(HERE, 'check-ee-boundary.js'));

/** A well-formed §6 allowlist doc block listing the given `node:*` tokens. */
function docWith(tokens: string[]): string {
  return `## 6. Edge\n\nprose mentions node:vm elsewhere.\n${DOC_ALLOWLIST_START}\n${tokens
    .map(t => `\`${t}\``)
    .join(', ')}\n${DOC_ALLOWLIST_END}\nmore prose.\n`;
}

/**
 * In-memory file system over a `{ absPath: text }` map. `readFile` throws for an
 * absent path (so an unmapped doc path exercises the doc-unreadable seam);
 * `exists` is membership.
 */
function vfs(map: Record<string, string>) {
  return {
    readFile: (p: string): string => {
      if (!(p in map)) throw new Error(`ENOENT: ${p}`);
      return map[p];
    },
    exists: (p: string): boolean => p in map
  };
}

const DEFAULT_DOC = docWith([...EDGE_NODE_BUILTIN_ALLOWLIST]);

const REAL_EDGE_BUILTINS = ['node:async_hooks', 'node:crypto', 'node:fs', 'node:path'];

describe('EDGE_NODE_BUILTIN_ALLOWLIST', () => {
  it('is the Node built-ins the edge surface is documented to use', () => {
    expect([...EDGE_NODE_BUILTIN_ALLOWLIST].sort()).toEqual(REAL_EDGE_BUILTINS);
  });
});

describe('sourceCandidates', () => {
  it('maps a .js-family specifier to its TS sibling first', () => {
    const cands = sourceCandidates('/a/b.js');
    expect(cands[0]).toBe('/a/b.ts');
    expect(cands).toContain('/a/b.tsx');
    expect(new Set(cands).size).toBe(cands.length); // de-duplicated
  });
  it('keeps an exact source-ext path as a candidate', () => {
    expect(sourceCandidates('/a/b.ts')).toContain('/a/b.ts');
  });
  it('handles an extensionless (directory) base with index resolution', () => {
    const cands = sourceCandidates('/a/dir');
    expect(cands).toContain('/a/dir.ts');
    expect(cands).toContain(resolve('/a/dir', 'index.ts'));
  });
});

describe('resolveSourceImport', () => {
  it('resolves a relative .js specifier to the existing .ts source', () => {
    const { exists } = vfs({ '/v/pkg/foo.ts': '' });
    expect(resolveSourceImport('./foo.js', '/v/pkg/entry.ts', exists)).toBe('/v/pkg/foo.ts');
  });
  it('returns null when no candidate exists', () => {
    expect(resolveSourceImport('./nope.js', '/v/pkg/entry.ts', () => false)).toBeNull();
  });
  it('uses existsSync by default (real repo: edge entry resolves als-canary)', () => {
    expect(resolveSourceImport('./als-canary.js', EDGE_ENTRY)).toBe(resolve(dirname(EDGE_ENTRY), 'als-canary.ts'));
  });
});

describe('parseDocAllowlist', () => {
  it('extracts the node:* tokens between the markers, ignoring node:vm prose outside', () => {
    const set = parseDocAllowlist(DEFAULT_DOC);
    expect([...(set ?? [])].sort()).toEqual(REAL_EDGE_BUILTINS);
  });
  it('returns null when the start marker is absent', () => {
    expect(parseDocAllowlist(`text ${DOC_ALLOWLIST_END}`)).toBeNull();
  });
  it('returns null when the end marker is absent', () => {
    expect(parseDocAllowlist(`text ${DOC_ALLOWLIST_START} node:fs`)).toBeNull();
  });
  it('returns null when the markers are out of order', () => {
    expect(parseDocAllowlist(`${DOC_ALLOWLIST_END} ... ${DOC_ALLOWLIST_START}`)).toBeNull();
  });
  it('returns an empty set when the marker region names no node:* tokens', () => {
    expect([...(parseDocAllowlist(`${DOC_ALLOWLIST_START}\n(none)\n${DOC_ALLOWLIST_END}`) ?? [])]).toEqual([]);
  });
});

describe('setDiff', () => {
  it('returns sorted members of a not in b', () => {
    expect(setDiff(new Set(['c', 'a', 'b']), new Set(['b']))).toEqual(['a', 'c']);
  });
});

describe('walkEdgeGraph', () => {
  it('collects node:* built-ins, follows relative imports, and de-duplicates a cycle', () => {
    const map = {
      '/v/entry.ts': "import 'node:fs';\nimport { a } from './a.js';",
      // a <-> b form a cycle; b also pulls a node builtin
      '/v/a.ts': "import './b.js';\nimport 'node:path';",
      '/v/b.ts': "import './a.js';"
    };
    const { readFile, exists } = vfs(map);
    const out = walkEdgeGraph({ entry: '/v/entry.ts', readFile, exists });
    expect([...out.nodeBuiltins].sort()).toEqual(['node:fs', 'node:path']);
    expect(out.files.sort()).toEqual(['/v/a.ts', '/v/b.ts', '/v/entry.ts']);
    expect(out.blindSpots).toEqual([]);
  });

  it('flags a bare/workspace import as an opaque blind spot', () => {
    const { readFile, exists } = vfs({ '/v/entry.ts': "import { x } from '@blackunicorn/bonklm-logger';" });
    const out = walkEdgeGraph({ entry: '/v/entry.ts', readFile, exists });
    expect(out.blindSpots).toEqual([
      { spec: '@blackunicorn/bonklm-logger', from: '/v/entry.ts', reason: 'opaque-bare-import' }
    ]);
  });

  it('flags an unresolved relative specifier', () => {
    const { readFile, exists } = vfs({ '/v/entry.ts': "import './gone.js';" });
    const out = walkEdgeGraph({ entry: '/v/entry.ts', readFile, exists });
    expect(out.blindSpots).toEqual([{ spec: './gone.js', from: '/v/entry.ts', reason: 'unresolved-relative' }]);
  });

  it('follows a dynamic-literal import and flags a non-literal one', () => {
    const map = {
      '/v/entry.ts': "const m = await import('./lazy.js');\nconst d = await import(name);",
      '/v/lazy.ts': "import 'node:crypto';"
    };
    const { readFile, exists } = vfs(map);
    const out = walkEdgeGraph({ entry: '/v/entry.ts', readFile, exists });
    expect([...out.nodeBuiltins]).toEqual(['node:crypto']);
    expect(out.blindSpots).toEqual([{ spec: 'name', from: '/v/entry.ts', reason: 'dynamic-nonliteral' }]);
  });

  it('records an unreadable file as a blind spot (from: null)', () => {
    const out = walkEdgeGraph({
      entry: '/v/entry.ts',
      readFile: () => {
        throw new Error('EACCES');
      },
      exists: () => false
    });
    expect(out.blindSpots).toEqual([{ spec: '/v/entry.ts', from: null, reason: 'unreadable-file' }]);
    expect(out.nodeBuiltins.size).toBe(0);
  });

  it('uses readFileSync/existsSync by default against the real edge entry', () => {
    const out = walkEdgeGraph({ entry: EDGE_ENTRY });
    expect([...out.nodeBuiltins].sort()).toEqual(REAL_EDGE_BUILTINS);
    expect(out.blindSpots).toEqual([]);
    expect(out.files.length).toBeGreaterThan(1);
  });
});

describe('checkEdgeNodeBuiltins', () => {
  it('is ok against the real repo: edge graph node:* set equals the allowlist and the doc', () => {
    const result = checkEdgeNodeBuiltins();
    expect(result.found).toEqual(REAL_EDGE_BUILTINS);
    expect(result.extra).toEqual([]);
    expect(result.missing).toEqual([]);
    expect(result.blindSpots).toEqual([]);
    expect(result.docError).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.fileCount).toBeGreaterThan(1);
  });

  it('FAILS when a forbidden built-in (node:vm) is dragged into the edge graph', () => {
    const map = {
      // The legit edge set (async_hooks/crypto/fs/path) is intact; a new factory
      // ALSO drags in node:vm (e.g. re-exporting HookSandbox) — exactly the
      // regression the gate must catch.
      '/v/edge/index.ts':
        "import 'node:async_hooks';\nimport 'node:crypto';\nimport 'node:fs';\nimport 'node:path';\nexport { x } from './sandbox.js';",
      '/v/edge/sandbox.ts': "import vm from 'node:vm';\nexport const x = vm;",
      '/v/docs.md': DEFAULT_DOC
    };
    const { readFile, exists } = vfs(map);
    const result = checkEdgeNodeBuiltins({ entry: '/v/edge/index.ts', docFile: '/v/docs.md', readFile, exists });
    expect(result.ok).toBe(false);
    expect(result.extra).toEqual(['node:vm']);
    expect(result.missing).toEqual([]);
  });

  it('FAILS (missing) when an allowlisted built-in is no longer reachable', () => {
    const map = { '/v/edge/index.ts': "import 'node:fs';", '/v/docs.md': DEFAULT_DOC };
    const { readFile, exists } = vfs(map);
    const result = checkEdgeNodeBuiltins({ entry: '/v/edge/index.ts', docFile: '/v/docs.md', readFile, exists });
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(['node:async_hooks', 'node:crypto', 'node:path']);
    expect(result.extra).toEqual([]);
  });

  it('FAILS on a blind-spot edge even when the node:* set matches', () => {
    const map = {
      '/v/edge/index.ts':
        "import 'node:async_hooks';\nimport 'node:crypto';\nimport 'node:fs';\nimport 'node:path';\nimport 'some-bare-pkg';",
      '/v/docs.md': DEFAULT_DOC
    };
    const { readFile, exists } = vfs(map);
    const result = checkEdgeNodeBuiltins({ entry: '/v/edge/index.ts', docFile: '/v/docs.md', readFile, exists });
    expect(result.ok).toBe(false);
    expect(result.blindSpots[0]).toMatchObject({ spec: 'some-bare-pkg', reason: 'opaque-bare-import' });
  });

  it('FAILS when the doc is unreadable', () => {
    const map = {
      '/v/edge/index.ts': "import 'node:async_hooks';\nimport 'node:fs';\nimport 'node:path';\nimport 'node:crypto';"
    };
    const { readFile, exists } = vfs(map); // '/v/docs.md' intentionally absent
    const result = checkEdgeNodeBuiltins({ entry: '/v/edge/index.ts', docFile: '/v/docs.md', readFile, exists });
    expect(result.ok).toBe(false);
    expect(result.docError).toBe('unreadable');
    expect(result.docAllowlist).toBeNull();
  });

  it('FAILS when the doc markers are missing', () => {
    const map = {
      '/v/edge/index.ts': "import 'node:async_hooks';\nimport 'node:fs';\nimport 'node:path';\nimport 'node:crypto';",
      '/v/docs.md': '## 6. Edge\n\nno markers here.\n'
    };
    const { readFile, exists } = vfs(map);
    const result = checkEdgeNodeBuiltins({ entry: '/v/edge/index.ts', docFile: '/v/docs.md', readFile, exists });
    expect(result.ok).toBe(false);
    expect(result.docError).toBe('markers-missing');
  });

  it('FAILS when the doc block disagrees with the const (extra + missing)', () => {
    const map = {
      '/v/edge/index.ts': "import 'node:async_hooks';\nimport 'node:fs';\nimport 'node:path';\nimport 'node:crypto';",
      // doc omits node:async_hooks + node:path and adds an un-allowlisted node:os
      '/v/docs.md': docWith(['node:crypto', 'node:fs', 'node:os'])
    };
    const { readFile, exists } = vfs(map);
    const result = checkEdgeNodeBuiltins({ entry: '/v/edge/index.ts', docFile: '/v/docs.md', readFile, exists });
    expect(result.ok).toBe(false);
    expect(result.docExtra).toEqual(['node:os']);
    expect(result.docMissing).toEqual(['node:async_hooks', 'node:path']);
  });

  it('honours an injected allowlist', () => {
    const map = { '/v/edge/index.ts': "import 'node:os';", '/v/docs.md': docWith(['node:os']) };
    const { readFile, exists } = vfs(map);
    const result = checkEdgeNodeBuiltins({
      entry: '/v/edge/index.ts',
      docFile: '/v/docs.md',
      readFile,
      exists,
      allowlist: new Set(['node:os'])
    });
    expect(result.ok).toBe(true);
  });
});

describe('formatFailure', () => {
  const base = { found: [], allowlist: [], fileCount: 7, docPath: ARCH_DOC, docError: null, docAllowlist: null };

  it('renders forbidden, stale, and blind-spot sections with repo-relative paths', () => {
    const report = formatFailure({
      ...base,
      extra: ['node:async_hooks'],
      missing: ['node:crypto'],
      blindSpots: [
        { spec: '@x/pkg', from: join(REPO_ROOT, 'packages/core/src/edge/index.ts'), reason: 'opaque-bare-import' },
        { spec: '/abs/unreadable.ts', from: null, reason: 'unreadable-file' }
      ],
      docExtra: [],
      docMissing: []
    });
    expect(report).toMatch(/FORBIDDEN built-ins/);
    expect(report).toContain('+ node:async_hooks');
    expect(report).toMatch(/STALE allowlist entries/);
    expect(report).toContain('- node:crypto');
    expect(report).toMatch(/BLIND-SPOT edges/);
    expect(report).toContain('[opaque-bare-import] @x/pkg (from packages/core/src/edge/index.ts)');
    expect(report).toContain('[unreadable-file] /abs/unreadable.ts');
    expect(report).not.toContain(REPO_ROOT); // shown relative, not absolute
  });

  it('renders the doc-unreadable variant', () => {
    const report = formatFailure({
      ...base,
      extra: [],
      missing: [],
      blindSpots: [],
      docError: 'unreadable',
      docExtra: [],
      docMissing: []
    });
    expect(report).toMatch(/could not be read/);
  });

  it('renders the markers-missing variant', () => {
    const report = formatFailure({
      ...base,
      extra: [],
      missing: [],
      blindSpots: [],
      docError: 'markers-missing',
      docExtra: [],
      docMissing: []
    });
    expect(report).toContain('missing the allowlist markers');
  });

  it('renders the doc-disagreement variant', () => {
    const report = formatFailure({
      ...base,
      extra: [],
      missing: [],
      blindSpots: [],
      docExtra: ['node:os'],
      docMissing: ['node:path']
    });
    expect(report).toContain('doc lists node:os');
    expect(report).toContain('doc omits node:path');
  });
});

describe('main', () => {
  it('logs success and does not exit when the real tree is clean', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    onTestFinished(() => vi.restoreAllMocks());

    main();

    expect(log).toHaveBeenCalledWith(expect.stringMatching(/matches the allowlist and architecture.md §6/));
    expect(exit).not.toHaveBeenCalled();
  });

  it('prints the failure report and exits 1 when a forbidden built-in appears', () => {
    const map = {
      '/v/edge/index.ts': "import 'node:vm';",
      '/v/docs.md': DEFAULT_DOC
    };
    const { readFile, exists } = vfs(map);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    onTestFinished(() => vi.restoreAllMocks());

    main({ entry: '/v/edge/index.ts', docFile: '/v/docs.md', readFile, exists });

    expect(error).toHaveBeenCalledWith(expect.stringMatching(/Edge node:\* allowlist check failed/));
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

describe('CLI (real child process)', () => {
  it('exits 0 and reports the real edge graph clean', () => {
    const output = execFileSync('node', [SCRIPT], { cwd: REPO_ROOT, encoding: 'utf-8' });
    expect(output).toMatch(/matches the allowlist and architecture.md §6/);
  });

  it('exits 1 with a diagnostic when an edge file drags in node:vm', () => {
    // Build a throwaway repo whose edge entry imports node:vm (not on the
    // allowlist) while its §6 allowlist block lists only the permitted built-ins.
    const root = mkdtempSync(join(tmpdir(), 'bonklm-edge-nb-'));
    onTestFinished(() => rmSync(root, { recursive: true, force: true }));
    const tools = join(root, 'tools');
    const edgeDir = join(root, 'packages', 'core', 'src', 'edge');
    mkdirSync(tools, { recursive: true });
    mkdirSync(edgeDir, { recursive: true });
    mkdirSync(join(root, 'docs'), { recursive: true });
    cpSync(SCRIPT, join(tools, 'check-edge-node-builtins.js'));
    cpSync(EE_SCRIPT, join(tools, 'check-ee-boundary.js')); // the masker dependency
    writeFileSync(join(edgeDir, 'index.ts'), "import vm from 'node:vm';\nexport const x = vm;\n");
    writeFileSync(join(root, 'docs', 'architecture.md'), DEFAULT_DOC);

    let status: number | null = 0;
    let stderr = '';
    try {
      execFileSync('node', [realpathSync(join(tools, 'check-edge-node-builtins.js'))], { encoding: 'utf-8' });
    } catch (err) {
      const e = err as { status?: number | null; stderr?: Buffer | string };
      status = e.status ?? null;
      stderr = String(e.stderr ?? '');
    }
    expect(status).toBe(1);
    expect(stderr).toMatch(/Edge node:\* allowlist check failed/);
    expect(stderr).toContain('node:vm');
  });
});
