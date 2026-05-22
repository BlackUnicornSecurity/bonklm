#!/usr/bin/env node
/**
 * tools/check-workspace-policy.js
 * ================================
 *
 * Story 2.1b iter-3 adversarial BLOCK-ADV-2: programmatic enforcement
 * of the Tier A / Tier B `tools/*` policy from `tools/WORKSPACE-POLICY.md`.
 * Self-attestation collapses to reviewer fatigue under single-maintainer
 * reality; this script enforces the contract at CI.
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
 * Wire into CI as `pnpm run check:workspace-policy` (root scripts).
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TOOLS_DIR = join(ROOT, 'tools');
const PACKAGES_DIR = join(ROOT, 'packages');

/**
 * Read + parse a JSON file. Returns null on absence; throws on parse error
 * so a malformed package.json is loud (not silently treated as Tier A).
 */
function readJson(path) {
  if (!existsSync(path)) return null;
  const text = readFileSync(path, 'utf-8');
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`Failed to parse ${path}: ${err.message}`);
  }
}

/**
 * Enumerate all `tools/*` package directories. Each must contain a
 * `package.json` to be a workspace member; directories without one
 * (e.g. `tools/audit-baselines/` which is a docs dir) are skipped.
 */
function enumerateToolPackages() {
  if (!existsSync(TOOLS_DIR)) return [];
  return readdirSync(TOOLS_DIR)
    .filter((name) => !name.startsWith('.'))
    .map((name) => join(TOOLS_DIR, name))
    .filter((path) => {
      try {
        return statSync(path).isDirectory() && existsSync(join(path, 'package.json'));
      } catch {
        return false;
      }
    });
}

/**
 * Validate a single `tools/<name>/package.json` against Tier A or
 * Tier B requirements. Returns an array of violation messages
 * (empty = clean).
 */
function validateToolsPackage(pkgPath) {
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
      violations: [`${pkgJsonPath}: package.json missing or unreadable.`],
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
    if (typeof pkg.name !== 'string' || !pkg.name.startsWith('@blackunicorn/')) {
      violations.push(
        `${pkgJsonPath}: Tier B package name MUST start with \`@blackunicorn/\` (got: ${JSON.stringify(pkg.name)}).`
      );
    }
    if (pkg.private === true) {
      violations.push(
        `${pkgJsonPath}: Tier B package has BOTH \`"private": true\` AND \`workspacePolicy: 'tier-b-publishable'\` — contradictory.`
      );
    }
  }

  return { tier, name: pkg.name, violations };
}

/**
 * Walk every `packages/*\/package.json` and verify no Tier A
 * `tools/*` package is listed as runtime `dependencies` or
 * `peerDependencies` — only `devDependencies` permitted.
 */
function validateConsumerLinks(toolsByName) {
  const violations = [];
  if (!existsSync(PACKAGES_DIR)) return violations;

  for (const pkgDir of readdirSync(PACKAGES_DIR)) {
    const pkgJsonPath = join(PACKAGES_DIR, pkgDir, 'package.json');
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

function main() {
  const toolPaths = enumerateToolPackages();
  if (toolPaths.length === 0) {
    console.log('check-workspace-policy: no tools/* packages found; nothing to check.');
    return;
  }

  const allViolations = [];
  const toolsByName = new Map();

  for (const path of toolPaths) {
    const result = validateToolsPackage(path);
    if (result.name !== undefined) {
      toolsByName.set(result.name, { tier: result.tier });
    }
    allViolations.push(...result.violations);
  }

  allViolations.push(...validateConsumerLinks(toolsByName));

  if (allViolations.length > 0) {
    console.error('\nWorkspace-policy violations:\n');
    for (const v of allViolations) console.error(`  - ${v}`);
    console.error(`\n${allViolations.length} violation(s). See tools/WORKSPACE-POLICY.md for the contract.`);
    process.exit(1);
  }

  console.log(`check-workspace-policy: ${toolsByName.size} tools/* package(s) checked; all compliant.`);
}

// Wrap in try/catch so malformed package.json (parse error in readJson)
// produces a controlled exit code + clear diagnostic rather than an
// uncaught-exception stack trace. Defensive: review-BLOCK-O.
try {
  main();
} catch (err) {
  console.error('\nworkspace-policy: aborted on error:');
  console.error(`  ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
