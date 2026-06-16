#!/usr/bin/env node
/**
 * tools/check-ee-boundary.js
 * ==========================
 *
 * EE (enterprise/BSL) ⇄ OSS (community/Apache) license-boundary gate for the
 * BonkLM monorepo. Enforces the open-core boundary (ADR-0006: an Apache-2.0
 * community core + a source-available BSL-1.1 enterprise tier) via the
 * load-bearing invariant:
 *
 *   > `packages/core` and every Apache-tier package MUST build, type-check, and
 *   > pass tests with the entire `packages/bonklm-ee/*` tree ABSENT.
 *
 * The gate bundles TWO enforcement facets, sharing a SINGLE package index so they
 * can never drift apart on "what is EE":
 *
 *   A. License classifier — every workspace package under `packages/` must declare
 *      a RECOGNIZED license:
 *        - `Apache-2.0`                      → OSS  (community)
 *        - `BUSL-1.1` / `LicenseRef-BSL-1.1` → EE   (enterprise / source-available)
 *      An unknown/empty `license` (or a manifest with no `name`) is an ERROR —
 *      never a silent weaker scan (a package that escapes classification could
 *      also escape the boundary check below). `BUSL-1.1` is the SPDX token; the
 *      prose name "BSL-1.1" is NOT a valid SPDX value and is rejected.
 *
 *   B. Boundary guard — no OSS package may depend on an EE package, via either
 *      (b1) a source `import` / `import()` of an EE package specifier, or
 *      (b2) a declared dependency on an EE package in its package.json
 *           `dependencies` / `peerDependencies` / `optionalDependencies` (which
 *           drags EE into `pnpm install` even with no source import, breaking the
 *           "builds with `packages/bonklm-ee/*` absent" invariant).
 *      At v1.0 there are ZERO ee packages so this passes TRIVIALLY (zero ee
 *      targets ⇒ zero violations); that is correct — the guard is a TRIPWIRE for
 *      the first v1.1 `packages/bonklm-ee/*` build. It is deliberately NOT
 *      fail-closed on "zero ee packages" (that fail-closed assertion is the
 *      fresh-export exclude-gate, a different control).
 *
 * This is a SEPARATE tool from `tools/check-workspace-policy.js` by design: that
 * gate is a DIFFERENT axis (`tools/*` publishability — "Tier A=internal /
 * Tier B=publishable", the OPPOSITE polarity) and must not be overloaded. License
 * tiers here are ALWAYS called "OSS/EE" (or "Apache/BSL"), never "Tier A/B", to
 * avoid the vocabulary collision.
 *
 * DESIGN NOTES
 * ------------
 * - Granularity is PACKAGE-SPECIFIER, not file-level. BonkLM carves the EE tier
 *   PHYSICALLY (whole capabilities relocate into `packages/bonklm-ee/*`, the M1
 *   mechanism), so the leak unit is a cross-package import edge, not an
 *   intra-package symbol. This differs from the prior tooling, which does a
 *   TRANSITIVE file graph because it ships a SUBSET of files and must ensure no
 *   included file reaches an excluded one through a chain. Here EVERY package is
 *   scanned, so any OSS→EE edge is caught DIRECTLY at the offending package — a
 *   transitive chain OSS-A → OSS-B → EE is caught by B's own direct B→EE edge,
 *   which is also the precise place to fix it. Direct-edge-per-package is both
 *   sound (under physical carve) and simpler.
 * - PACKAGE DISCOVERY handles both layouts: a package is a directory with a
 *   `package.json` either directly under `packages/` (e.g. `packages/core/`) OR
 *   one level under a grouping directory that has no manifest of its own — the
 *   documented EE-tier layout `packages/bonklm-ee/<capability>/`. A directory that
 *   already IS a package is never descended into, so a package's own `examples/`
 *   sub-apps are not mistaken for packages.
 * - The resolver READS the real `packages/*\/package.json` `name`→dir map. BonkLM
 *   package dir ≠ package name (e.g. `@blackunicorn/bonklm-fastify` lives in
 *   `packages/fastify-plugin/`), so a naming-convention resolver fails OPEN; the
 *   map is authoritative.
 * - The lexical-mask + import-extraction algorithm (`maskSource`,
 *   `extractStaticImports`, `extractDynamicImports`) is adapted from prior
 *   BlackUnicorn Apache-2.0 community-export tooling. Only the algorithm is
 *   reused; the resolver, license classifier, and boundary profile are net-new
 *   and BonkLM-specific.
 * - Zero runtime dependencies beyond `node:fs`/`node:path`/`node:url`, so it runs
 *   in CI with no `pnpm install` or build (mirrors `check-changeset-linked`).
 *
 * SCOPE / LIMITATIONS (intentional):
 * - ESM `import` / `import()` + the three manifest dependency fields are checked.
 *   A `type`-only `import type … from '@…/bonklm-ee-x'` IS flagged on purpose: the
 *   open core must not even NAME a Pro package, and a type import of an absent EE
 *   package fails `tsc` (breaking the "type-checks with EE absent" invariant).
 * - CommonJS `require('@…/bonklm-ee-x')` is NOT detected. The core is ESM-only
 *   (`"type": "module"`); a `require` edge is the manifest-dependency facet's job
 *   to catch (a required package must be a declared dependency).
 * - Example apps (`packages/<x>/examples/`, `packages/examples/`) are out of
 *   scope: they are private, never published, and not part of the load-bearing
 *   "core builds/tests with EE absent" surface (the export gate excludes them).
 *
 * Failure → exit 1 with an unclassifiable-package and/or OSS→EE-violation report.
 *
 * Usage:
 *   node tools/check-ee-boundary.js
 *
 * Wired into CI as `pnpm run check:ee-boundary` (root scripts), the
 * dependency-free `ee-boundary` job in `.github/workflows/ci.yml`, and the local
 * quality gate (`scripts/quality-gate.sh`). Design recorded in
 * `docs/contributing/adr/0007-ee-license-boundary-guard.md`.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGES_DIR = join(ROOT, 'packages');

/**
 * Build / dependency output directories — never treated as a package and never
 * traversed. Used by BOTH package discovery and the source-file walk.
 */
