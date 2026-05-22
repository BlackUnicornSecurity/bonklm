/**
 * @blackunicorn/bonklm-trigger — types
 * ===================================
 *
 * Type surface for the Trigger.dev v3/v4 middleware. Kept narrow so a
 * consumer application can construct the middleware factory without
 * importing the full `@trigger.dev/sdk` type tree (peer-dep optionality).
 *
 * @package @blackunicorn/bonklm-trigger
 */
import type { GuardrailEngine } from '@blackunicorn/bonklm';
import type {
  CachedValidateOptions,
  CachedValidatorResult,
  Validator,
  ValidatorInput,
} from '@blackunicorn/bonklm';

/**
 * Aggregated outcome of a single validate-* helper call. Designed for
 * ergonomic short-circuit: `if (result.blocked) throw new AbortTaskRunError(...)`.
 */
export interface BonklmTriggerValidateResult {
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
 * Validation handle stored in Trigger.dev locals. Survives CRIU
 * checkpoint/resume because locals are part of the V8 heap snapshot.
 *
 * The handle is constructed by the `withBonkLM` middleware at the start
 * of every attempt + stored in locals. Inside `run()`, consumers retrieve
 * it via `getBonklmHandle()` and call the validate-* helpers.
 *
 * Each helper drives the underlying `cachedValidate` pipeline with a
 * `cacheNamespace` keyed by `ctx.run.id`, so retries of the same run
 * hit the cache without re-firing the validator pipeline. Different
 * runs get a fresh namespace (cache miss).
 */
export interface BonklmTriggerHandle {
  /**
   * Validate text input (user prompt, retrieved doc, etc.). Pass a raw
   * string to wrap as `{ kind: 'text', content }` automatically, or a
   * pre-built `ValidatorInput` discriminated-union value.
   */
  validateInput(
    content: string | ValidatorInput
  ): Promise<BonklmTriggerValidateResult>;

  /**
   * Validate model output / generated text.
   */
  validateOutput(content: string): Promise<BonklmTriggerValidateResult>;

  /**
   * Validate a tool-call arguments object before dispatch.
   */
  validateToolArgs(
    toolName: string,
    args: unknown
  ): Promise<BonklmTriggerValidateResult>;
}

/**
 * Configuration for `withBonkLM` / `createBonklmTriggerHandle`.
 *
 * Mirrors the Inngest connector's option bag intentionally — both
 * connectors layer on top of the same `cachedValidate` primitive and
 * share security defaults (auto-salted keyFn when a cache is wired,
 * non-empty validator names enforced, etc.).
 */
export interface BonklmTriggerOptions {
  /**
   * Validator pipeline. REQUIRED. The order is preserved — each helper
   * runs validators sequentially and short-circuits on the first BLOCK.
   *
   * Constraint (Story 2.7 audit BLOCK B2): every validator MUST have a
   * non-empty `name` property when caching is enabled (constructor.name
   * is minify-unsafe).
   */
  validators: Validator[];

  /**
   * Optional engine to derive the cache-salt from. If omitted, the
   * middleware constructs its own engine instance (with the validators
   * above) so consumers can wire validators directly.
   *
   * @security Sharing one `GuardrailEngine` across multiple `withBonkLM()`
   *   calls collapses the cache namespace — both middlewares share the
   *   same salted key prefix, so task A's cached ALLOW/BLOCK is served
   *   to task B for identical inputs. Default (omit `engine`) gives
   *   each middleware its own isolated namespace. Only share intentionally.
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
   *   decisions persist across validator-logic updates. In deployments
   *   where validator behavior changes frequently, prefer short TTLs
   *   (<= 1h) so freshly-updated validators are re-consulted instead
   *   of replaying old decisions.
   */
  blockedTtlMs?: CachedValidateOptions['blockedTtlMs'];
  /**
   * Base namespace mixed into the cache key alongside `ctx.run.id`. The
   * final namespace is `${cacheNamespace ?? DEFAULT}::run-${ctx.run.id}`.
   *
   * Override only to scope cache entries to a specific environment /
   * deployment slot. Changing it invalidates cache entries from
   * earlier deploys (intentional for rolling deploys).
   */
  cacheNamespace?: CachedValidateOptions['cacheNamespace'];
  /**
   * Optional override keyFn. When set, supersedes the auto-salted
   * default — caller takes responsibility for cross-instance isolation.
   */
  keyFn?: CachedValidateOptions['keyFn'];
  logger?: CachedValidateOptions['logger'];
}

/**
 * Subset of Trigger.dev's `TaskRunContext` consumed by the middleware.
 * Kept as a structural type so consumers can construct mock contexts
 * for testing + custom-middleware composition without importing the
 * full Trigger.dev type tree.
 */
export interface BonklmTriggerRunContext {
  run: {
    id: string;
    isReplay: boolean;
  };
}

/**
 * Subset of Trigger.dev's `TaskMiddlewareHookParams` consumed by the
 * middleware. The full hook params include `payload`, `task`, and
 * `signal`; we only consume `ctx` + `next` so the structural surface
 * here is intentionally narrow.
 */
export interface BonklmTriggerMiddlewareParams {
  ctx: BonklmTriggerRunContext;
  next: () => Promise<void>;
}

/**
 * Subset of Trigger.dev's `TaskFailureHookParams` consumed by the
 * onFailure hook. The full hook params include `payload`, `task`,
 * `signal`, and `init`; we only consume `ctx` + `error`.
 */
export interface BonklmTriggerFailureParams {
  ctx: BonklmTriggerRunContext;
  error: unknown;
}

/**
 * Public surface returned by `withBonkLM()`. Spread into `task({...})`:
 *
 * ```ts
 * import { task, AbortTaskRunError } from "@trigger.dev/sdk/v3";
 * import { withBonkLM, getBonklmHandle } from "@blackunicorn/bonklm-trigger";
 *
 * const { middleware, onFailure } = withBonkLM({ validators, cache });
 * export const myTask = task({
 *   id: "my-task",
 *   middleware,
 *   onFailure,
 *   run: async (payload, { ctx }) => {
 *     const r = await getBonklmHandle(ctx).validateInput(payload.prompt);
 *     if (r.blocked) {
 *       // SECURITY: AbortTaskRunError terminates the run immediately
 *       // (no retry storm). Use a STATIC reason — `r.reason` is
 *       // attacker-controlled validator output and surfaces in the
 *       // Trigger.dev dashboard run-status field.
 *       throw new AbortTaskRunError('blocked: guardrail decision');
 *     }
 *   },
 * });
 * ```
 */
export interface BonklmTriggerBindings {
  /**
   * Trigger.dev v3/v4 middleware hook. Receives `{ ctx, payload, task,
   * signal, next }` and is responsible for setting up the locals-based
   * BonkLM handle BEFORE calling `next()`. The handle is keyed by
   * `ctx.run.id` so retries hit the cache.
   */
  middleware: (params: BonklmTriggerMiddlewareParams) => Promise<void>;

  /**
   * Trigger.dev v3/v4 onFailure hook. Receives `{ ctx, payload, task,
   * error, signal, init? }`. The BonkLM hook emits a structured warn
   * log (if a logger was configured) so attack telemetry doesn't get
   * lost in the retry storm. Return value is ignored by Trigger.dev's
   * lifecycle machinery (per SDK contract).
   */
  onFailure: (params: BonklmTriggerFailureParams) => Promise<void>;
}
