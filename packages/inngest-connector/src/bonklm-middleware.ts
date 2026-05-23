/**
 * @blackunicorn/bonklm-inngest — middleware factory
 * =================================================
 *
 * `bonklmInngestMiddleware({ validators })` returns a subclass of
 * `Middleware.BaseMiddleware` (Inngest v4 API). Drop the class into
 * the `middleware: []` array when constructing your Inngest client;
 * every function-run context gets a `ctx.bonklm` surface with three
 * helpers: `validateInput`, `validateOutput`, `validateToolArgs`.
 *
 * Each helper wraps the underlying validator pipeline in
 * `step.run('bonklm-validate-*', ...)` so:
 *
 *   1. **In-run replay determinism (Inngest native)** — Inngest
 *      reads step.run output from history on retry rather than
 *      re-executing the validator.
 *
 *   2. **Cross-run dedupe (cachedValidate)** — when a `cache` is
 *      wired, identical inputs across DIFFERENT function runs hit
 *      the cache instead of re-validating. Requires that the
 *      middleware is constructed ONCE per Inngest client (which is
 *      the standard pattern — middleware is registered at client
 *      boot, not per function).
 *
 *   3. **Replay-cached BLOCK decisions** — a BLOCK on run-1
 *      persisted in cachedValidate is returned on run-2 without
 *      re-running the validator (matches AC: "function replay does
 *      not re-fire validator; cached block decision returned").
 *
 * Post-3-lane-audit BLOCK closures:
 *   - **B1**: `resolveOptions` runs ONCE at factory-construction time;
 *     resolved engine + keyFn close over the closure so every
 *     function-run inherits the same salt. Defeats the per-invocation
 *     cache-miss footgun the auditors flagged.
 *   - **B2-rev**: `validateToolArgs` rejects empty / non-string
 *     `toolName` at the boundary.
 *   - **B3-sec**: `canonicalJSONStringify` pre-flight on `validateInput`
 *     (ValidatorInput path) + `validateToolArgs` boundary. Non-
 *     serializable inputs return a structured BLOCK rather than
 *     throwing into Inngest's retry machinery (closes T8 DoS vector).
 *   - **B4-sec**: `stepNamePrefix` is regex-validated; collision
 *     with the internal suffix literals (`-input`, `-output`,
 *     `-tool-args`) is forbidden.
 *   - **B5-arch**: `ctx.step` runtime guard — throws a descriptive
 *     error instead of letting an undefined-step crash bubble up.
 *
 * AC NOTE: the roadmap AC mentions `new InngestMiddleware(...)` (v3
 * API). Inngest v4 replaced that with class extension via
 * `Middleware.BaseMiddleware`. Semantics are identical; the API
 * surface differs.
 *
 * @package @blackunicorn/bonklm-inngest
 */
import { Middleware } from 'inngest';
import {
  cachedValidate,
  canonicalJSONStringify,
  createSaltedKeyFn,
  GuardrailEngine,
  type CachedValidateOptions,
  type Validator,
  type ValidatorInput,
} from '@blackunicorn/bonklm';
import { sanitizeReasonText } from '@blackunicorn/bonklm-browser-agents-core';
import type {
  BonklmInngestContextSurface,
  BonklmInngestMiddlewareOptions,
  BonklmInngestValidateResult,
} from './types.js';

/**
 * Subset of Inngest's `step` shape used by the helpers. Kept as a
 * structural type so consumers can construct the surface in tests
 * + custom-middleware scenarios without importing the full Inngest
 * step-tools type.
 */
export interface StepRunner {
  run<T>(stepId: string, handler: () => T | Promise<T>): Promise<T>;
}

/**
 * Internal: a resolved + frozen bundle that closes over the engine,
 * keyFn, and cachedValidate options once at factory time. Reused
 * across every function-run so the engineInstanceId salt is stable.
 */