const BUILD_SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', 'build', '.next', '.turbo']);

/**
 * Directories the source-file WALK skips on top of the build dirs: private
 * example apps. Examples are out of scope — not part of the published /
 * load-bearing surface (an example importing EE is out of scope; the fresh-export
 * gate excludes them from the tarball). They are deliberately NOT skipped during
 * package DISCOVERY, so a real (BSL) capability whose own directory happens to be
 * named `examples` under a grouping dir is still classified.
 */
const WALK_SKIP_DIRS = new Set([...BUILD_SKIP_DIRS, 'examples']);

// ---------------------------------------------------------------------------
// License classification (net-new) — the single source of truth for OSS vs EE.
// ---------------------------------------------------------------------------

/** SPDX `license` values that mark a package as OSS (Apache community core). */
export const OSS_LICENSES = new Set(['Apache-2.0']);

/**
 * SPDX `license` values that mark a package as EE (source-available BSL tier).
 * Both spellings (`BUSL-1.1` per ADR-0006 and the `LicenseRef-BSL-1.1` SPDX
 * variant) classify as EE so a BSL-intended package is never mis-read as merely
 * "unknown".
 */
export const EE_LICENSES = new Set(['BUSL-1.1', 'LicenseRef-BSL-1.1']);

/**
 * Classify a manifest `license` value into `'oss' | 'ee' | 'unknown'`. A missing,
 * empty, or unrecognized license is `'unknown'` (the gate treats it as an error —
 * never a silent weaker scan).
 */
export function classifyLicense(license) {
  if (typeof license !== 'string' || license.length === 0) return 'unknown';
  if (OSS_LICENSES.has(license)) return 'oss';
  if (EE_LICENSES.has(license)) return 'ee';
  return 'unknown';
}

/**
 * Read + parse a JSON file. Returns null on absence; throws on parse error so a
 * malformed manifest is loud rather than silently treated as absent.
 */
export function readJson(path) {
  if (!existsSync(path)) return null;
  const text = readFileSync(path, 'utf-8');
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`Failed to parse ${path}: ${err.message}`, { cause: err });
  }
}

/** Normalize a manifest `license` to a string or null (for diagnostics). */
function licenseOf(pkg) {
  return typeof pkg.license === 'string' ? pkg.license : null;
}

