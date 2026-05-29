# Tarball-drift snapshot tests

Each published connector ships a `tests/tarball-drift.test.ts` that locks the exact set of files
`npm pack` would publish against a committed `tests/tarball-snapshot.txt` (stories ST-04-300 …
ST-04-351). The test fails if a file is added to or removed from the shipped tarball — catching
accidental packaging drift (a stray build artifact, a dropped declaration file, an edited `files`
whitelist) before it reaches npm.

## How it runs

The snapshot reflects each package's built `dist/`, which is gitignored and absent until
`pnpm build`. So these tests do **not** run in the main `pnpm test` pass (which the local quality
gate runs before `build`). They run as a dedicated post-build step:

```bash
pnpm build
pnpm test:pack
```

`pnpm test:pack` uses `vitest.pack.config.ts`; the main `vitest.config.ts` excludes
`tarball-drift.test.ts`. CI runs the same in the **Tarball Drift** job (build → `pnpm test:pack`),
and the local `pnpm quality-gate` runs it immediately after the build step.

## What it asserts

`npm pack --dry-run --json` reports the publishable file set without writing a tarball. The test
compares the **sorted list of file paths** — sizes are ignored on purpose, so the test tracks file
additions/removals (like `tar tf`), not byte-level content changes.

## Updating a snapshot (intentional change)

When you intentionally change a package's shipped file set (e.g. add an entry point, split a
module), regenerate its snapshot and include the diff in your PR for review:

```bash
pnpm build
node scripts/regen-tarball-snapshot.mjs packages/<connector>
```

Run with no arguments to regenerate every drift-tested package. A snapshot diff must be
reviewer-approved — an unexplained change is exactly the drift these tests exist to catch.
