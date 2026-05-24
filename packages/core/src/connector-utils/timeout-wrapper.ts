/**
 * Sprint 30 — `validateWithTimeoutSecure` shared primitive.
 *
 * Background: Sprint 29 audit (architect-CRITICAL) discovered that
 * fastify-plugin's SEC-008 timeout used a broken `AbortController`
 * pattern — it created a controller, called `controller.abort()` on
 * a timer, but `engine.validate()` does not accept an `AbortSignal`,
 * so the abort never propagated. Slow validators silently exceeded
 * the timeout budget and returned `allowed: true` (security regression).
 *
 * Sprint 29 ported the fix to fastify-plugin + nestjs-module. The
 * Sprint 30 sweep found the SAME broken pattern in 20+ other
 * connectors (anthropic, chroma, openai, langchain, llamaindex,
 * google-genai, huggingface, mastra, openai-agents, vercel, weaviate,
 * pinecone, qdrant, mcp, copilotkit, ollama, genkit, langchain-middleware,
 * etc.). Per-connector porting would create 20+ near-identical patches
 * that each need an independent audit pass.
 *
 * Extract a single canonical primitive instead:
 *
 *   - Promise.race against a timeout sentinel
 *   - `.catch()` on the in-flight promise BEFORE the race (absorbs
 *     post-timeout rejections; Node ≥15 crashes on unhandled
 *     rejections by default — DoS vector if validator throws after
 *     timeout)
 *   - `finally` cleanup of the timeout timer
 *   - Caller supplies the timeout sentinel (so connector-specific
 *     telemetry / result-shape mapping stays local to the connector)
 *
 * Usage:
 *
 * ```ts
 * import { validateWithTimeoutSecure } from '@blackunicorn/bonklm';
 *
 * const result = await validateWithTimeoutSecure({
 *   operation: () => engine.validate(content, context),
 *   timeoutMs: validationTimeout,
 *   timeoutSentinel: () => buildTimeoutResultForMyConnector(),
 *   logger,
 * });
 * ```
 *
 * SECURITY-CRITICAL: this helper is the canonical SEC-008 timeout
 * implementation for ALL connectors. Connector authors MUST NOT roll
 * their own AbortController-based timeout — the AbortSignal does not
 * propagate to `engine.validate()` and the timeout becomes a no-op.
 */

/**
 * Sprint 30 code-review MEDIUM-2 closure: use the canonical `Logger`
 * interface from `base/GenericLogger`. There is no cyclic-import
 * risk — `base/GenericLogger.ts` imports nothing, and other connector-
 * utils files (logger.ts, stream-validator.ts) already import from
 * `../base/GenericLogger.js` with no issues. Using the canonical
 * interface prevents drift if the contract grows (e.g. `trace` method).
 */
import type { Logger } from '../base/GenericLogger.js';
import { Severity } from '../base/GuardrailResult.js';
import { sanitizeLogString } from '../common/index.js';

/**
 * Sprint 31 audit closure (security MEDIUM-3 + general hardening):
 * truncate and sanitize error-message strings before logging to prevent
 * log-injection (CWE-117). Caps at 500 chars and strips control chars
 * (\n / \r / NUL / DEL / 0x01-0x08 / 0x0b-0x1f / 0x7f) that could be
 * used to forge log records in downstream aggregators (Datadog,
 * Splunk, etc.).
 *
 * Sprint 33 audit closure: moved the canonical implementation to
 * `common/index.ts` as `sanitizeLogString` so it can be shared with
 * `serializeError`. This adapter preserves the original `unknown` →
 * sanitised-string signature.
 */
function sanitizeErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return sanitizeLogString(raw);
}

/**
 * Options for `validateWithTimeoutSecure`.
 */
export interface ValidateWithTimeoutOptions<R> {
  /**
   * The validation operation to race against the timeout. Typically
   * `() => engine.validate(content, context)`. Wrapped in `Promise.resolve(...)`
   * internally so it can return a sync value or a Promise.
   *
   * Called exactly once per `validateWithTimeoutSecure` invocation.
   */
  operation: () => R | Promise<R>;

  /**
   * Timeout budget in milliseconds. When exceeded, the helper resolves
   * to `timeoutSentinel()` and the in-flight `operation()` promise
   * continues in the background (with its rejection absorbed).
   *
   * Must be a positive finite number. Sprint 30 audit MEDIUM-1
   * closure: values ≤ 0, NaN, Infinity, or non-numbers cause an
   * IMMEDIATE `TypeError` throw — silent misconfiguration would
   * otherwise disable the security boundary.
   */
  timeoutMs: number;

  /**
   * Factory for the timeout-sentinel value. Called LAZILY (only when
   * the timeout fires) so connectors don't pay the cost of building
   * a sentinel that never gets used.
   *
   * Typical: `() => createResult(false, Severity.CRITICAL, [...])`.
   */
  timeoutSentinel: () => R;

  /**
   * Optional logger. When provided, the helper logs:
   *   - `error('[Guardrails] Validation timeout')` when the timeout fires
   *   - `warn('[Guardrails] Validator rejected post-timeout', { error })`
   *     when the in-flight validator throws after the timeout has won
   *     the race (the rejection would otherwise be an unhandled
   *     rejection and crash the process on Node ≥15). Sprint 30 audit
   *     security-MEDIUM: surfaced at WARN (not DEBUG) so operators see
   *     systematic validator failures in production log streams.
   *   - `error('[Guardrails] timeoutSentinel factory threw — using
   *     hardcoded fallback')` when the caller-supplied sentinel factory
   *     itself throws. Hardcoded fallback preserves the security
   *     boundary even when the connector misbehaves.
   */
  logger?: Logger;
}