/** All declared dependency names (runtime + peer + optional) of a manifest. */
function dependencyNames(pkg) {
  const names = [];
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    const map = pkg[field];
    if (map !== null && typeof map === 'object') names.push(...Object.keys(map));
  }
  return names;
}

/**
 * Index one manifest into `byName`/`list`/`errors`. A manifest with no string
 * `name` is recorded in `errors` and not indexed; one with an unknown/empty
 * `license` is recorded in `errors` AND still indexed (so an inbound edge to it
 * still resolves), the gate failing on it regardless.
 *
 * Record: `{ name, dir, absDir, license, tier, deps }` (`dir` is the path under
 * `packages/`, e.g. `core` or `bonklm-ee/doctor-pro`).
 */
function indexManifest({ pkg, dir, absDir, byName, list, errors }) {
  if (typeof pkg.name !== 'string' || pkg.name.length === 0) {
    errors.push({ dir, name: null, license: licenseOf(pkg), reason: 'manifest has no "name"' });
    return;
  }
  const tier = classifyLicense(pkg.license);
  const record = { name: pkg.name, dir, absDir, license: licenseOf(pkg), tier, deps: dependencyNames(pkg) };
  if (tier === 'unknown') {
    errors.push({
      dir,
      name: pkg.name,
      license: record.license,
      reason: 'unrecognized or missing "license" (expected Apache-2.0 [OSS] or BUSL-1.1 [EE])'
    });
  }
  list.push(record);
  byName.set(pkg.name, record);
}

/**
 * Build the package index from the `packages/` tree: a `name`→record map, a flat
 * `list`, and the `errors` array of unclassifiable packages. A package is a
 * directory with a `package.json` either directly under `packages/` OR one level
 * under a grouping directory that has no manifest of its own (the documented
 * `packages/bonklm-ee/<capability>/` layout). Build/dep/example directories are
 * skipped (`SKIP_DIRS`).
 *
 * @returns {{ byName: Map<string, object>, list: object[], errors: object[] }}
 */
export function buildPackageIndex(packagesDir) {
  const byName = new Map();
  const list = [];
  const errors = [];
  if (!existsSync(packagesDir)) return { byName, list, errors };

  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    // Dirent.isDirectory() does not follow symlinks, which is correct here —
    // packages/* are real directories. Skips a stray file (e.g. `.DS_Store`).
    if (!entry.isDirectory()) continue;
    const dir = entry.name;
    if (BUILD_SKIP_DIRS.has(dir) || dir.startsWith('.')) continue;
    const dirAbs = join(packagesDir, dir);

    const pkg = readJson(join(dirAbs, 'package.json'));
    if (pkg !== null) {
      indexManifest({ pkg, dir, absDir: dirAbs, byName, list, errors });
      continue;
    }

    // No manifest here → a grouping directory (the EE tier lives at
    // `packages/bonklm-ee/<capability>/`). Descend ONE level and index each child
    // that is itself a package. A directory that already IS a package is never
    // descended, so a package's own `examples/` sub-apps are not indexed.
    for (const sub of readdirSync(dirAbs, { withFileTypes: true })) {
      if (!sub.isDirectory()) continue;
      if (BUILD_SKIP_DIRS.has(sub.name) || sub.name.startsWith('.')) continue;
      const subAbs = join(dirAbs, sub.name);
      const subPkg = readJson(join(subAbs, 'package.json'));
      if (subPkg === null) continue;
      indexManifest({ pkg: subPkg, dir: `${dir}/${sub.name}`, absDir: subAbs, byName, list, errors });
    }
  }
  return { byName, list, errors };
}

// ---------------------------------------------------------------------------
// Lexical mask + import extraction.
// Adapted from prior BlackUnicorn Apache-2.0 community-export tooling: only the
// algorithm is reused; everything below this block is BonkLM-specific.
// ---------------------------------------------------------------------------

/** Source extensions a relative specifier is resolved against / files walked. */
const SOURCE_EXTS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];
const SOURCE_EXT_SET = new Set(SOURCE_EXTS);

/** Whether a path names a source file the import graph traverses. */
export function isSourceFile(p) {
  return SOURCE_EXT_SET.has(extname(p));
}

