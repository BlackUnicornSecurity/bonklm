#!/usr/bin/env node
/**
 * tools/check-edge-node-builtins.js
 * =================================
 *
 * Edge-bundle Node-built-in ALLOWLIST gate for `@blackunicorn/bonklm/edge`.
 *
 * The `./edge` subpath ships the portable subset of the core API for
 * Node-compatible edge runtimes (`workerd` with `nodejs_compat`, Deno, Bun). It
 * deliberately does NOT declare the strict-Vercel `edge-light` export condition,
 * because its transitive graph pulls a BOUNDED set of `node:*` built-ins that
 * `edge-light` does not provide (architecture.md §6). That bound is the whole
 * contract — and until now nothing enforced it. A future edge-exported factory
 * could silently widen the set: e.g. re-exporting `HookSandbox` would drag
 * `node:vm` into the edge graph, breaking Deno/Bun/workerd portability with no
 * failing test — the kind of regression that only manual review catches. (The
 * AsyncLocalStorage-backed `raw-upstream-cache` is how `node:async_hooks` itself
 * entered the set, via the `/edge`-exported `createMemoryWriteValidator` →
 * provenance re-scan path the security regression work added — see architecture.md §5b.)
 *
 * This gate resolves the transitive import graph of the edge entry
 * (`packages/core/src/edge/index.ts`) by a static source walk and asserts the set
 * of `node:*` specifiers reachable from it EQUALS the documented allowlist. It
 * fails with a clear diff on ANY divergence:
 *   - `extra`   — a `node:*` built-in present in the graph but not allowlisted
 *                 (the headline regression: a new built-in dragged in).
 *   - `missing` — an allowlisted built-in no longer present in the graph (the
 *                 allowlist drifted too broad; shrink it + the doc).
 *   - blind spots — an import edge the static `node:*` scan cannot see through
 *                 (a bare/workspace import, a non-literal dynamic `import()`, or
 *                 an unresolved relative specifier). Today the edge graph is fully
 *                 self-contained within `packages/core/src`, so this set is empty;
 *                 a new opaque edge could hide a `node:*` dependency, so it
 *                 fail-closes rather than silently under-counting.
 *
 * SINGLE SOURCE OF TRUTH. The canonical allowlist is {@link EDGE_NODE_BUILTIN_ALLOWLIST}
 * below. The gate ALSO parses the marker-delimited allowlist block in
 * architecture.md §6 and asserts it equals the const, so the human-readable doc
 * and the machine-enforced const can never drift apart.
 *
 * DESIGN. Mirrors `tools/check-ee-boundary.js`: zero runtime dependencies beyond
 * `node:fs`/`node:path`/`node:url`, so it runs in CI with no `pnpm install` or
 * build (a static SOURCE walk, not a built-`dist/` resolve — no build artifact
 * needed). The lexical mask + import extractors are reused from check-ee-boundary
 * (only the algorithm; the resolver, walker, and doc-sync are net-new here).
 *
 * Failure → exit 1 with an allowlist-diff report.
 *
 * Usage:
 *   node tools/check-edge-node-builtins.js
 *
 * Wired into CI as `pnpm run check:edge-node-builtins` (root scripts), the
 * dependency-free `edge-node-builtins` job in `.github/workflows/ci.yml`, and the
 * local quality gate (`scripts/quality-gate.sh`).
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractDynamicImports, extractStaticImports, maskSource } from './check-ee-boundary.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The edge subpath's source entry — the root of the graph this gate walks. */
export const EDGE_ENTRY = resolve(ROOT, 'packages/core/src/edge/index.ts');

/** The doc whose §6 marker block must mirror the allowlist const. */
export const ARCH_DOC = resolve(ROOT, 'docs/architecture.md');

/**
 * Canonical allowlist of `node:*` built-ins the edge graph may reach. This is the
 * SINGLE source of truth; architecture.md §6 mirrors it (enforced below) and the
 * computed edge graph must equal it. `edge-light` is intentionally unsupported
 * precisely because these built-ins are outside its subset (architecture.md §6).
 */
