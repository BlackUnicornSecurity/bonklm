import { defineConfig } from 'vitest/config';
import path from 'path';
import fs from 'fs';

// ---------------------------------------------------------------------------
// AUTHORITATIVE RUN-SEMANTICS (security regression).
// This root config is the SINGLE source of truth for the run semantics that the
// release gate depends on — `isolate: true`, `maxConcurrency: 1`, the forks
// pool, and Vitest's default fail-closed handling of unhandled errors. The per-package `vitest.config.ts`
// files are intentionally minimal (coverage reporters / environment only) and
// deliberately do NOT inherit these flags, so a package-local
// `pnpm --filter <pkg> test` runs under different isolation / unhandled-error
// semantics than this root run. Only `pnpm test` from the repo root (which uses
// THIS config) is PR-valid evidence; package-local runs are an inner-loop
// convenience and are non-authoritative. A package that needs parity can
// `mergeConfig` this file's `test` block — but the gate never relies on it.
// ---------------------------------------------------------------------------
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/**/*.test.ts', 'tools/**/*.test.ts'],
    exclude: [
      'node_modules/**',
      'dist/**',
      '**/node_modules/**',
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
        'scripts/gen-sbom.mjs',
        'scripts/lib-shipped-closure.mjs',
        'scripts/license-audit.mjs',
        'scripts/supply-chain-audit.mjs',
        'scripts/verify-publish-surface.mjs',
        'tools/check-diff-coverage.js',
        'tools/check-gitleaks-ignore.js',
        'tools/check-changeset-linked.js',
        'tools/check-release-plan.js',
        'tools/install-pinned-npm.js',
        'tools/release-container.js',
        'tools/release-npm-consumer.js',
        'tools/release-npm-bundle.js',
        'tools/release-npm-cli.js',
        'tools/release-npm.js',
        'tools/release-npm-provenance.js',
        'tools/release-scope.js',
        'tools/release-state.js',
        'tools/release-version.js',
        'scripts/check-release-tarballs.js',
        'scripts/check-public-export.js',
        'scripts/check-sbom-licenses.mjs',
        'scripts/check-image-runtime.mjs',
        'scripts/image-inventory.mjs',
        'tools/semver.js',
        'tools/sync-root-version.js',
        'tools/check-workspace-policy.js',
        'tools/check-stale-dist.js',
        'tools/check-ee-boundary.js',
        'tools/check-edge-node-builtins.js',
        'tools/oss-export/oss-export.mjs',
        'tools/oss-export/scan-tarballs-deny.mjs'
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
        // The prospective release-plan gate keeps every publishable package on
        // one target version; enforce full branch coverage so no fail-closed
        // predicate can silently disappear.
        'tools/check-release-plan.js': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100
        },
        'tools/check-diff-coverage.js': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100
        },
        'tools/check-gitleaks-ignore.js': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100
        },
        'tools/release-npm.js': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100
        },
        'tools/release-npm-provenance.js': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100
        },
        'tools/release-npm-bundle.js': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100
        },
        'tools/release-npm-consumer.js': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100
        },
        'tools/install-pinned-npm.js': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100
        },
        'tools/release-npm-cli.js': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100
        },
        'tools/release-container.js': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100
        },
        'tools/release-state.js': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100
        },
        'tools/release-scope.js': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100
        },
        'tools/release-version.js': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100
        },
        'scripts/check-release-tarballs.js': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100
        },
        'scripts/check-public-export.js': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100
        },
        'scripts/check-sbom-licenses.mjs': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100
        },
        'scripts/check-image-runtime.mjs': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100
        },
        'scripts/image-inventory.mjs': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100
        },
        'tools/semver.js': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100
        },
        'tools/sync-root-version.js': {
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
        },
        // The OSS↔EE license-boundary gate is dependency-free tooling outside
        // packages/*; pin it to 100% so its coverage is enforced by the standard
        // gate, not merely asserted (CONTRIBUTING "documented -> enforced").
        'tools/check-ee-boundary.js': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100
        },
        // The edge `node:*` allowlist gate is dependency-free tooling outside
        // packages/*; pin it to 100% so its coverage is enforced by the standard
        // gate, not merely asserted (CONTRIBUTING "documented -> enforced").
        'tools/check-edge-node-builtins.js': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100
        },
        // The stale-dist gate (src↔dist bijection) is dependency-free tooling
        // outside packages/*; pin it to 100% so its coverage is enforced by
        // the standard gate, not merely asserted.
        'tools/check-stale-dist.js': {
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
    execArgv: ['--max-old-space-size=8192', '--expose-gc'],
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
  }
});
