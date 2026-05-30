/**
 * Tarball-drift snapshot test — `@blackunicorn/bonklm-stagehand` (ST-04-332).
 *
 * Locks the exact set of files `npm pack` would publish for this package
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
 *   pnpm build && node scripts/regen-tarball-snapshot.mjs packages/stagehand-connector
 * See `docs/contributing/tarball-drift.md`.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(testDir, '..');
const snapshotPath = path.join(testDir, 'tarball-snapshot.txt');

function packedFileList(): string[] {
  // dist/ is gitignored and absent until `pnpm build`. Fail loudly with the fix
  // rather than as a confusing "snapshot has dist files, actual has none" diff.
  if (!existsSync(path.join(packageRoot, 'dist'))) {
    throw new Error(`dist/ missing in ${packageRoot} — run \`pnpm build\` before \`pnpm test:pack\`.`);
  }
  // No positional package arg: npm packs the cwd. A path arg makes npm (inside
  // the pnpm workspace) treat it as a package spec and attempt a git resolve.
  // `--loglevel=error` keeps stdout pure JSON and silences workspace notices.
  const stdout = execFileSync('npm', ['pack', '--dry-run', '--json', '--loglevel=error'], {
    cwd: packageRoot,
    encoding: 'utf8'
  });
  const report = JSON.parse(stdout) as Array<{ files?: Array<{ path: string }> }>;
  const files = report[0]?.files;
  if (!Array.isArray(files)) {
    throw new Error(`Unexpected \`npm pack --json\` output: ${stdout.slice(0, 300)}`);
  }
  return files.map(entry => entry.path).sort();
}

function snapshotFileList(): string[] {
  return readFileSync(snapshotPath, 'utf8')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .sort();
}

describe('tarball drift — @blackunicorn/bonklm-stagehand', () => {
  it('publishes exactly the snapshotted file set', () => {
    const packed = packedFileList();
    // Floor guards against a silently-empty pack: LICENSE + README + package.json + >=1 dist file.
    expect(packed.length).toBeGreaterThan(3);
    expect(packed).toEqual(snapshotFileList());
  });
});
