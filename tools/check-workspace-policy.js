#!/usr/bin/env node
/**
 * tools/check-workspace-policy.js
 * ================================
 *
 * Programmatic enforcement of the Tier A / Tier B `tools/*` policy from
 * `tools/WORKSPACE-POLICY.md`. Enforcing the contract in CI keeps the policy
 * reliable instead of depending on manual review.
 *
 * Tier A (default — internal-only):
 *   - `private: true` in package.json (prevents accidental npm publish).
 *   - NOT listed as a runtime dep in any `packages/*\/package.json`
 *     (only devDeps permitted).
 *
 * Tier B (explicit opt-in — publishable):
 *   - `workspacePolicy: 'tier-b-publishable'` declared in package.json.
 *   - `publishJustification: '<non-empty string>'` declared.
 *   - `files: [...]` array present + non-empty.
 *   - `name` starts with `@blackunicorn/`.
 *
 * Failure → CI exits 1 with a clear diagnostic.
 *
 * Usage:
 *   node tools/check-workspace-policy.js
 *
 * Wired into CI as `pnpm run check:workspace-policy` (root scripts), the
 * dependency-free `workspace-policy` job in `.github/workflows/ci.yml`, and the
 * local quality gate (`scripts/quality-gate.sh`).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isTierBPackageName } from './release-scope.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TOOLS_DIR = join(ROOT, 'tools');
const PACKAGES_DIR = join(ROOT, 'packages');

/**
 * Read + parse a JSON file. Returns null on absence; throws on parse error
 * so a malformed package.json is loud (not silently treated as Tier A).
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

/**
 * Enumerate all `tools/*` package directories under `toolsDir`. Each must
 * contain a `package.json` to be a workspace member; directories without one
 * (e.g. `tools/audit-baselines/` which is a docs dir) are skipped. The path is
 * a required argument so the suite can point at a throwaway fixture; the
 * default repo `tools/` directory is supplied by `checkWorkspacePolicy`.
 */