/**
 * One-pass lexical mask. Returns two same-length views of the source:
 *   - `noComments`: comment bodies → spaces, STRING CONTENT KEPT (so a specifier
 *     can be read back) — newlines preserved so offsets stay stable.
 *   - `codeMask`: comment bodies AND string CONTENT → spaces, but string/template
 *     DELIMITERS kept + all CODE kept. Keyword/structure searches run on this so a
 *     path named in a doc-comment, or a literal that CONTAINS `import(` (e.g. a
 *     denylist string `'import('`), can NEVER be mis-read as a real import — its
 *     characters are blanked in the mask.
 */
export function maskSource(src) {
  let noComments = '';
  let codeMask = '';
  let state = 'code'; // code | line | block | sq | dq | tpl
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const n = src[i + 1];
    if (state === 'code') {
      if (c === '/' && n === '/') {
        noComments += '  ';
        codeMask += '  ';
        i++;
        state = 'line';
        continue;
      }
      if (c === '/' && n === '*') {
        noComments += '  ';
        codeMask += '  ';
        i++;
        state = 'block';
        continue;
      }
      if (c === "'" || c === '"' || c === '`') {
        noComments += c;
        codeMask += c; // opening delimiter kept in both
        state = c === "'" ? 'sq' : c === '"' ? 'dq' : 'tpl';
        continue;
      }
      noComments += c;
      codeMask += c;
    } else if (state === 'line') {
      if (c === '\n') {
        noComments += c;
        codeMask += c;
        state = 'code';
      } else {
        noComments += ' ';
        codeMask += ' ';
      }
    } else if (state === 'block') {
      if (c === '*' && n === '/') {
        noComments += '  ';
        codeMask += '  ';
        i++;
        state = 'code';
      } else {
        const s = c === '\n' ? '\n' : ' ';
        noComments += s;
        codeMask += s;
      }
    } else {
      // sq | dq | tpl — inside a string: noComments KEEPS content, codeMask BLANKS it
      const delim = state === 'sq' ? "'" : state === 'dq' ? '"' : '`';
      if (c === '\\') {
        noComments += c;
        codeMask += ' ';
        if (i + 1 < src.length) {
          noComments += src[i + 1];
          codeMask += ' ';
          i++;
        }
      } else if (c === delim) {
        noComments += c;
        codeMask += c; // closing delimiter kept in both
        state = 'code';
      } else {
        noComments += c;
        codeMask += c === '\n' ? '\n' : ' ';
      }
    }
  }
  return { noComments, codeMask };
}

/**
 * Extract static module specifiers: `… from 'x'` (import/export-from, including
 * `import type`/`export type` and `export * from`) and side-effect `import 'x'`.
 * The opening quote is located in `codeMask` (so a `from`/`import` token buried in
 * a string/comment cannot match) and the specifier text is read from `noComments`.
 * `import(` is NOT matched here.
 * @returns {string[]} specifiers, de-duplicated.
 */
