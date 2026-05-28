/**
 * @blackunicorn/eslint-plugin-edge — no-bare-process-env
 * ======================================================
 *
 * Bans bare `process.env.*` reads in files where the rule is configured.
 * BonkLM consumers wire this rule via per-package `eslint.config.js`
 * `overrides`, targeting files reachable from the package's `./edge`
 * exports condition (Workerd / Deno / Bun runtimes do NOT expose
 * `process.env` — bare reads throw `ReferenceError` or return `undefined`).
 *
 * The rule fires on:
 *   - `process.env.NODE_ENV` → reports.
 *   - `process.env['SOMETHING']` → reports.
 *   - `process.env[someVar]` → reports with key `<unknown>`.
 *   - `process.env` (terminal reference) → reports `bareProcessEnvWhole`.
 *   - `process?.env?.X` (optional chaining) → reports.
 *   - `globalThis.process.env.X` → reports (T1 security bypass closed).
 *   - `f(process.env)`, `[process.env]`, `{...process.env}` → reports
 *     `bareProcessEnvWhole` (non-MemberExpression parent paths).
 *
 * The rule does NOT fire on:
 *   - `typeof process !== 'undefined' && process.env.X` patterns —
 *     the `typeof` guard makes the read edge-safe. Both operand
 *     orderings recognised (`'undefined' !== typeof process && ...`).
 *   - `import.meta.env.X` (Vite-style) — unrelated API surface.
 *   - `Deno.env.get(...)` / `Bun.env.X` — runtime-native, edge-safe.
 *
 * Known limitations (documented for consumer awareness — NOT bugs):
 *   - Alias chains: `const p = process; p.env.X` — purely syntactic
 *     scope-tracking is out of scope for a lint rule at this tier.
 *     Pair with code review + runtime guards in safety-critical paths.
 *   - `if`-statement guard form `if (typeof process !== 'undefined') { ... }`
 *     is NOT recognised as an escape hatch. Use the inline `&&` form
 *     (`typeof process !== 'undefined' && process.env.X`) instead.
 *   - Dynamic code execution (eval/Function-constructor) bypasses —
 *     out of scope; pair with `no-eval` and `eslint-plugin-security`.
 *
 * Rule options:
 *   - `allow: string[]` — env-var names that ARE permitted as bare
 *     reads. Use sparingly for legacy paths; the migration is to
 *     `GuardrailEngineConfig.envBindings` injection (Story 2.1b-edge-core).
 *
 * @package @blackunicorn/eslint-plugin-edge
 */
import type { Rule } from 'eslint';
import type { ChainExpression, Expression, Identifier, MemberExpression, Node, UnaryExpression } from 'estree';

interface RuleOptions {
  allow?: string[];
}

/**
 * Unwrap a ChainExpression node to its inner expression. Returns the
 * input unchanged for non-ChainExpression nodes. Used so patterns like
 * `(process?.env).X` and `globalThis?.process.env` produce the same
 * AST shape comparison as their non-optional counterparts.
 */
function unwrapChain(node: Node): Node {
  if (node.type === 'ChainExpression') {
    return (node as ChainExpression).expression as Node;
  }
  return node;
}

/**
 * Detect whether `node` references the `process` global object.
 * Accepts the bare Identifier `process` AND property access via
 * `globalThis.process` / `globalThis['process']` / `global.process`
 * (T1 bypass closure — both dot and computed-bracket forms).
 * ChainExpression wrappers (`globalThis?.process`) are unwrapped first.
 */
function isProcessReference(node: Node): boolean {
  const inner = unwrapChain(node);
  if (inner.type === 'Identifier' && inner.name === 'process') return true;
  if (
    inner.type === 'MemberExpression' &&
    isGlobalThisReference(inner.object as Node) &&
    propertyIsName(inner, 'process')
  ) {
    return true;
  }
  return false;
}

/**
 * Match a MemberExpression's property against a string `name` for
 * BOTH dot-access (`obj.name`, Identifier) and computed-bracket
 * (`obj['name']`, string Literal) forms. Closes the computed-bracket
 * bypass identified by the post-commit security audit.
 */
