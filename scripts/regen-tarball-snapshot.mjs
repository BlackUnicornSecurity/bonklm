#!/usr/bin/env node
/**
 * Regenerate per-connector tarball-drift snapshots (ST-04-300 … ST-04-351).
 *
 * Writes `<package>/tests/tarball-snapshot.txt` — the sorted list of files
 * `npm pack` would publish — for each package that has a
 * `tests/tarball-drift.test.ts`. Run AFTER `pnpm build` so the snapshot
 * reflects the freshly-built `dist/` (it is gitignored and absent otherwise).
 *
 * Uses the exact invocation the drift test uses (`npm pack --dry-run --json`
 * from the package directory) so a regenerated snapshot is byte-identical to
 * what the test computes.
 *
 * Usage:
 *   pnpm build                                                  # refresh dist first
 *   node scripts/regen-tarball-snapshot.mjs                     # all drift-tested packages
 *   node scripts/regen-tarball-snapshot.mjs packages/anthropic-connector  # one package
 *
 * An intentional change to a shipped file set must be reviewer-approved.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function packagesWithDriftTest() {
  const packagesDir = path.join(repoRoot, 'packages');
  return readdirSync(packagesDir)
    .map(name => path.join(packagesDir, name))
    .filter(dir => existsSync(path.join(dir, 'tests', 'tarball-drift.test.ts')));
}

function packedFileList(packageRoot) {
  // No positional package arg: npm packs the cwd. Passing a path makes npm
  // (inside the pnpm workspace) treat it as a package spec and attempt a git
  // resolve. `--loglevel=error` keeps stdout pure JSON and silences notices.
  const stdout = execFileSync('npm', ['pack', '--dry-run', '--json', '--loglevel=error'], {
    cwd: packageRoot,
    encoding: 'utf8'
  });
  const report = JSON.parse(stdout);
  return report[0].files.map(entry => entry.path).sort();
}

const args = process.argv.slice(2).map(arg => path.resolve(repoRoot, arg));
const packageRoots = args.length > 0 ? args : packagesWithDriftTest();

for (const packageRoot of packageRoots) {
  const snapshotPath = path.join(packageRoot, 'tests', 'tarball-snapshot.txt');
  const files = packedFileList(packageRoot);
  writeFileSync(snapshotPath, `${files.join('\n')}\n`);
  console.log(`${path.relative(repoRoot, snapshotPath)} (${files.length} files)`);
}