export const EDGE_NODE_BUILTIN_ALLOWLIST = new Set(['node:async_hooks', 'node:crypto', 'node:fs', 'node:path']);

/** HTML-comment markers delimiting the machine-readable allowlist block in the doc. */
export const DOC_ALLOWLIST_START = '<!-- edge-node-builtins:allowlist:start -->';
export const DOC_ALLOWLIST_END = '<!-- edge-node-builtins:allowlist:end -->';

// ---------------------------------------------------------------------------
// Source-file resolution (TS NodeNext: relative imports name the emitted `.js`).
// ---------------------------------------------------------------------------

/** TS source extensions a relative specifier is resolved against. */
const SOURCE_EXTS = ['.ts', '.tsx', '.mts', '.cts'];
const SOURCE_EXT_SET = new Set(SOURCE_EXTS);

/** Emitted-JS extension → its TS source sibling (NodeNext rewrites `.ts`→`.js`). */
const JS_TO_TS = new Map([
  ['.js', '.ts'],
  ['.jsx', '.tsx'],
  ['.mjs', '.mts'],
  ['.cjs', '.cts']
]);

/**
 * Candidate source paths a resolved relative `base` could map to, in priority
 * order and de-duplicated: the TS sibling of a `.js`-family specifier, an exact
 * source-ext path, an extensionless `base.<ext>`, then a `base/index.<ext>`
 * directory import. The first existing one wins in {@link resolveSourceImport}.
 */
export function sourceCandidates(base) {
  const candidates = [];
  const ext = extname(base);
  if (JS_TO_TS.has(ext)) {
    const stem = base.slice(0, -ext.length);
    candidates.push(stem + JS_TO_TS.get(ext));
    for (const e of SOURCE_EXTS) candidates.push(stem + e);
  }
  if (SOURCE_EXT_SET.has(ext)) candidates.push(base);
  for (const e of SOURCE_EXTS) candidates.push(base + e);
  for (const e of SOURCE_EXTS) candidates.push(resolve(base, `index${e}`));
  return [...new Set(candidates)];
}

/**
 * Resolve a relative import specifier from `fromFileAbs` to the absolute path of
 * the TS source file it targets, or null if no candidate exists. `exists` is
 * injectable for testing.
 */
