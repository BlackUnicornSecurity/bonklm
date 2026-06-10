import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

// Self-contained config for the local-harness validator suite. Invoked from the
// repo root via `pnpm exec vitest run --config .claude/validators-node/vitest.config.js`
// (the subtree is excluded from the root tsconfig/vitest and the pnpm workspace, so
// it is validated by its own toolchain — same pattern as tools/eslint-plugin-bonklm-edge).
export default defineConfig({
  root,
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.js'],
    coverage: {
      provider: 'istanbul',
      // lib/** holds all logic and is held to 100%. bin/** are 3-line shims that
      // wire a lib validator to the hook runner; they carry no logic and are proven
      // end-to-end by the spawn-based integration tests in test/bin.test.js (child
      // processes are not counted by istanbul, hence excluded from the % — the root
      // tsconfig likewise excludes **/bin/**).
      include: ['lib/**/*.js'],
      // run-hook.js is the sole process boundary (fd-0 read + process.exit) and is
      // proven by the spawn-based bin integration tests, not unit coverage.
      exclude: ['bin/**', 'test/**', 'vitest.config.js', 'lib/run-hook.js'],
      all: true,
      reporter: ['text', 'json-summary'],
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100,
      },
    },
  },
});
