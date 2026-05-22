/**
 * @blackunicorn/bonklm-trigger — withBonkLM factory
 * =================================================
 *
 * `withBonkLM(opts)` returns `{ middleware, onFailure }` ready to spread
 * into Trigger.dev v3/v4's `task({...})` factory:
 *
 *   import { task, AbortTaskRunError } from "@trigger.dev/sdk/v3";
 *   import { withBonkLM, getBonklmHandle } from "@blackunicorn/bonklm-trigger";
 *
 *   const { middleware, onFailure } = withBonkLM({ validators, cache });
 *   export const myTask = task({
 *     id: "my-task",
 *     middleware,
 *     onFailure,
 *     run: async (payload, { ctx }) => {
 *       const r = await getBonklmHandle(ctx).validateInput(payload.prompt);
 *       if (r.blocked) {
 *         // SECURITY: AbortTaskRunError terminates the run immediately
 *         // without exhausting retry budget. Use a STATIC reason
 *         // string here — `r.reason` is attacker-controlled validator
 *         // output and surfaces in the Trigger.dev dashboard's
 *         // run-status field where it persists to other dashboard
 *         // viewers. The full sanitized reason is in `r.results`
 *         // (logged via OTel / your structured logger).
 *         throw new AbortTaskRunError('blocked: guardrail decision');
 *       }
 *     },
 *   });
 *
 * Design properties (matched to Story 2.9 AC):
 *
 *   1. **CRIU-safe handle via locals.** The middleware builds a
 *      `BonklmTriggerHandle` and stores it in Trigger.dev's `locals`
 *      registry. Locals are part of the V8 heap snapshot, so when
 *      `wait.for(...)` checkpoints the run + restores it minutes/hours
 *      later, the handle is still there. Consumers retrieve it inside
 *      `run()` via `getBonklmHandle()`.
 *
 *   2. **Retry-survival via cachedValidate keyed by ctx.run.id.** Each
 *      handle is scoped with `cacheNamespace = ${baseNs}::run-${run.id}`.
 *      When Trigger.dev retries the same run (run.id unchanged), the
 *      cachedValidate primitive serves the cached BLOCK/ALLOW without
 *      re-firing the validator. Different run.ids = different namespaces
 *      = no cross-run cache poisoning.
 *
 *   3. **`ctx.run.isReplay` awareness.** The middleware unconditionally
 *      sets the handle in locals; on `isReplay=true` the locals are
 *      already restored from CRIU, but re-setting is idempotent (same
 *      cacheNamespace key derivation, fresh handle object). We don't
 *      optimize the rebuild because the cost is negligible vs the
 *      risk of locals NOT being restored (cold-machine retry from
 *      checkpoint failure).
 *
 *   4. **`onFailure` observability hook.** Emits a structured warn
 *      log via the configured logger. Trigger.dev's lifecycle ignores
 *      the return value (per SDK contract), so onFailure can NEVER
 *      override retry behavior — that's `AbortTaskRunError` thrown
 *      from `run()`.
 *
 * Post-3-lane-audit BLOCK closures (inherits Story 2.8 hardening +
 * Story 2.9 audit findings):
 *   - **B1**: `resolveOptions` runs ONCE at factory-construction time.
 *     Engine + base keyFn close over the factory closure; per-attempt
 *     middleware mints a fresh `cachedOptions` with the run-id namespace
 *     mixed in but reuses the salted keyFn.
 *   - **B2-rev**: `validateToolArgs` rejects empty / non-string toolName.
 *   - **B3-sec**: `canonicalJSONStringify` pre-flight on `validateInput`
 *     + `validateToolArgs`. Non-serializable inputs return a structured
 *     BLOCK rather than throwing into Trigger.dev's retry machinery.
 *   - **B4-sec**: `cacheNamespace` rejected if it contains `::` (would
 *     collide with the run-id separator).
 *   - **B5-arch**: `getBonklmHandle()` throws a descriptive error when
 *     middleware did not run, rather than returning undefined.
 *   - **CS3 (Sprint 13 cumulative)**: attacker-controlled validator
 *     output / error messages pass through `sanitizeReasonText` before
 *     hitting observability sinks.
 *   - **arch X5 / sec S2 / rev R1 (Story 2.9)**: `getBonklmHandle()`
 *     does structural validation on the handle BEFORE returning it.
 *     Closes (a) supply-chain locals-slot squatting (a peer dep
 *     calls `locals.set(bonklmHandleLocalsKey, backdoor)` with a
 *     zero-block handle), (b) `null` short-circuit of the
 *     undefined-only check, and (c) cross-task locals bleed (optional
 *     `ctx` parameter to `getBonklmHandle(ctx)` asserts the handle's
 *     baked-in run.id matches the calling task's run.id).
 *   - **rev R3 (Story 2.9)**: `validateInput` runtime-checks the
 *     discriminant-required field for the `kind: 'text'` branch.
 *     Other kinds delegated to the validator's own shape assertions.
 *   - **sec S7 (Story 2.9)**: `validators` array is `Object.freeze`d
 *     at factory time so post-factory mutation cannot silently
 *     change the pipeline a cached BLOCK was computed against.
 *
 * @package @blackunicorn/bonklm-trigger
 */
