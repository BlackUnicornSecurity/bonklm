import { defineConfig } from 'vitest/config';
import path from 'path';
import fs from 'fs';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/**/*.test.ts', 'tools/**/*.test.ts'],
    exclude: [
      'node_modules/**',
      'dist/**',
      '**/node_modules/**',
      'team/backups/**',
      // Reference directory — external openclaw reference, has missing peer deps
      'reference/**',
      // Tarball-drift snapshots (ST-04-300..351) need the built (gitignored)
      // dist/, absent in this pre-build pass. They run post-build via
      // `pnpm test:pack` (vitest.pack.config.ts) instead.
      'packages/**/tests/tarball-drift.test.ts'
    ],
    coverage: {
      provider: 'istanbul',
      reporter: ['text', 'json', 'html', 'json-summary'],
      include: [
        'packages/core/src/**/*.ts',
        'packages/*/src/**/*.ts',
        'tools/check-changeset-linked.js',
        'tools/check-workspace-policy.js'
      ],
      exclude: [
        '**/*.d.ts',
        'node_modules/**',
        'dist/**',
        'packages/*/tests/**',
        'packages/*/examples/**',
        'packages/examples/**',
        'packages/core/uat/**',
        'packages/core/benchmarks/**'
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
        // Strict thresholds for security-critical core code. Ratchet floor —
        // raise toward 100%, never lower (CLAUDE.md / CONTRIBUTING). Ratcheted
        // 2026-05-28 (80/80/75/80 -> 82/86/76/82) after restoring coverage on
        // three src files whose tests imported from dist/ and adding unit +
        // regression suites for content-extractor / adapt-validator /
        // wrap-sentinel / portable-emitter. Measured core/src aggregate at the
        // ratchet: lines 83.29 / statements 82.98 / branches 76.18 /
        // functions 87.54; floors sit ~1pp below to absorb normal churn.
        'packages/core/src/**/*.ts': {
          lines: 82,
          functions: 86,
          branches: 76,
          statements: 82
        },
        // Story 0.1 corrections D-H: the `/testing` subpath holds test-only
        // helpers (noOpValidator and future siblings), not security-critical
        // code. The global 60% floor still applies via the wildcard above;
        // the strict 80% per-file gate would over-constrain a 1-line barrel.
        'packages/core/src/testing/**/*.ts': {
          lines: 60,
          functions: 60,
          branches: 50,
          statements: 60
        },
        // The changeset-linked drift gate is dependency-free tooling outside
        // packages/*; pin it to 100% so its coverage is enforced by the standard
        // gate, not merely asserted (CONTRIBUTING "documented -> enforced").
        'tools/check-changeset-linked.js': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100
        },
        // The tools/* workspace-policy gate is dependency-free tooling outside
        // packages/*; pin it to 100% so its coverage is enforced by the standard
        // gate, not merely asserted (CONTRIBUTING "documented -> enforced").
        'tools/check-workspace-policy.js': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100
        }
      }
    },
    testTimeout: 30000,
    hookTimeout: 30000,
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: false,
        execArgv: ['--max-old-space-size=8192', '--expose-gc']
      }
    },
    isolate: true,
    maxConcurrency: 1,
    minWorkers: 1,
    maxWorkers: 1,
    sequence: {
      hooks: {}
    }
  },
  resolve: {
    alias: {}
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
      }
    }
  ],
  esbuild: {
    target: 'node20'
  },
  failOnUnhandledErrors: false
});