interface ResolvedBundle {
  /**
   * Sprint 14 cumulative sec cross-S2 closure: frozen shallow copy so
   * post-factory mutation of the consumer's original array does not
   * leak into subsequent function-run invocations. Matches the
   * Trigger.dev connector's sec S7 posture.
   */
  validators: readonly Validator[];
  cachedOptions: CachedValidateOptions;
  stepPrefix: string;
  /**
   * Sprint 14 cumulative arch X3 part 2 closure: engine reference
   * carried into the bundle so `runPipeline` can call
   * `engine.notifyCachedResult(...)` after `cachedValidate`,
   * propagating decisions to `engine.onIntercept(...)` listeners.
   * Without this, Inngest validator decisions were invisible to the
   * audit telemetry surface.
   */
  engine: GuardrailEngine;
}

/**
 * Build the `ctx.bonklm` surface for a single function run.
 *
 * For most consumers, prefer `bonklmInngestMiddleware()` — it caches
 * `resolveOptions` at factory time so the engineInstanceId salt
 * stays stable across function-runs.
 *
 * Exported for test harnesses + custom-middleware composition that
 * need to construct the surface directly from a step runner.
 *
 * NOTE: if a fresh surface is built per function-run AND no `engine`
 * is supplied in `options`, each surface gets a different
 * `engineInstanceId` → the cache misses across runs. To enable
 * cross-run dedupe via cachedValidate, EITHER:
 *   (a) supply `options.engine` so all surfaces share a salt, OR
 *   (b) use `bonklmInngestMiddleware()` which hoists resolution
 *       to factory scope (the recommended path).
 */
export function createBonklmInngestContextSurface(
  step: StepRunner,
  options: BonklmInngestMiddlewareOptions
): BonklmInngestContextSurface {
  const bundle = resolveOptions(options);
  return surfaceFromBundle(step, bundle);
}

/**
 * Inngest middleware factory. Returns a class extending
 * `Middleware.BaseMiddleware` (v4 API).
 *
 * Resolution is hoisted to factory time — the engine, salted keyFn,
 * and cachedValidate options are constructed ONCE per middleware
 * instance and reused across every function-run that flows through
 * this Inngest client. This is what makes cross-run cache dedupe
 * work without forcing consumers to pass an explicit `engine`.
 *
 * @example
 * ```ts
 * import { Inngest } from 'inngest';
 * import { bonklmInngestMiddleware } from '@blackunicorn/bonklm-inngest';
 * import { PromptInjectionValidator } from '@blackunicorn/bonklm';
 *
 * const inngest = new Inngest({
 *   id: 'my-app',
 *   middleware: [
 *     bonklmInngestMiddleware({
 *       validators: [new PromptInjectionValidator()],
 *       cache: redisCache,
 *     }),
 *   ],
 * });
 *
 * export const myFn = inngest.createFunction(
 *   { id: 'my-fn' },
 *   { event: 'app/user.prompt' },
 *   async ({ event, ctx }) => {
 *     const r = await ctx.bonklm.validateInput(event.data.prompt);
 *     if (r.blocked) throw new Error(`Blocked: ${r.reason}`);
 *     // ... downstream LLM call
 *   }
 * );
 * ```
 */
export function bonklmInngestMiddleware(
  options: BonklmInngestMiddlewareOptions
): typeof Middleware.BaseMiddleware {
  // Hoist resolution to factory scope — engine + keyFn + step prefix
  // are built ONCE here and reused across every function-run via the
  // closure below. Closes audit BLOCK-B1 (per-invocation engine =
  // silent cache miss).
  const bundle: ResolvedBundle = resolveOptions(options);

  class BonklmInngestMiddleware extends Middleware.BaseMiddleware {
    readonly id = '@blackunicorn/bonklm-inngest';

    transformFunctionInput(
      arg: Middleware.TransformFunctionInputArgs
    ): Middleware.TransformFunctionInputArgs {
      // B5 runtime guard: `ctx.step` MUST be defined in a function-run
      // context. If absent (some hook contexts, future SDK versions),
      // surface a clear error instead of letting downstream `.run(...)`
      // crash with an opaque TypeError.
      const step = (arg.ctx as { step?: StepRunner }).step;
      if (step === undefined || typeof step.run !== 'function') {
        throw new Error(
          'bonklmInngestMiddleware: ctx.step is unavailable in this hook ' +
            'context. Ensure you are running Inngest v4.4+ and the ' +
            'middleware is registered on the client (`middleware: [...]`).'
        );
      }
      const bonklm = surfaceFromBundle(step, bundle);
      return {
        ...arg,
        ctx: { ...arg.ctx, bonklm } as Middleware.TransformFunctionInputArgs['ctx'],
      };
    }
  }

  // `satisfies` would force the class type to conform to the abstract
  // base — but TS doesn't accept it on `class` expressions returned
  // from a function. We assert structurally via the BaseMiddleware
  // extension above and cast at the boundary. Any future v4.x shape
  // drift surfaces inside `transformFunctionInput`'s explicit
  // `Middleware.TransformFunctionInputArgs` parameter / return type.
  return BonklmInngestMiddleware as unknown as typeof Middleware.BaseMiddleware;
}