export function resolveSourceImport(spec, fromFileAbs, exists = p => existsSync(p)) {
  const base = resolve(dirname(fromFileAbs), spec);
  for (const candidate of sourceCandidates(base)) {
    if (exists(candidate)) return candidate;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Graph walk.
// ---------------------------------------------------------------------------

/**
 * Walk the transitive import graph from `entry`, following relative source
 * imports only. Returns the set of `node:*` specifiers reached, the list of files
 * visited, and every BLIND SPOT — an edge the static scan cannot see through:
 *   - `opaque-bare-import`  — a bare/workspace specifier (could hide `node:*`).
 *   - `dynamic-nonliteral`  — a computed `import()` target (unknowable statically).
 *   - `unresolved-relative` — a relative specifier with no source file on disk.
 *   - `unreadable-file`     — a file the walker could not read.
 *
 * `readFile`/`exists` are injectable for testing; production callers pass nothing.
 *
 * @returns {{ nodeBuiltins: Set<string>, files: string[], blindSpots: Array<{ spec: string, from: string|null, reason: string }> }}
 */
export function walkEdgeGraph({ entry, readFile = p => readFileSync(p, 'utf-8'), exists = p => existsSync(p) }) {
  const visited = new Set();
  const nodeBuiltins = new Set();
  const blindSpots = [];
  const stack = [entry];

  while (stack.length > 0) {
    const file = stack.pop();
    if (visited.has(file)) continue;
    visited.add(file);

    let text;
    try {
      text = readFile(file);
    } catch {
      blindSpots.push({ spec: file, from: null, reason: 'unreadable-file' });
      continue;
    }

    const masked = maskSource(text);
    const dynamic = extractDynamicImports(masked);
    const specs = [...extractStaticImports(masked), ...dynamic.literals];

    for (const spec of specs) {
      if (spec.startsWith('node:')) {
        nodeBuiltins.add(spec);
        continue;
      }
      if (spec.startsWith('.')) {
        const target = resolveSourceImport(spec, file, exists);
        if (target) stack.push(target);
        else blindSpots.push({ spec, from: file, reason: 'unresolved-relative' });
        continue;
      }
      blindSpots.push({ spec, from: file, reason: 'opaque-bare-import' });
    }
    for (const spec of dynamic.nonLiteral) {
      blindSpots.push({ spec, from: file, reason: 'dynamic-nonliteral' });
    }
  }

  return { nodeBuiltins, files: [...visited], blindSpots };
}

// ---------------------------------------------------------------------------
// Doc-sync.
// ---------------------------------------------------------------------------

/**
 * Extract the `node:*` tokens from the marker-delimited allowlist block in the
 * architecture-doc text. Returns null when the markers are absent or disordered
 * (treated as a doc-structure failure), otherwise the set of tokens found between
 * them. Parsing is confined to the marker region so unrelated `node:*` mentions
 * elsewhere in §6 (`node:vm`, `node:crypto.timingSafeEqual`) cannot leak in.
 */
export function parseDocAllowlist(docText) {
  const start = docText.indexOf(DOC_ALLOWLIST_START);
  const end = docText.indexOf(DOC_ALLOWLIST_END);
  if (start < 0 || end < 0 || end < start) return null;
  const region = docText.slice(start + DOC_ALLOWLIST_START.length, end);
  return new Set(region.match(/node:[a-z_][a-z0-9_/]*/g) ?? []);
}

// ---------------------------------------------------------------------------
// Orchestration + CLI.
// ---------------------------------------------------------------------------

/** Sorted members of `a` not in `b`. */
export function setDiff(a, b) {
  return [...a].filter(x => !b.has(x)).sort();
}

/**
 * Run the gate: walk the edge graph, diff its `node:*` set against the allowlist
 * (both directions), collect blind spots, and verify the doc's marker block
 * mirrors the allowlist const. Paths and fs helpers are injectable for testing;
 * production callers pass nothing.
 *
 * @returns {{ ok, found, allowlist, extra, missing, blindSpots, fileCount,
 *   docPath, docError, docAllowlist, docExtra, docMissing }}
 */
export function checkEdgeNodeBuiltins({ entry, docFile, readFile, exists, allowlist } = {}) {
  const entryFile = entry ?? EDGE_ENTRY;
  const read = readFile ?? (p => readFileSync(p, 'utf-8'));
  const fileExists = exists ?? (p => existsSync(p));
  const allow = allowlist ?? EDGE_NODE_BUILTIN_ALLOWLIST;
  const docPath = docFile ?? ARCH_DOC;

  const graph = walkEdgeGraph({ entry: entryFile, readFile: read, exists: fileExists });
  const extra = setDiff(graph.nodeBuiltins, allow);
  const missing = setDiff(allow, graph.nodeBuiltins);

  let docText = null;
  let docError = null;
  try {
    docText = read(docPath);
  } catch {
    docError = 'unreadable';
  }
  let docAllowlist = null;
  if (docText !== null) {
    docAllowlist = parseDocAllowlist(docText);
    if (docAllowlist === null) docError = 'markers-missing';
  }
  const docExtra = docAllowlist ? setDiff(docAllowlist, allow) : [];
  const docMissing = docAllowlist ? setDiff(allow, docAllowlist) : [];
  const docMismatch = docError !== null || docExtra.length > 0 || docMissing.length > 0;

  return {
    ok: extra.length === 0 && missing.length === 0 && graph.blindSpots.length === 0 && !docMismatch,
    found: [...graph.nodeBuiltins].sort(),
    allowlist: [...allow].sort(),
    extra,
    missing,
    blindSpots: graph.blindSpots,
    fileCount: graph.files.length,
    docPath,
    docError,
    docAllowlist: docAllowlist ? [...docAllowlist].sort() : null,
    docExtra,
    docMissing
  };
}

/** Render a human-readable failure report from a `checkEdgeNodeBuiltins` result. */
export function formatFailure(result) {
  const rel = p => relative(ROOT, p);
  const lines = [
    'Edge node:* allowlist check failed.',
    '',
    `  edge entry: ${rel(EDGE_ENTRY)} (${result.fileCount} files walked)`
  ];

  if (result.extra.length > 0) {
    lines.push(
      '',
      `  FORBIDDEN built-ins reachable from the edge graph (not in the allowlist): ${result.extra.length}`
    );
    for (const b of result.extra) lines.push(`    + ${b}`);
  }

  if (result.missing.length > 0) {
    lines.push(
      '',
      `  STALE allowlist entries no longer reachable from the edge graph (allowlist too broad): ${result.missing.length}`
    );
    for (const b of result.missing) lines.push(`    - ${b}`);
  }

  if (result.blindSpots.length > 0) {
    lines.push(
      '',
      `  BLIND-SPOT edges the static node:* scan cannot see through (could hide a node:* dependency): ${result.blindSpots.length}`
    );
    for (const s of result.blindSpots) {
      const where = s.from ? ` (from ${rel(s.from)})` : '';
      lines.push(`    ? [${s.reason}] ${s.spec}${where}`);
    }
  }

  if (result.docError === 'unreadable') {
    lines.push('', `  DOC ${rel(result.docPath)} could not be read (architecture.md §6 allowlist block).`);
  } else if (result.docError === 'markers-missing') {
    lines.push(
      '',
      `  DOC ${rel(result.docPath)} is missing the allowlist markers ` +
        `(${DOC_ALLOWLIST_START} … ${DOC_ALLOWLIST_END}).`
    );
  } else if (result.docExtra.length > 0 || result.docMissing.length > 0) {
    lines.push('', `  DOC ${rel(result.docPath)} §6 allowlist block disagrees with the canonical const:`);
    for (const b of result.docExtra) lines.push(`    + doc lists ${b} (not in EDGE_NODE_BUILTIN_ALLOWLIST)`);
    for (const b of result.docMissing) lines.push(`    - doc omits ${b} (in EDGE_NODE_BUILTIN_ALLOWLIST)`);
  }

  lines.push(
    '',
    'Fix: a new edge-exported factory must not drag a Node built-in outside the allowlist',
    'into the edge graph (it would break Deno/Bun/workerd portability — see architecture.md §6).',
    'Either keep the Node-only code off the `@blackunicorn/bonklm/edge` surface, or — if the new',
    'built-in is genuinely edge-safe across all supported runtimes — update BOTH',
    'EDGE_NODE_BUILTIN_ALLOWLIST (tools/check-edge-node-builtins.js) and the architecture.md §6',
    'allowlist block, with reviewer sign-off.'
  );
  return lines.join('\n');
}

/**
 * CLI body: run the check, print, and exit non-zero on any failure. Paths are
 * injectable for testing; production callers pass nothing.
 */
export function main(opts) {
  const result = checkEdgeNodeBuiltins(opts);
  if (result.ok) {
    console.log(
      `check-edge-node-builtins: ${result.fileCount} edge-graph file(s) walked; ` +
        `node:* set = {${result.found.join(', ')}} matches the allowlist and architecture.md §6.`
    );
    return result;
  }
  console.error(`\n${formatFailure(result)}\n`);
  process.exit(1);
}

/**
 * Invoke `main` only when this file is executed directly (node tools/...), not
 * when imported by the test suite. `run`/`exit` are injectable so the entrypoint
 * + error paths are unit-testable without spawning a process. Wrapping `run` in
 * try/catch turns an unexpected error into a controlled exit + clear diagnostic.
 */
export function runCli({ argv1, scriptUrl, run = main, exit = process.exit }) {
  if (argv1 !== fileURLToPath(scriptUrl)) return false;
  try {
    run();
  } catch (err) {
    console.error('\ncheck-edge-node-builtins: aborted on error:');
    console.error(`  ${err instanceof Error ? err.message : String(err)}`);
    exit(1);
  }
  return true;
}

runCli({ argv1: process.argv[1], scriptUrl: import.meta.url });
