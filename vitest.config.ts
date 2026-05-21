import { defineConfig } from 'vitest/config';
import path from 'path';
import fs from 'fs';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/**/*.test.ts'],
    exclude: [
      'node_modules/**',
      'dist/**',
      '**/node_modules/**',
      'team/backups/**',
      // Reference directory — external openclaw reference, has missing peer deps
      'reference/**',
    ],
    coverage: {
      provider: 'istanbul',
      reporter: ['text', 'json', 'html', 'json-summary'],
      include: [
        'packages/core/src/**/*.ts',
        'packages/*/src/**/*.ts',
      ],
      exclude: [
        '**/*.d.ts',
        'node_modules/**',
        'dist/**',
        'packages/*/tests/**',
        'packages/*/examples/**',
        'packages/examples/**',
        'packages/core/uat/**',
        'packages/core/benchmarks/**',
        // Wizard package was deprecated and merged into core (see CHANGELOG v0.3.x).
      ],
      all: true,
      extension: ['.js', '.ts', '.jsx', '.tsx'],
      usePerFileCoverage: true,
      // CLAUDE.md 80% requirement for core (validators/guards/engine — security-critical).
      // Connectors are integration-glue and get a relaxed floor — they catch
      // hasUnvalidatedTail() wire-up gaps and other seam regressions without
      // requiring full unit coverage of mocked-SDK code paths.
      thresholds: {
        // Global floor across all included files.
        lines: 60,
        functions: 60,
        branches: 50,
        statements: 60,
        // Strict per-file thresholds for security-critical core code.
        'packages/core/src/**/*.ts': {
          lines: 80,
          functions: 80,
          branches: 75,
          statements: 80,
        },
      },
    },
    // Story 0.1 (R2-7): under vitest, connectors auto-honor
    // allowEmptyForTesting so existing tests that construct connectors with
    // no validators/guards (testing wrapper plumbing, not the engine's
    // security contract) keep working without per-site updates. Production
    // code paths still see the fail-loud throw because BONKLM_TEST_MODE is
    // unset there. The engine itself does NOT honor this env var — only
    // connectors do — so direct GuardrailEngine throw tests still exercise
    // the real contract.
    env: {
      BONKLM_TEST_MODE: '1',
    },
    testTimeout: 30000,
    hookTimeout: 30000,
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: false,
        execArgv: ['--max-old-space-size=8192', '--expose-gc'],
      },
    },
    isolate: true,
    maxConcurrency: 1,
    minWorkers: 1,
    maxWorkers: 1,
    sequence: {
      hooks: {},
    },
  },
  resolve: {
    alias: {},
  },
  plugins: [
    {
      // packages/*/tests/ imports use .js extension for .ts source (NodeNext convention)
      name: 'resolve-packages-js-to-ts',
      resolveId(source, importer) {
        if (!importer || !importer.includes('/packages/') || !importer.includes('/tests/')) {
          return null;
        }
        if (!source.startsWith('./') && !source.startsWith('../')) {
          return null;
        }
        if (!source.endsWith('.js')) {
          return null;
        }
        const importerDir = path.dirname(importer);
        const resolvedJsPath = path.resolve(importerDir, source);
        const resolvedTsPath = resolvedJsPath.replace(/\.js$/, '.ts');
        if (fs.existsSync(resolvedTsPath)) {
          return resolvedTsPath;
        }
        return null;
      },
    },
  ],
  esbuild: {
    target: 'node20',
  },
  failOnUnhandledErrors: false,
});