/**
 * Internal: build a `BonklmInngestContextSurface` from a resolved
 * bundle + a step runner. Per-call instantiation is cheap (a
 * closure object); the expensive `resolveOptions` work is hoisted
 * to factory scope by the caller.
 */
function surfaceFromBundle(
  step: StepRunner,
  bundle: ResolvedBundle
): BonklmInngestContextSurface {
  const { validators, cachedOptions, stepPrefix, engine } = bundle;

  const runPipeline = async (
    stepId: string,
    input: ValidatorInput
  ): Promise<BonklmInngestValidateResult> => {
    return step.run(stepId, async () => {
      const results = await cachedValidate(
        validators as Validator[],
        input,
        cachedOptions
      );
      // Sprint 14 cumulative arch X3 part 2 closure: notify the engine
      // so `engine.onIntercept(...)` callbacks fire for cached-validate
      // decisions too (Inngest's previous bypass meant attack telemetry
      // wired via onIntercept silently lost every Inngest validator
      // decision). Connector-surface context tag lets observability
      // consumers distinguish `inngest:<stepId>` from other surfaces.
      // Fire-and-forget — failures inside callbacks must NOT break the
      // function-run.
      const contentForCallback =
        typeof (input as { content?: unknown }).content === 'string'
          ? ((input as { content: string }).content as string)
          : JSON.stringify(input);
      await engine.notifyCachedResult(
        results,
        contentForCallback,
        `inngest:${stepId}`
      );
      const firstBlock = results.find((r) => r.blocked === true);
      const blocked = firstBlock !== undefined;
      return {
        blocked,
        allowed: !blocked,
        // Sprint-13 cumulative-audit sec CS3 closure: `reason` is
        // consumer-readable from the result (not just inside an error
        // message), so attacker-controlled validator output must NOT
        // pass into Inngest step history / OTel spans / logs raw.
        reason: sanitizeReasonText(firstBlock?.reason),
        results,
      };
    });
  };

  return {
    async validateInput(content) {
      let input: ValidatorInput;
      if (typeof content === 'string') {
        input = { kind: 'text', content };
      } else if (
        typeof content === 'object' &&
        content !== null &&
        typeof (content as ValidatorInput).kind === 'string'
      ) {
        input = content as ValidatorInput;
        // B3 pre-flight: canonical-serialize the user-supplied
        // ValidatorInput so non-serializable values (Map / Set /
        // Date / class instances) BLOCK at the boundary instead
        // of throwing into Inngest's retry machinery.
        const preflight = preflightCanonical(input);
        if (preflight !== null) return preflight;
      } else {
        return blockedAt(
          'validateInput: expected a string or a ValidatorInput object'
        );
      }
      return runPipeline(`${stepPrefix}-input`, input);
    },
    async validateOutput(content) {
      if (typeof content !== 'string') {
        return blockedAt('validateOutput: expected a string');
      }
      return runPipeline(`${stepPrefix}-output`, { kind: 'text', content });
    },
    async validateToolArgs(toolName, args) {
      // B2-rev: reject empty / non-string toolName at the boundary.
      if (typeof toolName !== 'string' || toolName.trim().length === 0) {
        return blockedAt('validateToolArgs: toolName must be a non-empty string');
      }
      // B3 pre-flight: catch non-serializable args here.
      const preflight = preflightCanonical({ kind: 'tool_call', toolName, args });
      if (preflight !== null) return preflight;
      return runPipeline(`${stepPrefix}-tool-args`, {
        kind: 'tool_call',
        toolName,
        args,
      });
    },
  };
}

