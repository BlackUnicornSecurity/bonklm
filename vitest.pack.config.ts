import { defineConfig } from 'vitest/config';

/**
 * Dedicated Vitest config for the per-connector tarball-drift snapshot tests
 * (ST-04-300 … ST-04-351), run via `pnpm test:pack` AFTER `pnpm build`.
 *
 * These tests shell out to `npm pack`, which inspects each package's built,
 * gitignored `dist/`. That directory is absent during the main `pnpm test`
 * pass — the local quality gate runs `test+coverage` BEFORE `build` — so the
 * main `vitest.config.ts` excludes `tarball-drift.test.ts` and this config is
 * their only runner.
 *
 * Deliberately minimal: no coverage (the published file set is the assertion,
 * not executed code). Each test is independent (its own `npm pack`), so running
 * them concurrently is correct; the `maxWorkers` cap below bounds resource use
 * (one npm-pack subprocess per test), not correctness.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/**/tests/tarball-drift.test.ts'],
    // Each test spawns an `npm pack` subprocess; bound concurrency so the full
    // 52-connector run does not spike memory/IO on CI runners.
    maxWorkers: 4,
    testTimeout: 60000,
    hookTimeout: 60000
  },
  esbuild: {
    target: 'node20'
  },
  // Parity with the main vitest.config.ts: a stray async error must not flip an
  // otherwise-green run to a non-zero exit (the gate keys on the exit code).
  failOnUnhandledErrors: false
});