/**
 * Minimum shape every `R` must satisfy. Sprint 31 cumulative audit
 * (code-review HIGH-1 + architect CRITICAL-1): the helper's
 * `HARDCODED_FALLBACK` is shaped like a blocked decision. Without a
 * generic constraint, callers could pass `R = boolean` or `R = DBRow`
 * and get a structurally-incompatible fallback that crashes the caller
 * at runtime.
 *
 * We require ONLY `allowed: boolean` because that's the only invariant
 * that matters for the SEC-008 security boundary — on timeout, the
 * sentinel MUST set `allowed: false`. Connectors that surface richer
 * shapes (`GuardrailResult` with `blocked`/`severity`/`reason`/etc.,
 * or `EngineResult` with `results[]`) automatically satisfy the
 * constraint via structural typing.
 */
export interface TimeoutSentinelShape {
  /** Must be `false` on timeout. */
  allowed: boolean;
}

/**
 * SEC-008 — race a validation operation against a timeout, returning
 * the operation's result if it completes in budget, or the timeout
 * sentinel if it does not.
 *
 * SECURITY-CRITICAL: do not roll your own AbortController-based
 * timeout. Use this helper.
 *
 * @public Sprint 30 v1.0-RC2 stabilization. The helper signature is
 * frozen; future extensions are additive on the options object.
 */
export async function validateWithTimeoutSecure<R extends TimeoutSentinelShape>(
  options: ValidateWithTimeoutOptions<R>
): Promise<R> {
  const { operation, timeoutMs, timeoutSentinel, logger } = options;
  // Sprint 30 code-review MEDIUM-1 closure: enforce timeoutMs > 0 to
  // prevent a misconfiguration-to-bypass path. A caller that passes
  // `validationTimeout: 0` (e.g. `parseInt('')` from a broken env-var)
  // would otherwise resolve the sentinel on every call — silently
  // disabling validation. Throw at the schema-validation layer instead.
  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError(
      `[Guardrails] validateWithTimeoutSecure: timeoutMs must be a positive finite number, got ${String(timeoutMs)}`
    );
  }
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  // Sprint 30 audit (security MEDIUM): wrap sentinel-factory call in
  // try/catch so a throwing factory cannot trigger an unhandled
  // exception in the setTimeout queue (process crash on Node) or an
  // unhandled rejection in the .catch handler (process exit on Node ≥15).
  // Hardcoded fallback sentinel preserves the security boundary even if
  // the connector's factory misbehaves.
  //
  // Sprint 31 cumulative audit (security MEDIUM-1): use `Severity.CRITICAL`
  // enum instead of raw string 'critical' to avoid drift if the enum
  // value ever changes. Today they're identical at runtime, but the
  // type contract requires the enum reference.
  const HARDCODED_FALLBACK = {
    allowed: false,
    blocked: true,
    severity: Severity.CRITICAL,
    risk_level: 'HIGH',
    risk_score: 100,
    findings: [
      {
        category: 'timeout',
        severity: Severity.CRITICAL,
        description: 'Validation timeout (fallback sentinel — caller-supplied factory threw)',
      },
    ],
    timestamp: Date.now(),
    reason: 'Validation timeout',
  } as unknown as R;
  const safeSentinel = (): R => {
    try {
      return timeoutSentinel();
    } catch (err) {
      logger?.error?.('[Guardrails] timeoutSentinel factory threw — using hardcoded fallback', {
        error: sanitizeErrorMessage(err),
      });
      return HARDCODED_FALLBACK;
    }
  };
  // Sprint 30 audit (architect HIGH): memoize sentinel construction so
  // we never invoke the (potentially side-effecting) factory twice when
  // both the timeout fires AND the operation rejects.
  //
  // Sprint 31 cumulative audit (security CRITICAL + code-review MEDIUM-1):
  // use a separate boolean `built` flag instead of `=== undefined` check
  // so memoization works even when a connector legitimately returns
  // `undefined` as a sentinel (e.g. `R = void | undefined` for a
  // fire-and-forget connector). The prior pattern would re-invoke the
  // factory on every call when the factory returned undefined —
  // defeating both memoization and the side-effect guarantee.
  let memoizedSentinel: R;
  let memoizedBuilt = false;
  const getSentinel = (): R => {
    if (!memoizedBuilt) {
      memoizedSentinel = safeSentinel();
      memoizedBuilt = true;
    }
    return memoizedSentinel;
  };
  // Lazy sentinel construction — only built if the timeout fires.
  const timeoutPromise = new Promise<R>((resolve) => {
    timeoutId = setTimeout(() => {
      logger?.error?.('[Guardrails] Validation timeout');
      resolve(getSentinel());
    }, timeoutMs);
  });
  // Absorb post-timeout rejection BEFORE the race so any later throw
  // from the in-flight operation is caught here, not at the process
  // level. The catch returns the timeout sentinel (memoized) so the
  // type still narrows correctly.
  // Sprint 30 audit (security MEDIUM): log at WARN, not debug — a
  // validator that throws after timeout is a real failure operators
  // need to see, even though the timeout sentinel already won the race.
  // Sprint 31 cumulative audit (security HIGH-3): sanitize err.message
  // before logging (log-injection / CWE-117).
  const operationPromise = Promise.resolve()
    .then(operation)
    .catch((err: unknown) => {
      logger?.warn?.('[Guardrails] Validator rejected post-timeout', {
        error: sanitizeErrorMessage(err),
      });
      return getSentinel();
    });
  try {
    return await Promise.race([operationPromise, timeoutPromise]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}
