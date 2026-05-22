/**
 * tools/eslint-plugin-bonklm-edge — no-bare-process-env tests.
 *
 * Uses ESLint's built-in `RuleTester`. `RuleTester.run` calls vitest's
 * `describe`/`it` internally — it MUST be invoked at the module top
 * level, not nested inside another `describe` or `it`.
 *
 * Coverage matrix (post-audit BLOCK closures):
 *   - Canonical & reversed typeof guards (BLOCK-C)
 *   - globalThis.process.env (BLOCK-B, T1 bypass)
 *   - Optional chaining process?.env?.X (BLOCK-I)
 *   - Computed non-literal key process.env[someVar] (rev BLOCK-4)
 *   - process.env as function argument / array element / spread
 *     (rev BLOCK-3 — whole-env parent variants)
 *   - allow option per-key behavior
 *   - typeof process == 'undefined' wrong-operator non-guard
 */
import { RuleTester } from 'eslint';
import { noBareProcessEnvRule } from '../src/no-bare-process-env.js';

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
});

ruleTester.run('no-bare-process-env', noBareProcessEnvRule, {
  valid: [
    // Canonical typeof guard (escape hatch).
    {
      code: `if (typeof process !== 'undefined' && process.env.NODE_ENV === 'production') { /* ok */ }`,
    },
    {
      code: `const v = typeof process !== 'undefined' && process.env.RAILS_ENV;`,
    },
    // Reversed typeof guard — semantically identical, must also be valid (BLOCK-C).
    {
      code: `const v = 'undefined' !== typeof process && process.env.X;`,
    },
    {
      code: `const v = 'undefined' != typeof process && process.env.X;`,
    },
    // Allowlisted keys via rule options.
    {
      code: `const v = process.env.LEGACY_KEY;`,
      options: [{ allow: ['LEGACY_KEY'] }],
    },
    // Unrelated APIs that contain "env" in a different sense.
    {
      code: `const v = import.meta.env.NODE_ENV;`,
    },
    // Member access on something OTHER than process.env passes.
    {
      code: `const env = { NODE_ENV: 'production' }; const v = env.NODE_ENV;`,
    },
    // Deno / Bun runtime-native APIs untouched.
    {
      code: `const v = Deno.env.get('X');`,
    },
  ],
  invalid: [
    // Bare process.env.X — reports with key.
    {
      code: `const v = process.env.NODE_ENV;`,
      errors: [{ messageId: 'bareProcessEnv', data: { key: 'NODE_ENV' } }],
    },
    // Bare process.env['X'] (computed access) — reports with literal key.
    {
      code: `const v = process.env['MY_KEY'];`,
      errors: [{ messageId: 'bareProcessEnv', data: { key: 'MY_KEY' } }],
    },
    // Computed non-literal key — reports with `<unknown>` (rev BLOCK-4).
    {
      code: `const someVar = 'X'; const v = process.env[someVar];`,
      errors: [{ messageId: 'bareProcessEnv', data: { key: '<unknown>' } }],
    },
    // Whole process.env reference — reports separate messageId.
    {
      code: `const env = process.env;`,
      errors: [{ messageId: 'bareProcessEnvWhole' }],
    },
    // Whole process.env as function argument (rev BLOCK-3).
    {
      code: `function log(x) { return x; } log(process.env);`,
      errors: [{ messageId: 'bareProcessEnvWhole' }],
    },
    // Whole process.env as array element (rev BLOCK-3).
    {
      code: `const arr = [process.env];`,
      errors: [{ messageId: 'bareProcessEnvWhole' }],
    },
    // Whole process.env via spread (rev BLOCK-3).
    {
      code: `const obj = { ...process.env };`,
      errors: [{ messageId: 'bareProcessEnvWhole' }],
    },
    // typeof guard with `==` instead of `!==` does NOT trip the
    // escape hatch (different semantics).
    {
      code: `if (typeof process == 'undefined') { /* skip */ } else { console.log(process.env.X); }`,
      errors: [{ messageId: 'bareProcessEnv', data: { key: 'X' } }],
    },
    // allow option respects per-key — only LEGACY_KEY allowed.
    {
      code: `const v = process.env.OTHER_KEY;`,
      options: [{ allow: ['LEGACY_KEY'] }],
      errors: [{ messageId: 'bareProcessEnv', data: { key: 'OTHER_KEY' } }],
    },
    // Nested access — also reports.
    {
      code: `function f() { return process.env.SECRET; }`,
      errors: [{ messageId: 'bareProcessEnv', data: { key: 'SECRET' } }],
    },
    // globalThis.process.env.X — T1 security bypass closed (BLOCK-B).
    {
      code: `const v = globalThis.process.env.API_KEY;`,
      errors: [{ messageId: 'bareProcessEnv', data: { key: 'API_KEY' } }],
    },
    // global.process.env.X — Node classic alias also caught.
    {
      code: `const v = global.process.env.API_KEY;`,
      errors: [{ messageId: 'bareProcessEnv', data: { key: 'API_KEY' } }],
    },
    // Optional chaining process?.env?.X — equally unsafe in edge (BLOCK-I).
    {
      code: `const v = process?.env?.MY_KEY;`,
      errors: [{ messageId: 'bareProcessEnv', data: { key: 'MY_KEY' } }],
    },
    // Mixed optional chaining root.
    {
      code: `const v = globalThis?.process?.env?.OTHER;`,
      errors: [{ messageId: 'bareProcessEnv', data: { key: 'OTHER' } }],
    },
    // IfStatement guard form is NOT recognised — should still report
    // (documented limitation; use inline `&&` form).
    {
      code: `if (typeof process !== 'undefined') { console.log(process.env.X); }`,
      errors: [{ messageId: 'bareProcessEnv', data: { key: 'X' } }],
    },
    // Computed-bracket bypass `process['env'].X` — post-commit security
    // audit BLOCK-1. Semantically identical to `process.env.X`, MUST
    // trigger the rule.
    {
      code: `const v = process['env'].SECRET;`,
      errors: [{ messageId: 'bareProcessEnv', data: { key: 'SECRET' } }],
    },
    // Both levels computed: `process['env']['X']`.
    {
      code: `const v = process['env']['MY_KEY'];`,
      errors: [{ messageId: 'bareProcessEnv', data: { key: 'MY_KEY' } }],
    },
    // Computed-bracket via globalThis: `globalThis['process'].env.X`.
    {
      code: `const v = globalThis['process'].env.API_KEY;`,
      errors: [{ messageId: 'bareProcessEnv', data: { key: 'API_KEY' } }],
    },
    // Bare ExpressionStatement `process.env;` — whole-env report.
    {
      code: `process.env;`,
      errors: [{ messageId: 'bareProcessEnvWhole' }],
    },
    // Deep-chain `process.env.X.Y` — reports ONCE at the
    // `process.env.X` access (Case 1), not at .Y.
    {
      code: `const v = process.env.NESTED.deeper;`,
      errors: [{ messageId: 'bareProcessEnv', data: { key: 'NESTED' } }],
    },
  ],
});
