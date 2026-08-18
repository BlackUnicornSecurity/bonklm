#!/usr/bin/env node
/**
 * tools/check-stale-dist.js
 * =========================
 *
 * Stale-`dist/` guard for the tsc-built packages/* workspace.
 *
 * ROOT CAUSE THIS GATE CLOSES. Every package builds with plain `tsc`, and
 * `tsc` never deletes: when a `src/` file is renamed or deleted, its old emit
 * (`dist/<old-name>.{js,js.map,d.ts,d.ts.map}`) is orphaned in `dist/` and —
 * because every package ships `files: ["dist", …]` — the orphan RIDES THE
 * TARBALL to npm consumers. The per-package tarball-drift snapshots
 * (`pnpm test:pack`, ST-04-300..351) catch this at the packaging layer, but
 * they report it as an opaque snapshot diff; this gate names the CLASS
 * ("dist emit with no src twin = stale") at the root, runs in seconds, and
 * covers the whole workspace in one shot.
 *
 * CONTRACT. For every `packages/*` that has a `dist/` directory, each walked
 * `dist/` file must have a source twin under `src/`:
 *   - `x.js` / `x.js.map`      → `src/x.ts` (or `src/x.tsx`)
 *   - `x.mjs` / `x.mjs.map`    → `src/x.mts` (or `src/x.ts`)
 *   - `x.cjs` / `x.cjs.map`    → `src/x.cts` (or `src/x.ts`)
 *   - `x.d.ts` / `x.d.ts.map`  → `src/x.ts` (or `src/x.tsx` / `src/x.d.ts`)
 *   - `x.d.cts` / `x.d.mts`    → `src/x.cts` / `src/x.mts` (or `src/x.ts`)
 *   - any other extension      → a same-named file under `src/` (asset copy)
 *
 * A `dist/` file with NO twin is STALE (its source was renamed/deleted and the
 * build never cleaned) — exit 1 listing every offender and the fix
 * (`rm -rf <pkg>/dist && pnpm --filter <pkg> run build`). The reverse
 * direction (a `src/` file with no emit) is NOT this gate's job: that is an
 * incomplete build, which the `build` gate itself fails on.
 *
 * DESIGN. Mirrors `tools/check-edge-node-builtins.js`: zero runtime
 * dependencies beyond `node:fs`/`node:path`/`node:url`, injectable fs helpers
 * so every branch is unit-testable, and `main`/`runCli` split for a
 * spawn-free CLI test. It reads the BUILT `dist/` tree, so it runs only
 * post-build (full quality-gate mode + the CI Tarball Drift job, both after
 * `pnpm run build`).
 *
 * Usage:
 *   node tools/check-stale-dist.js
 *
 * Wired into the local quality gate (`scripts/quality-gate.sh`, `stale-dist`
 * gate right after `build`) and the CI Tarball Drift job
 * (`.github/workflows/ci.yml`).
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Emitted-JS/declaration extension → candidate source extensions (priority order). */
const EMIT_TO_SOURCE = new Map([
  ['.js', ['.ts', '.tsx']],
  ['.mjs', ['.mts', '.ts']],
  ['.cjs', ['.cts', '.ts']],
  ['.d.ts', ['.ts', '.tsx', '.d.ts']],
  ['.d.cts', ['.cts', '.ts']],
  ['.d.mts', ['.mts', '.ts']]
]);

/** Map/sourcemap suffix stripped before extension mapping. */
const MAP_SUFFIX = '.map';

/**
 * Candidate source-relative paths for a `dist/`-relative file path, or null
 * when the path keeps its name (non-tsc asset). `.map` files map to the
 * source of the file they describe.
 */
export function sourceCandidates(distRel) {
  let rel = distRel;
  if (rel.endsWith(MAP_SUFFIX)) {
    rel = rel.slice(0, -MAP_SUFFIX.length);
  }
  for (const [emitExt, sourceExts] of EMIT_TO_SOURCE) {
    if (rel.endsWith(emitExt)) {
      const stem = rel.slice(0, -emitExt.length);
      // A `.map` describes the emit of the same base path, so it maps to the
      // same source candidates as the emit it accompanies (the emit itself is
      // checked in the non-map pass of the same walk).
      return sourceExts.map(ext => stem + ext);
    }
  }
  return [rel];
}

/** True when `distRel` (relative to a package's `dist/`) has a `src/` twin. */
export function hasSourceTwin(pkgDir, distRel, exists = p => existsSync(p)) {
  return sourceCandidates(distRel).some(candidate => exists(join(pkgDir, 'src', candidate)));
}