import { locals } from '@trigger.dev/sdk/v3';
import {
  cachedValidate,
  canonicalJSONStringify,
  createSaltedKeyFn,
  GuardrailEngine,
  type CachedValidateOptions,
  type KeyFn,
  type Validator,
  type ValidatorInput,
} from '@blackunicorn/bonklm';
import { sanitizeReasonText } from '@blackunicorn/bonklm-browser-agents-core';
import type {
  BonklmTriggerBindings,
  BonklmTriggerFailureParams,
  BonklmTriggerHandle,
  BonklmTriggerMiddlewareParams,
  BonklmTriggerOptions,
  BonklmTriggerValidateResult,
} from './types.js';

/**
 * Locals key for the per-run BonkLM handle. Module-scope so the symbol
 * binding is stable across CRIU restore — Trigger.dev's locals manager
 * uses `Symbol.for(id)` internally so the same string id always
 * resolves to the same registry slot.
 *
 * @internal — exported from this module for the factory + the
 *   structural accessor `getBonklmHandle()`. NOT re-exported from the
 *   public barrel: granting consumers raw `locals.set` access here is
 *   an attractive footgun (arch X6 / sec S2 — locals-slot squatting).
 *   Consumers route through `getBonklmHandle()` which validates the
 *   handle's structural shape before returning it.
 */
export const bonklmHandleLocalsKey = locals.create<BonklmTriggerHandle>(
  '@blackunicorn/bonklm:handle'
);

/**
 * Symbol-keyed tag on every BonkLM handle. Holds the `ctx.run.id` that
 * was active when the handle was minted. Used by `getBonklmHandle(ctx)`
 * to detect cross-task locals bleed (arch X5 + sec S9 #3): if a worker
 * process retains the locals slot between two distinct runs and the
 * SECOND run's middleware hasn't fired yet for some reason, the handle
 * returned from `locals.get` belongs to a DIFFERENT run and serving it
 * to the consumer's `validateInput(...)` would compute against a stale
 * cacheNamespace.
 *
 * Non-enumerable so the tag never serialises through canonical-JSON
 * inputs or appears in OTel span attributes.
 */
const BONKLM_HANDLE_RUN_ID = Symbol('@blackunicorn/bonklm:trigger:handle.runId');

/**
 * Structural-validation predicate for objects retrieved from the locals
 * slot. Closes sec S2 (supply-chain locals-slot squatting): a malicious
 * peer dep that calls `locals.set(bonklmHandleLocalsKey, backdoor)`
 * with a zero-block backdoor handle is detected here before any
 * `validate-*` call reaches the validator pipeline.
 */
function isStructurallyValidHandle(value: unknown): value is BonklmTriggerHandle {
  if (value === null || typeof value !== 'object') return false;
  const v = value as Partial<BonklmTriggerHandle>;
  return (
    typeof v.validateInput === 'function' &&
    typeof v.validateOutput === 'function' &&
    typeof v.validateToolArgs === 'function'
  );
}

/**
 * Retrieve the BonkLM validation handle from Trigger.dev locals. Call
 * this inside `task({...}).run` AFTER the `withBonkLM` middleware has
 * had a chance to set up the handle.
 *
 * @param ctx - OPTIONAL. When supplied, asserts that the handle in
 *   locals was minted for THIS task's `ctx.run.id`. Detects cross-task
 *   locals bleed in any future runtime model where Trigger.dev shares
 *   locals across concurrent runs on one worker. Cheap, recommended.
 *
 * @throws when the handle is absent (middleware not wired), when the
 *   handle fails structural validation (sec S2 — supply-chain
 *   squatting), or when `ctx.run.id` mismatches the handle's tag
 *   (arch X5 — cross-task bleed).
 */