export function extractStaticImports(masked) {
  const { noComments, codeMask } = masked;
  const specs = [];
  for (const m of codeMask.matchAll(/\b(?:from|import)\s*(['"])/g)) {
    const q = m[1];
    const open = m.index + m[0].length - 1; // index of the opening quote
    const close = codeMask.indexOf(q, open + 1);
    if (close > open) specs.push(noComments.slice(open + 1, close));
  }
  return [...new Set(specs)];
}

/**
 * Extract dynamic import() targets. The `import(` keyword site is found in
 * `codeMask` (so `'import('` inside a string is NOT matched) and the argument is
 * read from `noComments`. A trailing TypeScript `as <Type>` cast is stripped
 * before the literal test. Returns string-literal arguments in `literals` and
 * every NON-string-literal argument (a computed/template path) in `nonLiteral`.
 * @returns {{ literals: string[], nonLiteral: string[] }}
 */
export function extractDynamicImports(masked) {
  const { noComments, codeMask } = masked;
  const literals = [];
  const nonLiteral = [];
  for (const m of codeMask.matchAll(/(?<![.\w])import\s*\(/g)) {
    const paren = m.index + m[0].length - 1; // index of '('
    const close = codeMask.indexOf(')', paren + 1);
    if (close < 0) continue;
    let arg = noComments.slice(paren + 1, close).trim();
    arg = arg.replace(/\s+as\s+[A-Za-z_$][\w$.<>[\] |]*$/, '').trim(); // strip a TS `as Type` cast
    const lit = arg.match(/^['"]([^'"]+)['"]$/);
    if (lit) literals.push(lit[1]);
    else nonLiteral.push(arg.length > 40 ? `${arg.slice(0, 40)}…` : arg);
  }
  return { literals: [...new Set(literals)], nonLiteral: [...new Set(nonLiteral)] };
}

// ---------------------------------------------------------------------------
// Specifier resolver + boundary profile (net-new, BonkLM-specific).
// ---------------------------------------------------------------------------

/**
 * The package-name key of a BARE specifier: the scoped `@scope/name` (first two
 * segments) or the unscoped `name` (first segment). Returns null for relative
 * (`.`/`..`) or `node:` specifiers, which are not bare package names.
 */
export function packageNameOfSpecifier(spec) {
  if (spec.startsWith('.') || spec.startsWith('node:')) return null;
  const segments = spec.split('/');
  if (spec.startsWith('@')) {
    return segments.length >= 2 ? `${segments[0]}/${segments[1]}` : spec;
  }
  return segments[0];
}

/**
 * The index record of the package whose directory CONTAINS `absPath` (longest
 * `absDir` prefix), or null if the path is outside every package dir. Indexed
 * packages do not nest, so at most one matches; longest-prefix is a safe tie-break
 * regardless. The `+ sep` guard prevents `…/core` from matching `…/core-ee`.
 */
export function packageContaining(list, absPath) {
  let best = null;
  for (const p of list) {
    if (absPath === p.absDir || absPath.startsWith(p.absDir + sep)) {
      if (best === null || p.absDir.length > best.absDir.length) best = p;
    }
  }
  return best;
}

/**
 * Resolve an import specifier to the workspace package it targets.
 *   - relative (`./`, `../`) → resolved against the importing file's dir, then
 *     mapped to the package whose dir contains it (`{ kind:'package', pkg }`), or
 *     `{ kind:'unresolved' }` if it lands outside every package dir.
 *   - bare `@scope/name[/sub]` or `name[/sub]` → the index record if known,
 *     else `{ kind:'external' }` (a real npm dependency).
 *   - `node:` builtins → `{ kind:'external' }`.
 */
export function resolveSpecifierToPackage(spec, fromFileAbs, index) {
  if (spec.startsWith('.')) {
    const abs = resolve(dirname(fromFileAbs), spec);
    const pkg = packageContaining(index.list, abs);
    return pkg ? { kind: 'package', pkg } : { kind: 'unresolved' };
  }
  if (spec.startsWith('node:')) return { kind: 'external' };
  // `spec` is a bare specifier here (relative + `node:` returned above), so
  // packageNameOfSpecifier never returns null.
  const pkg = index.byName.get(packageNameOfSpecifier(spec));
  return pkg ? { kind: 'package', pkg } : { kind: 'external' };
}

/**
 * Classify a single import edge from `fromPkg`'s file. Returns a violation object
 * when an OSS package imports an EE package, else null (external, unresolved,
 * intra-package, or an OSS→OSS edge — none of which is a license-boundary break).
 */
export function classifyEdge({ spec, fromPkg, fromFileAbs, index }) {
  const r = resolveSpecifierToPackage(spec, fromFileAbs, index);
  if (r.kind !== 'package') return null; // external / unresolved — not a workspace edge
  if (r.pkg.dir === fromPkg.dir) return null; // intra-package import — fine
  if (fromPkg.tier === 'oss' && r.pkg.tier === 'ee') {
    return { from: fromPkg.name, fromDir: fromPkg.dir, target: r.pkg.name, spec, kind: 'oss-imports-ee' };
  }
  return null;
}

/**
 * Compute every OSS→EE DECLARED-DEPENDENCY violation: an OSS package whose
 * package.json names an EE package in `dependencies` / `peerDependencies` /
 * `optionalDependencies`. This complements the source-import scan — a declared
 * dependency drags the EE package into `pnpm install` even with no source
 * `import`, breaking the "builds with `packages/bonklm-ee/*` absent" invariant.
 *
 * @param {{ byName: Map<string, object>, list: object[] }} index
 * @returns {object[]} violations (each `kind: 'oss-depends-ee'`, `via: 'manifest'`).
 */
export function computeDependencyViolations(index) {
  const violations = [];
  for (const pkg of index.list) {
    if (pkg.tier !== 'oss') continue;
    for (const depName of pkg.deps) {
      const target = index.byName.get(depName);
      if (target && target.tier === 'ee') {
        violations.push({
          from: pkg.name,
          fromDir: pkg.dir,
          target: target.name,
          spec: depName,
          kind: 'oss-depends-ee',
          via: 'manifest'
        });
      }
    }
  }
  return violations;
}

/**
 * Compute every OSS→EE source-import violation over the supplied OSS source files.
 *   - static + dynamic-literal edges are resolved and classified by `classifyEdge`.
 *   - a NON-literal dynamic `import()` in an OSS file is fail-closed ONLY when an
 *     EE package exists (`eeExists`): with zero ee packages the computed specifier
 *     cannot reach an ee target, so flagging it would be a false positive and
 *     break the "green on the all-Apache tree" contract; once an ee package
 *     exists the computed path cannot be proven ee-free, so it is a violation.
 *
 * @param {{ index: object, files: Array<{ pkg, fileAbs, text }>, eeExists: boolean }} input
 * @returns {object[]} violations (each carries `file` + `via`).
 */
export function computeBoundaryViolations({ index, files, eeExists }) {
  const violations = [];
  for (const { pkg, fileAbs, text } of files) {
    const masked = maskSource(text);
    for (const spec of extractStaticImports(masked)) {
      const v = classifyEdge({ spec, fromPkg: pkg, fromFileAbs: fileAbs, index });
      if (v) violations.push({ ...v, file: fileAbs, via: 'static' });
    }
    const dyn = extractDynamicImports(masked);
    for (const spec of dyn.literals) {
      const v = classifyEdge({ spec, fromPkg: pkg, fromFileAbs: fileAbs, index });
      if (v) violations.push({ ...v, file: fileAbs, via: 'dynamic' });
    }
    if (eeExists && dyn.nonLiteral.length > 0) {
      for (const sample of dyn.nonLiteral) {
        violations.push({
          from: pkg.name,
          fromDir: pkg.dir,
          target: null,
          spec: sample,
          file: fileAbs,
          via: 'dynamic',
          kind: 'dynamic-nonliteral'
        });
      }
    }
  }
  return violations;
}

/**
 * Recursively list source files under `dirAbs`, skipping `node_modules`, build
 * output, example apps, and hidden directories. Returns a sorted array of
 * absolute paths. A directory that cannot be read is skipped with a warning (it
 * is a fail-open seam — surfaced so it is observable rather than silent).
 */
export function listSourceFiles(dirAbs, { readdir = readdirSync, warn = console.warn } = {}) {
  const out = [];
  const stack = [dirAbs];
  while (stack.length > 0) {
    const cur = stack.pop();
    let entries;
    try {
      entries = readdir(cur, { withFileTypes: true });
    } catch {
      warn(
        `check-ee-boundary: skipped unreadable directory '${relative(dirAbs, cur)}' — its source was NOT scanned for EE imports.`
      );
      continue;
    }
    for (const e of entries) {
      const full = join(cur, e.name);
      if (e.isDirectory()) {
        if (WALK_SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
        stack.push(full);
      } else if (e.isFile() && isSourceFile(e.name)) {
        out.push(full);
      }
    }
  }
  return out.sort();
}

// ---------------------------------------------------------------------------
// Orchestration + CLI.
// ---------------------------------------------------------------------------

/**
 * Run both boundary facets: build the package index (license classifier) and
 * compute OSS→EE violations — declared-dependency edges plus source-import edges
 * over every OSS package's source tree. Paths and the fs helpers are injectable
 * for testing; production callers pass nothing.
 *
 * @returns {{ ok, licenseErrors, violations, packagesDir, packageCount, ossCount, eeCount }}
 */
export function checkEeBoundary({ packagesDir, readSource, listFiles } = {}) {
  const dir = packagesDir ?? PACKAGES_DIR;
  const read = readSource ?? (p => readFileSync(p, 'utf-8'));
  const list = listFiles ?? listSourceFiles;

  const index = buildPackageIndex(dir);
  const eeExists = index.list.some(p => p.tier === 'ee');
  const ossPackages = index.list.filter(p => p.tier === 'oss');

  const files = [];
  for (const pkg of ossPackages) {
    for (const fileAbs of list(pkg.absDir)) {
      files.push({ pkg, fileAbs, text: read(fileAbs) });
    }
  }

  const violations = [...computeDependencyViolations(index), ...computeBoundaryViolations({ index, files, eeExists })];
  return {
    ok: index.errors.length === 0 && violations.length === 0,
    licenseErrors: index.errors,
    violations,
    packagesDir: dir,
    packageCount: index.list.length,
    ossCount: ossPackages.length,
    eeCount: index.list.filter(p => p.tier === 'ee').length
  };
}

/** Render a human-readable failure report from a `checkEeBoundary` result. */
export function formatFailure(result) {
  const rootOf = dirname(result.packagesDir);
  const rel = p => relative(rootOf, p);
  const lines = ['EE license-boundary check failed.'];

  if (result.licenseErrors.length > 0) {
    lines.push(
      '',
      `  UNCLASSIFIABLE packages (every packages/* manifest must declare a recognized license — Apache-2.0=OSS, BUSL-1.1=EE): ${result.licenseErrors.length}`
    );
    for (const e of result.licenseErrors) {
      const lic = e.license === null ? '<none>' : JSON.stringify(e.license);
      const named = e.name ? ` name: ${e.name},` : '';
      lines.push(`    - packages/${e.dir}:${named} ${e.reason} (license: ${lic})`);
    }
  }

  if (result.violations.length > 0) {
    lines.push(
      '',
      `  OSS→EE boundary violations (an Apache package must not depend on a BSL/EE package): ${result.violations.length}`
    );
    for (const v of result.violations) {
      if (v.kind === 'dynamic-nonliteral') {
        lines.push(
          `    - ${rel(v.file)}: OSS package ${v.from} has a non-literal dynamic import() that cannot be proven not to reach the EE tier — \`${v.spec}\``
        );
      } else if (v.kind === 'oss-depends-ee') {
        lines.push(
          `    - packages/${v.fromDir}/package.json: OSS package ${v.from} declares EE package ${v.target} as a dependency — \`${v.spec}\``
        );
      } else {
        lines.push(
          `    - ${rel(v.file)}: OSS package ${v.from} imports EE package ${v.target} (${v.via}) — \`${v.spec}\``
        );
      }
    }
  }

  lines.push(
    '',
    'Fix: an Apache-2.0 (OSS) package MUST NOT depend on a BUSL-1.1 (EE) package.',
    'Move the shared code into an OSS package, or expose an extension point the EE',
    'package registers into (the open core never names a Pro package). See',
    'docs/contributing/adr/0007-ee-license-boundary-guard.md.'
  );
  return lines.join('\n');
}

/**
 * CLI body: run the check, print, and exit non-zero on any failure. Paths are
 * injectable for testing; production callers pass nothing.
 */
export function main(opts) {
  const result = checkEeBoundary(opts);
  if (result.ok) {
    console.log(
      `check-ee-boundary: ${result.packageCount} package(s) classified ` +
        `(${result.ossCount} OSS, ${result.eeCount} EE); no OSS→EE boundary violations.`
    );
    return result;
  }
  console.error(`\n${formatFailure(result)}\n`);
  process.exit(1);
}

/**
 * Invoke `main` only when this file is executed directly (node tools/...), not
 * when imported by the test suite. Returns true if it ran as the entrypoint.
 * `run`/`exit` are injectable so the entrypoint + error paths are unit-testable
 * without spawning a process. Wrapping `run` in try/catch turns a malformed
 * manifest (parse error in readJson) into a controlled exit + clear diagnostic
 * rather than an uncaught-exception stack trace.
 */
export function runCli({ argv1, scriptUrl, run = main, exit = process.exit }) {
  if (argv1 !== fileURLToPath(scriptUrl)) return false;
  try {
    run();
  } catch (err) {
    console.error('\ncheck-ee-boundary: aborted on error:');
    console.error(`  ${err instanceof Error ? err.message : String(err)}`);
    exit(1);
  }
  return true;
}

runCli({ argv1: process.argv[1], scriptUrl: import.meta.url });
