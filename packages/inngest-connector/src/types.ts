/**
 * @blackunicorn/bonklm-inngest — types
 * ===================================
 *
 * Type surface for the Inngest middleware. Kept narrow so a consumer
 * application can construct the middleware without importing the
 * Inngest SDK's full type tree (peer-dep optionality).
 *
 * @package @blackunicorn/bonklm-inngest
 */
import type { GuardrailEngine } from '@blackunicorn/bonklm';
import type { CachedValidateOptions, CachedValidatorResult, Validator, ValidatorInput } from '@blackunicorn/bonklm';

/**
 * Aggregated outcome of a single validate-* helper call. Designed for
 * ergonomic short-circuit: `if (result.blocked) return ...`.
 */
export interface BonklmInngestValidateResult {
  /** True when at least one validator returned blocked === true. */
  blocked: boolean;
  /** Convenience inverse of `blocked`. */
  allowed: boolean;
  /** Aggregate reason from the first blocking validator (if any). */
  reason?: string;
  /** Per-validator detail; preserved for telemetry / OTel. */
  results: CachedValidatorResult[];
}

/**
 * Surface bolted onto `ctx.bonklm` inside a function-run context.
 *
 * Each helper wraps the underlying `cachedValidate` call in an Inngest
 * `step.run('bonklm-validate-*', ...)` invocation so the step gets
 * (a) Inngest's in-run replay determinism (Inngest replays from step
 * history when a step has already completed) AND (b) cross-run
 * cachedValidate dedupe when an external cache is wired.
 */
export interface BonklmInngestContextSurface {
  /**
   * Validate text input (user prompt, retrieved doc, etc).
   */
  validateInput(content: string | ValidatorInput): Promise<BonklmInngestValidateResult>;

  /**
   * Validate model output / generated text.
   */
  validateOutput(content: string): Promise<BonklmInngestValidateResult>;

  /**
   * Validate a tool-call arguments object before dispatch.
   */
  validateToolArgs(toolName: string, args: unknown): Promise<BonklmInngestValidateResult>;
}

/**
 * Configuration for `bonklmInngestMiddleware`.
 */
export interface BonklmInngestMiddlewareOptions {
  /**
   * Validator pipeline. REQUIRED. The order is preserved — each
   * helper runs validators sequentially and short-circuits on the
   * first BLOCK.
   *
   * Constraint: every validator MUST
   * have a non-empty `name` property when caching is enabled
   * (constructor.name is minify-unsafe).
   */
  validators: Validator[];

  /**
   * Optional engine to derive the salt from. If omitted, the
   * middleware constructs its own engine instance (with the
   * validators above) so consumers can wire validators directly.
   *
   * Supplied engines MUST already include the same validators OR
   * the consumer accepts that the engine's instance ID is the only
   * thing pulled from it (validators are passed through to
   * cachedValidate directly).
   *
   * @security Sharing one `GuardrailEngine` across multiple
   *   `bonklmInngestMiddleware()` calls collapses the cache namespace
   *   — both middlewares share the same salted key prefix, so
   *   function A's cached ALLOW/BLOCK is served to function B for
   *   identical inputs. Default (omit `engine`) gives each
   *   middleware its own isolated namespace. Only share intentionally.
   */
  engine?: GuardrailEngine;

  /**
   * cachedValidate options (cache, TTLs, namespace, logger). The
   * middleware auto-applies `createSaltedKeyFn(engine.getInstanceId())`
   * IF a cache is provided + no keyFn explicitly set, closing the
   * cross-instance poisoning vector by default.
   */
  cache?: CachedValidateOptions['cache'];
  defaultTtlMs?: CachedValidateOptions['defaultTtlMs'];
  /**
   * @security Setting this high (or `Infinity`) means stale BLOCK
   *   decisions persist across validator-logic updates. In
   *   deployments where validator behavior changes frequently,
   *   prefer short TTLs (<= 1h) so freshly-updated validators are
   *   re-consulted instead of replaying old decisions.
   */
  blockedTtlMs?: CachedValidateOptions['blockedTtlMs'];
  cacheNamespace?: CachedValidateOptions['cacheNamespace'];
  /**
   * Optional override keyFn. When set, supersedes the auto-salted
   * default — caller takes responsibility for cross-instance isolation.
   */
  keyFn?: CachedValidateOptions['keyFn'];
  logger?: CachedValidateOptions['logger'];

  /**
   * Step-name prefix for the three step.run wrappers. Default:
   * `bonklm-validate`. Three steps emit per function call:
   *   - `bonklm-validate-input`
   *   - `bonklm-validate-output`
   *   - `bonklm-validate-tool-args`
   *
   * Override only if a consumer's Inngest dashboard naming scheme
   * requires it. The same prefix MUST be stable across deploys —
   * changing it invalidates Inngest's in-run replay state.
   */
  stepNamePrefix?: string;
}