export function getBonklmHandle(
  ctx?: { run: { id: string } }
): BonklmTriggerHandle {
  const raw = locals.get(bonklmHandleLocalsKey);
  if (raw == null) {
    throw new Error(
      'getBonklmHandle(): no BonkLM handle in Trigger.dev locals. Ensure ' +
        '`withBonkLM(...)` is spread into your task({middleware, onFailure, ...}) ' +
        'options before calling this from inside run(). If you are running ' +
        'outside a Trigger.dev runner (unit tests), wire ' +
        '`StandardLocalsManager` via `localsAPI.setGlobalLocalsManager(...)` ' +
        'in your test setup.'
    );
  }
  // sec S2 / rev R1 closure: defend against null-handle and against
  // a squatting peer dep that wrote a non-Handle object into the slot.
  if (!isStructurallyValidHandle(raw)) {
    throw new Error(
      'getBonklmHandle(): the value in the BonkLM locals slot is not a ' +
        'valid BonklmTriggerHandle (missing one or more of validateInput, ' +
        'validateOutput, validateToolArgs). Possible causes: a peer dependency ' +
        'wrote into the slot (supply-chain substitution), a test harness ' +
        'injected a non-conformant stub, or the slot was cleared mid-run.'
    );
  }
  // arch X5 closure: when the caller supplies ctx, verify the handle
  // was minted for the SAME run. Cross-task bleed is impossible in
  // Trigger.dev's standard one-run-per-worker model but the assertion
  // is cheap and forward-compatible.
  if (ctx !== undefined) {
    const taggedRunId = (raw as unknown as Record<symbol, unknown>)[
      BONKLM_HANDLE_RUN_ID
    ];
    if (typeof taggedRunId === 'string' && taggedRunId !== ctx.run.id) {
      throw new Error(
        `getBonklmHandle(ctx): handle in locals was minted for run ` +
          `'${taggedRunId}' but the caller passed ctx.run.id='${ctx.run.id}'. ` +
          'This indicates cross-task locals bleed (one worker running two ' +
          'task runs without the locals registry being reset between them). ' +
          'Either reset locals between runs, or do not pass ctx to ' +
          'getBonklmHandle() if you accept the bleed.'
      );
    }
  }
  return raw;
}

/**
 * Internal: a resolved + frozen bundle that closes over the engine,
 * salted keyFn, and base cachedValidate options once at factory time.
 * Reused across every middleware invocation so the engineInstanceId
 * salt stays stable across attempts.
 */
interface ResolvedBundle {
  /**
   * Frozen validator pipeline (sec S7 closure). The factory caller's
   * array reference is shallow-copied + frozen so post-factory mutation
   * cannot change the pipeline a cached BLOCK was computed against.
   */
  validators: readonly Validator[];
  baseCachedOptions: Omit<CachedValidateOptions, 'cacheNamespace'>;
  baseCacheNamespace: string | undefined;
  logger: CachedValidateOptions['logger'];
}

/**
 * Options for the direct handle constructor (test-harness path).
 * Mirrors `BonklmTriggerOptions` + adds `runId` so the consumer can
 * exercise the per-run cacheNamespace derivation without going through
 * the middleware.
 */
export interface CreateBonklmTriggerHandleOptions extends BonklmTriggerOptions {
  /** Trigger.dev run id, mixed into the cacheNamespace for retry-survival. */
  runId: string;
}

/**
 * Direct handle constructor. Useful for:
 *   - Unit tests that don't want to go through the Trigger.dev runtime.
 *   - Custom-middleware composition where the consumer manages locals
 *     directly.
 *   - Non-Trigger.dev contexts that want the same validate-* surface.
 *
 * For Trigger.dev `task({...})` consumers, prefer the `withBonkLM`
 * factory — it wires up the locals storage + onFailure hook for you.
 */
export function createBonklmTriggerHandle(
  options: CreateBonklmTriggerHandleOptions
): BonklmTriggerHandle {
  const bundle = resolveOptions(options);
  return handleFromBundle(bundle, options.runId);
}

/**
 * Factory entrypoint. Returns the `{ middleware, onFailure }` pair to
 * spread into `task({...})`.
 *
 * Resolution is hoisted to factory time — the engine, salted keyFn,
 * and base cachedValidate options are constructed ONCE per factory
 * call and reused across every middleware invocation. This is what
 * makes cross-attempt cache dedupe work without forcing consumers to
 * pass an explicit `engine`.
 *
 * @example
 * ```ts
 * import { task, AbortTaskRunError } from "@trigger.dev/sdk/v3";
 * import { withBonkLM, getBonklmHandle } from "@blackunicorn/bonklm-trigger";
 * import { PromptInjectionValidator } from "@blackunicorn/bonklm";
 *
 * const { middleware, onFailure } = withBonkLM({
 *   validators: [new PromptInjectionValidator()],
 *   cache: redisCache,
 * });
 *
 * export const myTask = task({
 *   id: "my-task",
 *   middleware,
 *   onFailure,
 *   retry: { maxAttempts: 3 }, // BLOCK decisions throw AbortTaskRunError so retries
 *                              // are reserved for transient validator-infra errors.
 *   run: async (payload, { ctx }) => {
 *     const r = await getBonklmHandle(ctx).validateInput(payload.prompt);
 *     if (r.blocked) throw new AbortTaskRunError('blocked: guardrail decision');
 *     // ... downstream LLM call
 *   },
 * });
 * ```
 */