/** Recursively collect file paths under `dir` (relative to `dir`). */
export function walkFiles(dir, listFiles = d => readdirSync(d)) {
  const out = [];
  const stack = [''];
  while (stack.length > 0) {
    const relDir = stack.pop();
    const absDir = relDir === '' ? dir : join(dir, relDir);
    let entries;
    try {
      entries = listFiles(absDir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const rel = relDir === '' ? entry : join(relDir, entry);
      const abs = join(dir, rel);
      let st;
      try {
        st = statSync(abs);
      } catch {
        continue;
      }
      if (st.isDirectory()) stack.push(rel);
      else out.push(rel);
    }
  }
  return out.sort();
}

/**
 * Run the gate over `packagesDir`: every `dist/` file in every package with a
 * `dist/` must have a `src/` twin. `packagesDir`, `exists`, `listFiles`,
 * `isDirectory` are injectable for testing; production callers pass nothing.
 *
 * @returns {{ ok: boolean, packages: Array<{ name: string, distFiles: number,
 *   stale: Array<{ file: string, expected: string[] }> }>, skipped: string[],
 *   staleCount: number, packagesChecked: number, distFilesChecked: number }}
 */
export function checkStaleDist({
  packagesDir,
  exists = p => existsSync(p),
  listFiles = d => readdirSync(d),
  isDirectory = p => {
    try {
      return statSync(p).isDirectory();
    } catch {
      return false;
    }
  }
} = {}) {
  const pkgsRoot = packagesDir ?? join(ROOT, 'packages');
  const packages = [];
  const skipped = [];
  let staleCount = 0;
  let distFilesChecked = 0;
  let packagesChecked = 0;

  const packageNames = exists(pkgsRoot) ? listFiles(pkgsRoot).sort() : [];
  for (const name of packageNames) {
    const pkgDir = join(pkgsRoot, name);
    if (!isDirectory(pkgDir)) continue;
    const distDir = join(pkgDir, 'dist');
    if (!exists(distDir)) {
      skipped.push(name);
      continue;
    }
    packagesChecked += 1;
    const stale = [];
    const distFiles = walkFiles(distDir, listFiles);
    for (const distRel of distFiles) {
      distFilesChecked += 1;
      if (!hasSourceTwin(pkgDir, distRel, exists)) {
        stale.push({ file: distRel, expected: sourceCandidates(distRel) });
      }
    }
    if (stale.length > 0) staleCount += stale.length;
    packages.push({ name, distFiles: distFiles.length, stale });
  }

  return {
    ok: staleCount === 0,
    packages,
    skipped,
    staleCount,
    packagesChecked,
    distFilesChecked
  };
}

/** Render a human-readable failure report from a `checkStaleDist` result. */
export function formatFailure(result) {
  const lines = [
    'Stale-dist check failed.',
    '',
    `  ${result.staleCount} dist/ file(s) have no src/ twin (stale emit from a renamed/deleted source):`
  ];
  for (const pkg of result.packages) {
    for (const s of pkg.stale) {
      lines.push(`    ${pkg.name}/dist/${s.file}  (expected src twin: ${s.expected.join(' or ')})`);
    }
  }
  lines.push(
    '',
    'Fix: tsc never cleans — a renamed/deleted src file leaves orphaned emit behind, and it',
    'ships in the tarball (files: ["dist"]). Rebuild the offending package(s) from clean:',
    '  rm -rf packages/<pkg>/dist && pnpm --filter <pkg> run build',
    'then re-run this gate. The tarball-drift snapshot that caught this is CORRECT — do not',
    'regenerate it.'
  );
  return lines.join('\n');
}

/**
 * CLI body: run the check, print, and exit non-zero on any stale emit. Paths
 * and fs helpers are injectable for testing; production callers pass nothing.
 */
export function main(opts) {
  const result = checkStaleDist(opts);
  if (result.ok) {
    console.log(
      `check-stale-dist: ${result.packagesChecked} package(s) checked, ` +
        `${result.distFilesChecked} dist file(s) all have src/ twins ` +
        `(${result.skipped.length} package(s) without dist skipped).`
    );
    return result;
  }
  console.error(`\n${formatFailure(result)}\n`);
  process.exit(1);
}

/**
 * Invoke `main` only when this file is executed directly (node tools/...), not
 * when imported by the test suite. `run`/`exit` are injectable so the
 * entrypoint + error paths are unit-testable without spawning a process.
 */
export function runCli({ argv1, scriptUrl, run = main, exit = process.exit }) {
  if (argv1 !== fileURLToPath(scriptUrl)) return false;
  try {
    run();
  } catch (err) {
    console.error('\ncheck-stale-dist: aborted on error:');
    console.error(`  ${err instanceof Error ? err.message : String(err)}`);
    exit(1);
  }
  return true;
}

runCli({ argv1: process.argv[1], scriptUrl: import.meta.url });
