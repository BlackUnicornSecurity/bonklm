# Tarball-drift snapshot tests

Connectors covered by the Gate-4 drift rollout ship a `tests/tarball-drift.test.ts` that locks the
exact set of files `npm pack` would publish against a committed `tests/tarball-snapshot.txt`. The
test fails if a file is added to or removed from the shipped tarball — catching accidental packaging
drift (a stray build artifact, a dropped declaration file, an edited `files` whitelist) before it
reaches npm.

The rollout was staged across release-surface package batches and is now complete — every package in
the batch ships a drift test.

## How it runs

The snapshot reflects each package's built `dist/`, which is gitignored and absent until
`pnpm build`. So these tests do **not** run in the main `pnpm test` pass. They run as a dedicated
post-build step:

```bash
pnpm build
pnpm test:pack
```

`pnpm test:pack` uses `vitest.pack.config.ts`; the main `vitest.config.ts` excludes
`tarball-drift.test.ts`. CI runs the same in the **Tarball Drift** job (build → `pnpm test:pack`),
and the local `pnpm quality-gate` runs it as a post-build gate.

## What it asserts

`npm pack --dry-run --json` reports the publishable file set without writing a tarball. The test
compares the **sorted list of file paths** — sizes are ignored on purpose, so the test tracks file
additions/removals (like `tar tf`), not byte-level content changes.

## What it does NOT catch

By design this is a _path-set_ guard, not a content-integrity check:

- **File contents / sizes.** A file that is published but empty, truncated, stale, or semantically
  wrong is invisible here — its path is unchanged. Content is guarded elsewhere: `pnpm build` must
  compile cleanly, and the per-package `tsd` type-surface suites (`pnpm test:types`) lock the
  published `.d.ts` API.
- **Removing `README.md` / `LICENSE` from `files`.** npm force-includes `README*` and `LICENSE*`
  regardless of the `files` whitelist, so dropping them from `files` does not change the packed set.
  The `files` entry this test effectively guards is `dist`.

Follow-up (not yet implemented): a per-file `size > 0` tripwire and/or snapshotting the
`npm pack --json` SRI `integrity` hashes would extend this to empty-artifact and content drift.

## Adding drift coverage to a new connector

1. Copy an existing `tests/tarball-drift.test.ts` into the new package; update the package name in
   the docstring (including the `regen-tarball-snapshot.mjs packages/<connector>` example line), the
   `describe` title, and the story ID (`ST-04-3NN`).
2. `pnpm build`, then `node scripts/regen-tarball-snapshot.mjs packages/<connector>` to create its
   `tests/tarball-snapshot.txt`.

Both the runner (the `vitest.pack.config.ts` glob) and the regen script auto-discover the new file —
no central registry or config change is needed.

## Updating a snapshot (intentional change)

When you intentionally change a package's shipped file set (e.g. add an entry point, split a
module), regenerate its snapshot and include the diff in your PR for review:

```bash
pnpm build
node scripts/regen-tarball-snapshot.mjs packages/<connector>
```

Run with no arguments to regenerate every drift-tested package. Regenerate under the same Node major
the CI `tarball-drift` job uses, so the recorded file set matches that job. A snapshot diff must be
reviewer-approved — an unexplained change is exactly the drift these tests exist to catch.