export function withBonkLM(options: BonklmTriggerOptions): BonklmTriggerBindings {
  const bundle: ResolvedBundle = resolveOptions(options);

  const middleware = async (
    params: BonklmTriggerMiddlewareParams
  ): Promise<void> => {
    // Build a per-run handle with the cacheNamespace keyed by run.id.
    // This is what gives us retry-survival: same run.id across retries
    // = same cacheNamespace = cache hit on identical inputs.
    const handle = handleFromBundle(bundle, params.ctx.run.id);
    locals.set(bonklmHandleLocalsKey, handle);
    await params.next();
  };

  const onFailure = async (params: BonklmTriggerFailureParams): Promise<void> => {
    const errorMsg =
      params.error instanceof Error
        ? params.error.message
        : typeof params.error === 'string'
          ? params.error
          : 'unknown error';
    bundle.logger?.warn?.(
      '@blackunicorn/bonklm-trigger: task failure observed',
      {
        runId: params.ctx.run.id,
        // CS3 closure: sanitize attacker-controlled error reason text
        // before emitting to downstream observability sinks.
        error: sanitizeReasonText(errorMsg) ?? '',
      }
    );
  };

  return { middleware, onFailure };
}

/**
 * Internal: collapse the public options into a resolved bundle. Runs
 * once per `withBonkLM` factory call. Validates required fields +
 * sanitizes the cacheNamespace input.
 */
function resolveOptions(options: BonklmTriggerOptions): ResolvedBundle {
  if (!Array.isArray(options.validators) || options.validators.length === 0) {
    throw new Error(
      'withBonkLM: `validators` MUST be a non-empty array.'
    );
  }

  // B4-sec: refuse cacheNamespaces that would collide with the run-id
  // separator. We append `::run-${runId}` at attempt time; if the base
  // namespace also contains `::` the parser at the cachedValidate
  // boundary may produce ambiguous prefixes.
  if (
    options.cacheNamespace !== undefined &&
    options.cacheNamespace.includes('::')
  ) {
    throw new Error(
      'withBonkLM: `cacheNamespace` MUST NOT contain `::` (reserved as ' +
        'the run-id separator inside the connector).'
    );
  }

  const engine =
    options.engine ??
    new GuardrailEngine({
      validators: options.validators,
    });

  const wantsCache = options.cache !== undefined;
  const keyFn: KeyFn | undefined =
    options.keyFn ??
    (wantsCache ? createSaltedKeyFn(engine.getInstanceId()) : undefined);

  return {
    // sec S7 closure: freeze a shallow copy so post-factory mutation
    // (push / splice / index-assign) of the consumer's original array
    // does not leak into subsequent middleware invocations. Validators
    // themselves are not deep-frozen — they're consumer-defined classes
    // with internal state we cannot generically freeze.
    validators: Object.freeze([...options.validators]),
    baseCachedOptions: {
      cache: options.cache,
      keyFn,
      defaultTtlMs: options.defaultTtlMs,
      blockedTtlMs: options.blockedTtlMs,
      logger: options.logger,
    },
    baseCacheNamespace: options.cacheNamespace,
    logger: options.logger,
  };
}

/**
 * Internal: build a per-attempt handle from a resolved bundle + the
 * current run.id. The cacheNamespace incorporates `run-${runId}` so
 * retries of the SAME run share cache; different runs do NOT.
 */
