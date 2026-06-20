import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import nodePlugin from 'eslint-plugin-n';
import unicornPlugin from 'eslint-plugin-unicorn';
import ymlPlugin from 'eslint-plugin-yml';
import prettierConfig from 'eslint-config-prettier';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default tseslint.config(
  // ── Global ignores ────────────────────────────────────────────────────
  {
    ignores: [
      'node_modules/',
      '**/node_modules/',
      'dist/',
      '**/dist/',
      '**/*.d.ts',
      '**/*.js.map',
      'reference/',
      'coverage/',
      '**/coverage/',
      'team/',
      // TS files not in any tsconfig project (parse errors)
      '.claude/',
      // Local agent-harness artifacts — untracked, not in any tsconfig project.
      // (AGENTS.md needs no entry here: ESLint lints no markdown in this repo.)
      '.agents/',
      '.codex/',
      'vitest.config.ts',
      'vitest.pack.config.ts',
      // Lock files & build manifests
      'pnpm-lock.yaml',
      'package-lock.json',
      '**/*.tsbuildinfo',
      // Test files — excluded from tsconfig.json, linting separately
      '**/*.test.ts',
      '**/*.spec.ts',
      // tsd type-assertion suites — type-checked by `tsd`, not in any tsconfig project
      'packages/*/test-d/**',
      // Compiled .js sitting next to .ts source (legacy stragglers)
      'packages/core/src/**/*.js',
      // Per-package vitest configs not part of root tsconfig project
      '**/vitest.config.ts',
      // Example snippets — documentation, not production code, not built
      'packages/*/examples/**',
      'packages/examples/**',
      // UAT harness + benchmarks — runnable artefacts, not part of the library build
      'packages/core/uat/**',
      'packages/core/benchmarks/**',
      // Bin entry points — own shebang and may use `tsx`/runtime tricks not in tsconfig project
      'packages/*/bin/**',
      'packages/*/src/bin/**',
      // tests/ subdirs that contain setup files only (test cases themselves caught by **/*.test.ts)
      'packages/*/tests/setup.ts',
      'packages/*/tests/vitest-setup.ts',
      // One-off migration tooling at repo root — not part of any tsconfig
      // project. Lives here per plan v2 D-G for audit-trail reviewability.
      // Narrow glob (NOT `scripts/`) so any future script that doesn't
      // match the codemod-*.ts pattern still gets lint coverage.
      'scripts/codemod-*.ts',
      // Local demo + playwright-mcp artefacts — untracked, not part of the
      // library build, follow their own conventions.
      'demo/',
      '.playwright-mcp/',
      // Self-contained tooling sub-package with its own tsconfig / vitest /
      // build — not in the root tsconfig project, so type-checked linting
      // from here can't resolve it (parse error). Validated by its own toolchain.
      'tools/eslint-plugin-bonklm-edge/**',
      // Temporal test-workflow fixtures live under tests/ and are excluded
      // from tsconfig.json, like the other tests/ support files above.
      'packages/*/tests/test-workflows/**'
    ]
  },

  // ── Base JS recommended (all source files) ──────────────────────────
  {
    files: ['**/*.ts', '**/*.js', '**/*.mjs', '**/*.cjs'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        // Node.js globals
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setImmediate: 'readonly',
        queueMicrotask: 'readonly',
        structuredClone: 'readonly',
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        fetch: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        crypto: 'readonly',
        performance: 'readonly',
        // CommonJS
        require: 'readonly',
        module: 'writable',
        exports: 'writable',
        global: 'readonly'
      }
    },
    rules: {
      // ── Security Rules (MUST PRESERVE — DO NOT DOWNGRADE) ───────────
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-script-url': 'error',

      // ── Best Practices ──────────────────────────────────────────────
      eqeqeq: 'error',
      'no-var': 'error',
      'prefer-const': 'error',
      'prefer-arrow-callback': 'error',
      'prefer-template': 'error',
      'no-return-assign': 'error',
      'no-throw-literal': 'error',
      'no-debugger': 'error',

      // ── Code Complexity ────────────────────────────────────────────
      // Size rules off — codebase has many large generated/legacy files.
      // Enforced via code review, not lint.
      'max-lines-per-function': 'off',
      'max-lines': 'off',
      complexity: 'off',
      'max-depth': ['error', 6],
      'max-params': 'off',
      'max-nested-callbacks': ['error', 5],

      // ── Import/Export ───────────────────────────────────────────────
      'sort-imports': [
        'error',
        {
          ignoreCase: true,
          ignoreDeclarationSort: true
        }
      ],
      // Connector packages routinely split type-only and value imports across two
      // statements from the same module. That's an idiomatic TS pattern, not a real
      // duplicate.
      'no-duplicate-imports': 'off'
    }
  },

  // ── JavaScript files (non-type-checked) ─────────────────────────────
  //    JS files are NOT type-checked to avoid false positives from `any`
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    rules: {
      // Many JS files mix CJS/ESM patterns — no-undef false positives on require/module/__dirname
      'no-undef': 'off',
      // JS has no type info → base no-unused-vars is too noisy across legacy code
      'no-unused-vars': 'off',
      'no-console': 'off',
      '@typescript-eslint/no-require-imports': 'off'
    }
  },

  // ── Override: Test files (*.test.ts, *.spec.ts) — NO type-checking ─────
  //    Test files are excluded from tsconfig.json (see tsconfig > exclude)
  //    So we disable type-checked rules to avoid "file not found in project" errors
  {
    files: ['**/*.test.ts', '**/*.spec.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        // Vitest globals
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        vi: 'readonly'
      }
    },
    rules: {
      'no-undef': 'off',
      'no-unused-vars': 'off',
      'no-console': 'off',
      'max-nested-callbacks': ['error', 6],
      'max-depth': ['error', 8],
      // Disable type-checked rules for test files not in tsconfig
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/no-misused-promises': 'off',
      '@typescript-eslint/no-redundant-type-constituents': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/strict-boolean-expressions': 'off',
      '@typescript-eslint/strict-null-checks': 'off'
    }
  },

  // ── TypeScript type-checked rules (TS files ONLY, NOT tests) ─────────────
  {
    files: ['**/*.ts'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: {
        project: ['./tsconfig.json'],
        tsconfigRootDir: __dirname
      }
    },
    rules: {
      // ── TypeScript errors ────────────────────────────────────────────
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-require-imports': 'off',

      // ── TypeScript warnings (aspirational — tracked but not blocking)
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/no-misused-promises': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/no-base-to-string': 'off',
      '@typescript-eslint/no-redundant-type-constituents': 'off',
      '@typescript-eslint/await-thenable': 'off',
      '@typescript-eslint/no-unsafe-function-type': 'off',
      'no-console': 'off'
    }
  },

  // ── Node.js plugin ──────────────────────────────────────────────────
  nodePlugin.configs['flat/mixed-esm-and-cjs'],
  {
    files: ['**/*.ts', '**/*.js', '**/*.mjs', '**/*.cjs'],
    rules: {
      'n/no-process-exit': 'off',
      'n/no-missing-import': 'off',
      'n/no-extraneous-import': 'off',
      'n/no-unpublished-import': 'off',
      'n/no-unsupported-features/node-builtins': 'off',
      'n/hashbang': 'off'
    }
  },

  // ── Unicorn plugin (available for future rule additions) ────────────
  {
    plugins: { unicorn: unicornPlugin }
  },

  // ── YAML linting ────────────────────────────────────────────────────
  ...ymlPlugin.configs['flat/recommended'],
  {
    files: ['**/*.yaml', '**/*.yml'],
    rules: {
      'yml/file-extension': ['error', { extension: 'yaml', caseSensitive: true }],
      'yml/quotes': ['error', { prefer: 'double', avoidEscape: true }]
    }
  },

  // ── Override: GitHub Actions YAML (.yml is GitHub convention) ────────
  {
    files: ['.github/**/*.yml', '.github/**/*.yaml'],
    rules: {
      'yml/quotes': 'off',
      'yml/file-extension': 'off'
    }
  },

  // ── Override: Configuration files ───────────────────────────────────
  {
    files: ['**/*.config.js', '**/*.config.ts', '**/*.config.mjs', '**/config/**/*.js', '**/config/**/*.ts'],
    rules: {
      'max-lines-per-function': 'off',
      'max-lines': 'off'
    }
  },

  // ── Override: Security pattern files — allow dangerous URL literals ───
  //    These files detect malicious patterns, not use them (false positives)
  {
    files: ['packages/core/src/guards/xss-safety.ts'],
    rules: {
      'no-script-url': 'off'
    }
  },

  // ── Override: Pattern + security files — relaxed regex/whitespace rules ─
  //    These files contain intentional escapes, control characters, irregular
  //    whitespace, and similar — all part of the detection surface.
  {
    files: [
      'packages/core/src/guards/secret.ts',
      'packages/core/src/guards/bash-safety.ts',
      'packages/core/src/guards/xss-safety.ts',
      'packages/core/src/validators/jailbreak.ts',
      'packages/core/src/validators/text-normalizer.ts',
      'packages/core/src/validators/code-injection.ts',
      'packages/core/src/validators/harm-intent.ts',
      'packages/core/src/cli/utils/error.ts',
      'packages/core/src/cli/utils/audit.ts',
      'packages/core/src/cli/commands/wizard.ts',
      'packages/core/src/connector-utils/content-extractor.ts',
      'packages/core/src/logging/MonitoringLogger.ts',
      'packages/core/benchmarks/benchmark.bench.ts',
      'packages/logger/src/AttackLogger.ts',
      'packages/logger/src/transform.ts',
      'packages/express-middleware/src/middleware.ts',
      'packages/genkit-connector/src/messages-to-text.ts',
      'packages/weaviate-connector/src/guarded-weaviate.ts',
      'packages/wizard/src/utils/audit.ts',
      'packages/wizard/src/utils/error.ts'
    ],
    rules: {
      'no-useless-escape': 'off',
      'no-misleading-character-class': 'off',
      'no-control-regex': 'off',
      'no-irregular-whitespace': 'off'
    }
  },

  // ── Prettier (last — disables formatting rules that conflict) ──────
  prettierConfig
);