function propertyIsName(me: { computed: boolean; property: Node }, name: string): boolean {
  const prop = me.property;
  if (!me.computed && prop.type === 'Identifier' && (prop as Identifier).name === name) {
    return true;
  }
  if (me.computed && prop.type === 'Literal' && (prop as { value: unknown }).value === name) {
    return true;
  }
  return false;
}

/**
 * Detect `globalThis` (or `global` — Node.js classic alias). Accepts
 * bare Identifier and unwraps ChainExpression for `globalThis?.process`
 * style accesses.
 */
function isGlobalThisReference(node: Node): boolean {
  const inner = unwrapChain(node);
  return inner.type === 'Identifier' && (inner.name === 'globalThis' || inner.name === 'global');
}

/**
 * Detect whether `node` is `process.env` — a MemberExpression whose
 * object is a `process` reference and whose property is `env` (either
 * Identifier or computed string Literal). Unwraps ChainExpression
 * for optional-chain forms.
 *
 * Post-commit security audit BLOCK-1: the computed-bracket form
 * `process['env'].SECRET` is semantically identical to `process.env.SECRET`
 * and MUST trigger the rule. Handled by `propertyIsName` accepting
 * both forms.
 */
function isProcessEnvReference(node: Node): boolean {
  const inner = unwrapChain(node);
  return inner.type === 'MemberExpression' && isProcessReference(inner.object as Node) && propertyIsName(inner, 'env');
}

/**
 * Walk up an AST node's ancestors looking for a `typeof process` guard
 * that demonstrably scopes the current `process` read. The walk
 * accepts both operand orderings of the comparison so reversed forms
 * (`'undefined' !== typeof process`) are recognised as the escape
 * hatch they semantically are.
 *
 * Pattern detected: `typeof process !== 'undefined' && process.env.X`
 * OR `'undefined' !== typeof process && process.env.X` — the
 * LogicalExpression's left side compares `typeof process` against
 * literal `'undefined'` with `!==` / `!=` (either operand position).
 *
 * ESLint v9+ removed `context.getAncestors()`; callers pass
 * `sourceCode.getAncestors(node)` directly.
 *
 * NOT recognised (intentional — see file docstring):
 *   - `if (typeof process !== 'undefined') { ... }` — IfStatement form.
 *   - Reversed BinaryExpression with `===` (semantically inverted).
 */
function isInsideTypeofProcessGuard(_node: Node, ancestors: Node[]): boolean {
  for (const ancestor of ancestors) {
    if (ancestor.type === 'LogicalExpression' && ancestor.operator === '&&') {
      if (isTypeofProcessNotUndefined(ancestor.left as Node)) return true;
    }
  }
  return false;
}

/**
 * Match `typeof process !== 'undefined'` in either operand ordering.
 * Returns true for:
 *   - `typeof process !== 'undefined'`
 *   - `typeof process != 'undefined'`
 *   - `'undefined' !== typeof process`
 *   - `'undefined' != typeof process`
 */
function isTypeofProcessNotUndefined(node: Node): boolean {
  if (node.type !== 'BinaryExpression') return false;
  if (node.operator !== '!==' && node.operator !== '!=') return false;
  // Canonical form: typeof process !== 'undefined'
  if (isTypeofProcess(node.left as Node) && isLiteralUndefined(node.right as Node)) {
    return true;
  }
  // Reversed form: 'undefined' !== typeof process
  if (isLiteralUndefined(node.left as Node) && isTypeofProcess(node.right as Node)) {
    return true;
  }
  return false;
}

function isTypeofProcess(node: Node): boolean {
  return (
    node.type === 'UnaryExpression' &&
    (node as UnaryExpression).operator === 'typeof' &&
    (node as UnaryExpression).argument.type === 'Identifier' &&
    ((node as UnaryExpression).argument as Identifier).name === 'process'
  );
}

function isLiteralUndefined(node: Node): boolean {
  return node.type === 'Literal' && (node as { value?: unknown }).value === 'undefined';
}