export function enumerateToolPackages(toolsDir) {
  if (!existsSync(toolsDir)) return [];
  const paths = [];
  // Skip dotfiles and non-directory entries (e.g. this script itself, a stray
  // `.DS_Store`, or `WORKSPACE-POLICY.md`) so they are never probed for a
  // package.json. Dirent.isDirectory() does not follow symlinks, which is
  // correct here — tools/* are real directories.
  for (const entry of readdirSync(toolsDir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    if (!entry.isDirectory()) continue;
    const pkgPath = join(toolsDir, entry.name);
    if (existsSync(join(pkgPath, 'package.json'))) paths.push(pkgPath);
  }
  return paths;
}

/**
 * Validate a single `tools/<name>/package.json` against Tier A or
 * Tier B requirements. Returns `{ tier, name, violations }` — `violations`
 * is an array of message strings (empty = clean).
 */
export function validateToolsPackage(pkgPath) {
  const pkgJsonPath = join(pkgPath, 'package.json');
  const pkg = readJson(pkgJsonPath);
  const violations = [];

  // Defensive null-guard against TOCTOU between enumerateToolPackages's
  // existsSync probe and this readJson call. If the file vanished
  // between checks, surface a precise diagnostic rather than letting
  // a later property access raise an opaque TypeError. Treated as
  // Tier A with no name so consumer-link validation skips it.
  if (pkg === null) {
    return {
      tier: 'A',
      name: undefined,
      violations: [`${pkgJsonPath}: package.json missing or unreadable.`]
    };
  }

  const tier = pkg.workspacePolicy === 'tier-b-publishable' ? 'B' : 'A';

  if (tier === 'A') {
    // Tier A: MUST be private.
    if (pkg.private !== true) {
      violations.push(
        `${pkgJsonPath}: Tier A package missing \`"private": true\`. ` +
          `Either set \`"private": true\` (Tier A — internal-only) OR add ` +
          `\`"workspacePolicy": "tier-b-publishable"\` + the Tier B fields.`
      );
    }
  } else {
    // Tier B: MUST have publishJustification + non-empty files + scoped name.
    if (typeof pkg.publishJustification !== 'string' || pkg.publishJustification.length === 0) {
      violations.push(
        `${pkgJsonPath}: Tier B package missing \`"publishJustification": "<non-empty string>"\`. ` +
          `Explain why this package ships to npm.`
      );
    }
    if (!Array.isArray(pkg.files) || pkg.files.length === 0) {
      violations.push(
        `${pkgJsonPath}: Tier B package missing \`"files": [...]\` enumerating published assets. ` +
          `Internal-only assets (allowlists, fixtures) MUST be excluded.`
      );
    }
    if (!isTierBPackageName(pkg.name)) {
      violations.push(
        `${pkgJsonPath}: Tier B package name MUST start with \`@blackunicorn/\` and use a ` +
          `release-compatible lowercase kebab name (got: ${JSON.stringify(pkg.name)}).`
      );
    }
    if (pkg.private === true) {
      violations.push(
        `${pkgJsonPath}: Tier B package has BOTH \`"private": true\` AND \`workspacePolicy: 'tier-b-publishable'\` — contradictory.`
      );
    }
    const baseFieldsValid =
      typeof pkg.publishJustification === 'string' &&
      pkg.publishJustification.length > 0 &&
      Array.isArray(pkg.files) &&
      pkg.files.length > 0 &&
      isTierBPackageName(pkg.name) &&
      pkg.private !== true;
    const expectedDirectory = `tools/${basename(pkgPath)}`;
    if (
      baseFieldsValid &&
      (pkg.repository?.type !== 'git' ||
        pkg.repository?.url !== 'git+https://github.com/BlackUnicornSecurity/bonklm.git' ||
        pkg.repository?.directory !== expectedDirectory)
    ) {
      violations.push(`${pkgJsonPath}: Tier B package repository metadata must identify ${expectedDirectory}.`);
    }
  }

  return { tier, name: pkg.name, violations };
}

/**
 * Walk every `<packagesDir>/*\/package.json` and verify no Tier A
 * `tools/*` package is listed as a runtime `dependencies`,
 * `peerDependencies`, or `optionalDependencies` — only `devDependencies`
 * permitted. `toolsByName` maps tool package name → `{ tier }`. The path is a
 * required argument for testing; the default repo `packages/` directory is
 * supplied by `checkWorkspacePolicy`.
 */
export function validateConsumerLinks(toolsByName, packagesDir) {
  const violations = [];
  if (!existsSync(packagesDir)) return violations;

  // Scope is deliberately the top level only (`packages/<dir>/package.json`),
  // matching WORKSPACE-POLICY.md's `packages/*/package.json` glob and the
  // CONTRIBUTING publishable-surface convention (`! -path '*/examples/*'`).
  // Nested manifests (`packages/<dir>/examples/*`) are private, never-published
  // example apps, so a Tier A tool reaching one cannot leak to npm consumers.
  for (const pkgDir of readdirSync(packagesDir)) {
    const pkgJsonPath = join(packagesDir, pkgDir, 'package.json');
    const pkg = readJson(pkgJsonPath);
    if (pkg === null) continue;
    // optionalDependencies are ALSO published in the npm tarball's
    // dependency metadata and trigger consumer install attempts.
    // Bundle them with the strict-deps list so a Tier A tool name
    // can't leak into the published surface via this field.
    for (const depField of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
      const deps = pkg[depField] ?? {};
      for (const depName of Object.keys(deps)) {
        const toolMeta = toolsByName.get(depName);
        if (toolMeta !== undefined && toolMeta.tier === 'A') {
          violations.push(
            `${pkgJsonPath}: Tier A tool \`${depName}\` listed as ${depField}. ` +
              `Tier A tools may ONLY be referenced as devDependencies. Move ` +
              `to devDependencies OR convert the tool to Tier B with publishJustification.`
          );
        }
      }
    }
  }
  return violations;
}

/**
 * Orchestrate the check: enumerate `tools/*` packages, validate each against
 * its tier, then assert no Tier A tool leaks into a consumer's runtime deps.
 * Paths are injectable for testing; both default to the repo locations.
 * Returns `{ ok, toolCount, checkedCount, violations }` — `toolCount` is the
 * number of `tools/*` package dirs found, `checkedCount` the number with a
 * usable `name`.
 */
export function checkWorkspacePolicy({ toolsDir, packagesDir } = {}) {
  const toolPaths = enumerateToolPackages(toolsDir ?? TOOLS_DIR);
  const toolsByName = new Map();
  const violations = [];

  for (const path of toolPaths) {
    const result = validateToolsPackage(path);
    if (result.name !== undefined) {
      toolsByName.set(result.name, { tier: result.tier });
    }
    violations.push(...result.violations);
  }

  violations.push(...validateConsumerLinks(toolsByName, packagesDir ?? PACKAGES_DIR));

  return {
    ok: violations.length === 0,
    toolCount: toolPaths.length,
    checkedCount: toolsByName.size,
    violations
  };
}

/**
 * CLI body: run the check, print a result line, and exit non-zero on any
 * violation. Paths are injectable for testing; production callers pass nothing.
 */
export function main(opts) {
  const result = checkWorkspacePolicy(opts);

  if (result.toolCount === 0) {
    console.log('check-workspace-policy: no tools/* packages found; nothing to check.');
    return result;
  }

  if (result.ok) {
    console.log(`check-workspace-policy: ${result.checkedCount} tools/* package(s) checked; all compliant.`);
    return result;
  }

  // Terminal branch: end on process.exit(1) so there is no fall-through to the
  // success log when `exit` is stubbed in a unit test, and no unreachable tail.
  console.error('\nWorkspace-policy violations:\n');
  for (const v of result.violations) console.error(`  - ${v}`);
  console.error(`\n${result.violations.length} violation(s). See tools/WORKSPACE-POLICY.md for the contract.`);
  process.exit(1);
}

/**
 * Invoke `main` only when this file is executed directly (node tools/...), not
 * when imported by the test suite. Returns true if it ran as the entrypoint.
 * `run`/`exit` are injectable so the entrypoint + error paths are unit-testable
 * without spawning a process. Wrapping `run` in try/catch turns a malformed
 * package.json (parse error in readJson) into a controlled exit + clear
 * diagnostic rather than an uncaught-exception stack trace.
 */
export function runCli({ argv1, scriptUrl, run = main, exit = process.exit }) {
  if (argv1 !== fileURLToPath(scriptUrl)) return false;
  try {
    run();
  } catch (err) {
    console.error('\nworkspace-policy: aborted on error:');
    console.error(`  ${err instanceof Error ? err.message : String(err)}`);
    exit(1);
  }
  return true;
}

runCli({ argv1: process.argv[1], scriptUrl: import.meta.url });