function handleFromBundle(
  bundle: ResolvedBundle,
  runId: string
): BonklmTriggerHandle {
  const { validators, baseCachedOptions, baseCacheNamespace } = bundle;
  const cacheNamespace =
    baseCacheNamespace !== undefined
      ? `${baseCacheNamespace}::run-${runId}`
      : `@blackunicorn/bonklm-trigger@0.4::run-${runId}`;

  const cachedOptions: CachedValidateOptions = {
    ...baseCachedOptions,
    cacheNamespace,
  };

  const runPipeline = async (
    input: ValidatorInput
  ): Promise<BonklmTriggerValidateResult> => {
    // rev R4 (Story 2.9 audit) DESIGN NOTE: throws from cachedValidate
    // propagate intentionally — Trigger.dev's task runner catches them
    // and triggers a retry per the consumer's `retry` config. Do NOT
    // wrap in try/catch and translate to a structured BLOCK; validator
    // infrastructure errors are distinct from a deterministic BLOCK
    // decision and the retry path is the right escalation.
    const results = await cachedValidate(
      validators as Validator[],
      input,
      cachedOptions
    );
    const firstBlock = results.find((r) => r.blocked === true);
    const blocked = firstBlock !== undefined;
    return {
      blocked,
      allowed: !blocked,
      reason: sanitizeReasonText(firstBlock?.reason),
      results,
    };
  };

  const handle: BonklmTriggerHandle = {
    async validateInput(content) {
      let input: ValidatorInput;
      if (typeof content === 'string') {
        // rev R2 (Story 2.9 audit) DESIGN NOTE: the string-wrapping
        // path skips `preflightCanonical` intentionally — a raw string
        // wrapped as `{ kind: 'text', content }` is always JSON-
        // serializable, so the preflight is a no-op here. Do NOT
        // remove the preflight from the `else if` (object) branch
        // below thinking it should be symmetric — that branch CAN
        // receive Maps / Sets / class instances.
        input = { kind: 'text', content };
      } else if (
        typeof content === 'object' &&
        content !== null &&
        typeof (content as ValidatorInput).kind === 'string'
      ) {
        // rev R3 (Story 2.9 audit) closure: assert the
        // discriminant-required field for the `kind: 'text'` branch.
        // The discriminated union declares `content: string`; a
        // numeric / boolean / undefined `content` would slip past the
        // canonical-serialization preflight (numbers are JSON-safe)
        // and reach validators that may NOT handle the malformed
        // case. Other discriminants (retrieved_docs, memory_write,
        // tool_call) carry richer shapes — those validators are
        // expected to assert their own discriminant fields and the
        // connector does not duplicate that contract here.
        const maybeText = content as { kind: string; content?: unknown };
        if (maybeText.kind === 'text' && typeof maybeText.content !== 'string') {
          return blockedAt(
            'validateInput: kind=text requires `content` to be a string'
          );
        }
        input = content as ValidatorInput;
        // B3 pre-flight: canonical-serialize the user-supplied
        // ValidatorInput so non-serializable values (Map / Set / Date
        // / class instances) BLOCK at the boundary instead of throwing
        // into Trigger.dev's retry machinery.
        const preflight = preflightCanonical(input);
        if (preflight !== null) return preflight;
      } else {
        return blockedAt(
          'validateInput: expected a string or a ValidatorInput object'
        );
      }
      return runPipeline(input);
    },
    async validateOutput(content) {
      if (typeof content !== 'string') {
        return blockedAt('validateOutput: expected a string');
      }
      return runPipeline({ kind: 'text', content });
    },
    async validateToolArgs(toolName, args) {
      // B2-rev: reject empty / non-string toolName at the boundary.
      if (typeof toolName !== 'string' || toolName.trim().length === 0) {
        return blockedAt('validateToolArgs: toolName must be a non-empty string');
      }
      // B3 pre-flight: catch non-serializable args here.
      const preflight = preflightCanonical({ kind: 'tool_call', toolName, args });
      if (preflight !== null) return preflight;
      return runPipeline({
        kind: 'tool_call',
        toolName,
        args,
      });
    },
  };

  // arch X5 / sec S9 closure: tag the handle with the run.id it was
  // minted for. `getBonklmHandle(ctx)` asserts this matches `ctx.run.id`
  // so cross-task locals bleed is detectable. Symbol-keyed +
  // non-enumerable so the tag never serialises through canonical-JSON
  // inputs or appears in OTel span attributes.
  Object.defineProperty(handle, BONKLM_HANDLE_RUN_ID, {
    value: runId,
    enumerable: false,
    writable: false,
    configurable: false,
  });

  return handle;
}

/**
 * Run `canonicalJSONStringify` on the input; if it throws, return a
 * structured BLOCK rather than letting the throw escape into
 * Trigger.dev's retry machinery (closes T8 — non-serializable args
 * triggering unbounded retries).
 */
function preflightCanonical(
  input: ValidatorInput
): BonklmTriggerValidateResult | null {
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
 * (non-serializable input, empty toolName, wrong shape). Stays in the
 * same return shape consumers expect so short-circuit logic works
 * uniformly.
 */
function blockedAt(reason: string): BonklmTriggerValidateResult {
  return {
    blocked: true,
    allowed: false,
    reason: sanitizeReasonText(reason),
    results: [],
  };
}
