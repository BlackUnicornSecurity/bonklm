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
  // dist/ is gitignored and absent until `pnpm build`. Fail loudly rather than
  // silently writing a snapshot that omits the (unbuilt) dist files.
  if (!existsSync(path.join(packageRoot, 'dist'))) {
    throw new Error(`dist/ missing in ${packageRoot} — run \`pnpm build\` before regenerating snapshots.`);
  }
  // No positional package arg: npm packs the cwd. Passing a path makes npm
  // (inside the pnpm workspace) treat it as a package spec and attempt a git
  // resolve. `--loglevel=error` keeps stdout pure JSON and silences notices.
  const stdout = execFileSync('npm', ['pack', '--dry-run', '--json', '--loglevel=error'], {
    cwd: packageRoot,
    encoding: 'utf8'
  });
  const report = JSON.parse(stdout);
  const files = report[0]?.files;
  if (!Array.isArray(files)) {
    throw new Error(`Unexpected \`npm pack --json\` output for ${packageRoot}: ${stdout.slice(0, 300)}`);
  }
  return files.map(entry => entry.path).sort();
}

const packagesDir = path.join(repoRoot, 'packages');
const args = process.argv.slice(2).map(arg => path.resolve(repoRoot, arg));
const packageRoots = args.length > 0 ? args : packagesWithDriftTest();

for (const packageRoot of packageRoots) {
  // Containment guard: only ever write a snapshot inside packages/<pkg>. A
  // user-supplied path arg is resolved against the repo root, so refuse any
  // target that escapes packages/ before touching the filesystem.
  if (!packageRoot.startsWith(packagesDir + path.sep)) {
    throw new Error(`Refusing to write outside packages/: ${packageRoot}`);
  }
  const snapshotPath = path.join(packageRoot, 'tests', 'tarball-snapshot.txt');
  const files = packedFileList(packageRoot);
  writeFileSync(snapshotPath, `${files.join('\n')}\n`);
  console.log(`${path.relative(repoRoot, snapshotPath)} (${files.length} files)`);
}
