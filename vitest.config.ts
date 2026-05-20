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
      include: ['packages/core/src/**/*.ts'],
      exclude: ['**/*.d.ts', 'node_modules/**', 'dist/**', 'packages/*/tests/**'],
      all: true,
      extension: ['.js', '.ts', '.jsx', '.tsx'],
      usePerFileCoverage: true,
      // CLAUDE.md 80% coverage requirement
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
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
