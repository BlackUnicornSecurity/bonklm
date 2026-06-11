#!/usr/bin/env node
/**
 * tools/check-changeset-linked.js
 * ===============================
 *
 * Enforce that the changesets `linked` group in `.changeset/config.json`
 * always equals the set of publishable `packages/*` manifests (those whose
 * `private` is not strictly `true`).
 *
 * The `linked` array was hand-curated and silently drifted stale as new
 * connectors landed (21 names listed while 52 packages were publishable), so
 * per CONTRIBUTING.md's "documented -> enforced" doctrine the regenerate-by-
 * hand instruction is now a CI gate. A green run proves the publishable surface
 * and the linked group are identical; drift fails the build with a clear diff.
 *
 * Publishable set (mirrors the CONTRIBUTING.md regen command, but with a robust
 * `private !== true` test rather than a substring grep):
 *   every `packages/*\/package.json` declaring a non-empty string `name` whose
 *   `private` is not `true`. The two private manifests
 *   (@blackunicorn/bonklm-openclaw, @blackunicorn/bonklm-wizard) are excluded.
 *   `tools/*` packages are governed by tools/WORKSPACE-POLICY.md and are NOT
 *   part of this linked family even when Tier-B publishable
 *   (e.g. @blackunicorn/eslint-plugin-edge) — they live outside `packages/*`.
 *   Scope note: this gate deliberately checks only the `packages/*` linked
 *   family. A Tier-B `tools/*` package's own publishability is a separate
 *   concern owned by tools/WORKSPACE-POLICY.md, not this gate.
 *
 * Failure -> exit 1 with a missing/extra diff.
 *
 * Usage:
 *   node tools/check-changeset-linked.js
 *
 * Wired into CI as `pnpm run check:changeset-linked` (root scripts) and the
 * local quality gate (scripts/quality-gate.sh).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGES_DIR = join(ROOT, 'packages');
const CHANGESET_CONFIG = join(ROOT, '.changeset', 'config.json');

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

/**
 * Derive the publishable package set from `packagesDir`: every
 * `<dir>/package.json` declaring a non-empty string `name` whose `private` is
 * not strictly `true`. Returns a sorted array of package names.
 */
export function derivePublishableSet(packagesDir) {
  if (!existsSync(packagesDir)) return [];
  const names = [];
  // Skip non-directory entries (e.g. a stray `.DS_Store`) so they are never
  // probed for a package.json. Dirent.isDirectory() does not follow symlinks,
  // which is correct here — packages/* are real directories.
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const pkg = readJson(join(packagesDir, entry.name, 'package.json'));
    if (pkg === null) continue;
    if (pkg.private === true) continue;
    if (typeof pkg.name !== 'string' || pkg.name.length === 0) continue;
    names.push(pkg.name);
  }
  return names.sort();
}

/**
 * Read the first `linked` group from a changesets config. Returns [] when the
 * config is absent, `linked` is missing/empty, or its first entry is not an
 * array. The BonkLM config carries exactly one linked group — the publishable
 * family (see CONTRIBUTING.md "Versioning, Changesets, and Releases").
 */
export function readLinkedGroup(changesetConfigPath) {
  const config = readJson(changesetConfigPath);
  if (config === null) return [];
  const { linked } = config;
  if (!Array.isArray(linked) || linked.length === 0) return [];
  // Fail loud rather than silently validating only linked[0]: a second linked
  // group would otherwise let stale names in linked[1..] drift unseen — the
  // exact failure class this gate exists to prevent.
  if (linked.length > 1) {
    throw new Error(
      `check-changeset-linked: .changeset/config.json declares ${linked.length} linked groups; ` +
        `this gate assumes a single publishable family (linked[0]). Reconcile the config or extend the gate.`
    );
  }
  const [group] = linked;
  return Array.isArray(group) ? group : [];
}

/**
 * Set difference between the derived publishable names and the linked group.
 *   missing — publishable but NOT linked (must be added to `linked`).
 *   extra   — linked but NOT publishable (stale; must be removed from `linked`).
 * Both arrays are sorted; an empty diff (both []) means the sets are equal.
 */
export function diffLinked(publishable, linked) {
  const linkedSet = new Set(linked);
  const publishableSet = new Set(publishable);
  const missing = publishable.filter(name => !linkedSet.has(name)).sort();
  const extra = linked.filter(name => !publishableSet.has(name)).sort();
  return { missing, extra };
}

/**
 * Orchestrate the check: derive the publishable set + linked group and diff
 * them. Paths are injectable for testing; both default to the repo locations.
 */
export function checkChangesetLinked({ packagesDir, changesetConfigPath } = {}) {
  const publishable = derivePublishableSet(packagesDir ?? PACKAGES_DIR);
  const linked = readLinkedGroup(changesetConfigPath ?? CHANGESET_CONFIG);
  const { missing, extra } = diffLinked(publishable, linked);
  return { ok: missing.length === 0 && extra.length === 0, publishable, linked, missing, extra };
}

/**
 * Render a human-readable failure report from a `checkChangesetLinked` result.
 */
export function formatFailure(result) {
  const lines = [
    'changeset `linked` group is out of sync with the publishable packages/* set.',
    `  publishable (private !== true): ${result.publishable.length}`,
    `  linked[0]:                      ${result.linked.length}`
  ];
  if (result.missing.length > 0) {
    lines.push('', `  MISSING from linked (publishable but not linked): ${result.missing.length}`);
    for (const name of result.missing) lines.push(`    + ${name}`);
  }
  if (result.extra.length > 0) {
    lines.push('', `  EXTRA in linked (linked but not publishable): ${result.extra.length}`);
    for (const name of result.extra) lines.push(`    - ${name}`);
  }
  lines.push(
    '',
    'Fix: regenerate the linked list from the publishable manifests (re-derive at',
    'HEAD, do not hand-edit) per CONTRIBUTING.md "Versioning, Changesets, and Releases".'
  );
  return lines.join('\n');
}

/**
 * CLI body: run the check, print, and exit non-zero on drift. Paths are
 * injectable for testing; production callers pass nothing.
 */
export function main(opts) {
  const result = checkChangesetLinked(opts);
  if (result.ok) {
    console.log(`check-changeset-linked: ${result.publishable.length} publishable package(s); linked group in sync.`);
    return result;
  }
  console.error(`\n${formatFailure(result)}\n`);
  process.exit(1);
}

/**
 * Invoke `main` only when this file is executed directly (node tools/...), not
 * when imported by the test suite. Returns true if it ran as the entrypoint.
 * `run`/`exit` are injectable so the entrypoint + error paths are unit-testable
 * without spawning a process.
 */
export function runCli({ argv1, scriptUrl, run = main, exit = process.exit }) {
  if (argv1 !== fileURLToPath(scriptUrl)) return false;
  try {
    run();
  } catch (err) {
    console.error('\ncheck-changeset-linked: aborted on error:');
    console.error(`  ${err instanceof Error ? err.message : String(err)}`);
    exit(1);
  }
  return true;
}

runCli({ argv1: process.argv[1], scriptUrl: import.meta.url });