/**
 * Build the rule. Exported function-form (NOT default-exported) so
 * the plugin barrel can attach metadata via `rule.meta`.
 */
export const noBareProcessEnvRule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow bare `process.env.*` reads in edge-reachable files. ' +
        'Use `GuardrailEngineConfig.envBindings` injection or guard with `typeof process !== "undefined"`. ' +
        'NOTE: alias chains (`const p = process; p.env.X`) and IfStatement guards are NOT detected; ' +
        'use the inline `&&` guard form.',
      recommended: true
    },
    messages: {
      bareProcessEnv:
        '`process.env.{{key}}` is not edge-safe. Use `GuardrailEngineConfig.envBindings` ' +
        'injection or guard with `typeof process !== "undefined"`. See ' +
        'docs/user/migration/edge-string-handlers.md#envbindings-migration-from-v0-3',
      bareProcessEnvWhole:
        '`process.env` (full reference) is not edge-safe. Read individual keys via ' + '`envBindings` instead.'
    },
    schema: [
      {
        type: 'object',
        properties: {
          allow: {
            type: 'array',
            items: { type: 'string' },
            uniqueItems: true
          }
        },
        additionalProperties: false
      }
    ]
  },

  create(context) {
    const options = (context.options[0] ?? {}) as RuleOptions;
    const allow = new Set(options.allow ?? []);
    const sourceCode = context.sourceCode;

    /**
     * Report a violation, deriving the env-var key name when possible.
     * Honours the `allow` allowlist on a per-key basis.
     */
    function reportViolation(reportNode: Node, key: string | null, ancestors: Node[]): void {
      if (isInsideTypeofProcessGuard(reportNode, ancestors)) return;
      if (key !== null && allow.has(key)) return;
      context.report({
        node: reportNode,
        messageId: 'bareProcessEnv',
        data: { key: key ?? '<unknown>' }
      });
    }

    /**
     * Whole-env reporting path for `process.env` terminal references
     * (parent uses the reference without further property access).
     */
    function reportWholeEnv(reportNode: Node, ancestors: Node[]): void {
      if (isInsideTypeofProcessGuard(reportNode, ancestors)) return;
      context.report({ node: reportNode, messageId: 'bareProcessEnvWhole' });
    }

    return {
      MemberExpression(node) {
        const me = node as MemberExpression;
        const ancestors = sourceCode.getAncestors(node) as Node[];

        // Case 1: `<process-env-ref>.KEY` access. me.object is
        // process.env (covers bare `process`, `globalThis.process`,
        // and optional-chain wrappers via isProcessEnvReference).
        if (isProcessEnvReference(me.object as Node)) {
          let key: string | null = null;
          if (me.computed === false && me.property.type === 'Identifier') {
            key = (me.property as Identifier).name;
          } else if (me.property.type === 'Literal' && typeof (me.property as { value: unknown }).value === 'string') {
            key = (me.property as { value: string }).value;
          }
          // Report on the inner `process.env` node so the typeof-guard
          // walk has a stable origin.
          reportViolation(unwrapChain(me.object as Node), key, ancestors);
          return;
        }

        // Case 2: `process.env` terminal reference. me itself is
        // process.env (no further property access).
        if (isProcessEnvReference(me)) {
          const parent = ancestors[ancestors.length - 1];
          // Skip if parent uses this node as the .object of a further
          // MemberExpression — handled by Case 1 above with a key.
          if (
            parent !== undefined &&
            parent.type === 'MemberExpression' &&
            (parent as MemberExpression).object === me
          ) {
            return;
          }
          // Skip ChainExpression wrapper whose own parent is a further
          // MemberExpression using the chain as .object (optional-chain
          // case `process?.env?.X` — outer ME handles it via Case 1).
          if (parent !== undefined && parent.type === 'ChainExpression') {
            const grandparent = ancestors[ancestors.length - 2];
            if (
              grandparent !== undefined &&
              grandparent.type === 'MemberExpression' &&
              ((grandparent as MemberExpression).object as Expression) === parent
            ) {
              return;
            }
          }
          reportWholeEnv(node, ancestors);
        }
      }
    };
  }
};
