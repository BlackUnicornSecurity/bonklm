/**
 * Tarball-drift snapshot test — `@blackunicorn/bonklm-vercel` (ST-04-309).
 *
 * Locks the exact set of files `npm pack` would publish for this connector
 * against the committed `tarball-snapshot.txt`. A file added to or removed from
 * the shipped tarball (a stray dist artifact, a dropped declaration file, an
 * edited `files` whitelist) fails this test — catching packaging drift across
 * the rc.4 -> v1.0.0 window before it reaches npm.
 *
 * Mechanism: `npm pack --dry-run --json` reports the publishable file set
 * without writing a tarball. We compare the sorted path list only; file sizes
 * are intentionally ignored — this tracks file additions/removals, not byte
 * changes, mirroring `tar tf`.
 *
 * Runs ONLY via the post-build `pnpm test:pack` step (vitest.pack.config.ts),
 * never the main `pnpm test` pass: the file set reflects the built `dist/`,
 * which is gitignored and absent until `pnpm build`. The root
 * `vitest.config.ts` excludes these tests from that pass.
 *
 * Intentional change? Rebuild, regenerate, and get the diff reviewer-approved:
 *   pnpm build && node scripts/regen-tarball-snapshot.mjs packages/vercel-connector
 * See `docs/contributing/tarball-drift.md`.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(testDir, '..');
const snapshotPath = path.join(testDir, 'tarball-snapshot.txt');

function packedFileList(): string[] {
  // No positional package arg: npm packs the cwd. Passing a path here makes npm
  // (inside the pnpm workspace) treat it as a package spec and attempt a git
  // resolve. `--loglevel=error` keeps stdout pure JSON and silences workspace
  // notices so the parse and the CI log stay clean.
  const stdout = execFileSync('npm', ['pack', '--dry-run', '--json', '--loglevel=error'], {
    cwd: packageRoot,
    encoding: 'utf8'
  });
  const report = JSON.parse(stdout) as Array<{ files: Array<{ path: string }> }>;
  return report[0].files.map(entry => entry.path).sort();
}

function snapshotFileList(): string[] {
  return readFileSync(snapshotPath, 'utf8')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .sort();
}

describe('tarball drift — @blackunicorn/bonklm-vercel', () => {
  it('publishes exactly the snapshotted file set', () => {
    expect(packedFileList()).toEqual(snapshotFileList());
  });
});