/**
 * Run `canonicalJSONStringify` on the input; if it throws, return a
 * structured BLOCK result rather than letting the throw escape into
 * Inngest's retry machinery (closes T8 — non-serializable args
 * triggering unbounded retries).
 *
 * Returns `null` when the input is serializable (caller proceeds
 * with the normal step.run path).
 */
function preflightCanonical(input: ValidatorInput): BonklmInngestValidateResult | null {
  try {
    canonicalJSONStringify(input);
    return null;
  } catch (err) {
    return blockedAt(
      `bonklm: input is not serializable (${err instanceof Error ? err.message : String(err)})`
    );
  }
}

/**
 * Construct a synthetic BLOCK result for boundary-validation failures
 * (non-serializable input, empty toolName, wrong shape). Stays in
 * the same return shape consumers expect so short-circuit logic
 * works uniformly.
 */
function blockedAt(reason: string): BonklmInngestValidateResult {
  return {
    blocked: true,
    allowed: false,
    reason: sanitizeReasonText(reason),
    results: [],
  };
}

/**
 * Internal: collapse the public options into a resolved set of
 * `cachedValidate` options, auto-applying the salted keyFn default
 * when a cache is provided + no explicit keyFn was given.
 */
function resolveOptions(options: BonklmInngestMiddlewareOptions): ResolvedBundle {
  if (!Array.isArray(options.validators) || options.validators.length === 0) {
    throw new Error(
      'bonklmInngestMiddleware: `validators` MUST be a non-empty array.'
    );
  }

  // B4-sec: validate stepNamePrefix shape. Forbids whitespace-only
  // prefixes (would produce step IDs like `-input` that Inngest may
  // reject) AND substrings that would collide with our internal
  // suffix literals (`-input`, `-output`, `-tool-args`).
  const stepPrefix = options.stepNamePrefix ?? 'bonklm-validate';
  if (typeof stepPrefix !== 'string' || /^\s*$/.test(stepPrefix)) {
    throw new Error(
      'bonklmInngestMiddleware: `stepNamePrefix` must be a non-empty string ' +
        '(default `bonklm-validate` if unset).'
    );
  }
  if (!/^[a-zA-Z0-9_\-:.]+$/.test(stepPrefix)) {
    throw new Error(
      'bonklmInngestMiddleware: `stepNamePrefix` must match [a-zA-Z0-9_\\-:.]+ ' +
        '(Inngest step IDs reject other characters).'
    );
  }
  if (
    /-input$/.test(stepPrefix) ||
    /-output$/.test(stepPrefix) ||
    /-tool-args$/.test(stepPrefix)
  ) {
    throw new Error(
      'bonklmInngestMiddleware: `stepNamePrefix` cannot end with `-input`, ' +
        '`-output`, or `-tool-args` — would collide with the suffix appended ' +
        'by validateInput / validateOutput / validateToolArgs.'
    );
  }

  const engine =
    options.engine ??
    new GuardrailEngine({
      validators: options.validators,
    });

  const wantsCache = options.cache !== undefined;
  const keyFn =
    options.keyFn ??
    (wantsCache ? createSaltedKeyFn(engine.getInstanceId()) : undefined);

  const cachedOptions: CachedValidateOptions = {
    cache: options.cache,
    keyFn,
    defaultTtlMs: options.defaultTtlMs,
    blockedTtlMs: options.blockedTtlMs,
    cacheNamespace: options.cacheNamespace,
    logger: options.logger,
  };

  return {
    // Sprint 14 cumulative sec cross-S2 closure: freeze a shallow copy.
    validators: Object.freeze([...options.validators]),
    cachedOptions,
    stepPrefix,
    engine,
  };
}
