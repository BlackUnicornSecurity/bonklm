/**
 * Story 2.2 — `honoGuardrails(engine, options?)`
 * ===============================================
 *
 * Canonical-shape `<framework>Guardrails(engine, options?)` middleware
 * factory per the connector-style ADR (Story 2.1b-connector-style-ADR,
 * shape #3). Returns a Hono `MiddlewareHandler` that:
 *
 *   1. Extracts the validatable text from the request body
 *      (JSON / form-encoded / plain text — see body-extractor.ts).
 *   2. Runs the engine's validator+guard chain against the extracted text.
 *   3. On block: returns a 400 JSON `{ error, category, severity? }`
 *      response WITHOUT calling `next()`. Optional `onBlocked` callback
 *      fires for telemetry.
 *   4. On pass: calls `next()` — the application's route handler runs
 *      as normal.
 *
 * **Edge-targeted**: this connector builds on BonkLM core APIs that use
 * Node built-ins, so it ships on Workerd (`nodejs_compat`) / Deno / Bun
 * in addition to Node — but not on strict Vercel `edge-light`. Engine
 * construction is the caller's
 * responsibility — Workerd consumers MUST call
 * `assertAsyncLocalStorageHealthy(AlsCtor)` from
 * `@blackunicorn/bonklm/edge` before constructing the engine (the
 * docs/user/migration/edge-string-handlers.md anchor names this).
 *
 * **Streaming**: this Phase-1 middleware validates the REQUEST body.
 * Response streaming (`c.streamSSE` / `c.stream`) is the consumer's
 * responsibility — they wire `BufferedReleaseGate` from
 * `@blackunicorn/bonklm/edge` into their stream writer. A future
 * `validatedStream` helper is tracked in the package roadmap.
 *
 * @package @blackunicorn/bonklm-hono
 */
import { createLogger, type GuardrailEngine, type Logger, type Validator } from '@blackunicorn/bonklm';
import { ConnectorValidationError } from '@blackunicorn/bonklm/core/connector-utils';
import { extractBody, type ExtractedBody } from './body-extractor.js';
import type {
  HonoContextLike,
  HonoGuardrailsErrorResponse,
  HonoGuardrailsOptions,
  HonoMiddlewareHandler,
  HonoNext
} from './types.js';

const DEFAULT_VALIDATE_METHODS: ReadonlyArray<string> = ['POST', 'PUT', 'PATCH'];

/**
 * Build the Hono middleware. Returns an async `(c, next)` handler that
 * Hono dispatches per-request.
 *
 * @example
 * ```ts
 * import { Hono } from 'hono';
 * import { GuardrailEngine, PromptInjectionValidator } from '@blackunicorn/bonklm/edge';
 * import { honoGuardrails } from '@blackunicorn/bonklm-hono';
 *
 * const engine = new GuardrailEngine({
 *   validators: [new PromptInjectionValidator()],
 * });
 *
 * const app = new Hono();
 * app.use('*', honoGuardrails(engine));
 * app.post('/chat', async (c) => {
 *   const body = await c.req.json();
 *   // ... call the LLM, return the response
 *   return c.json({ ok: true });
 * });
 * ```
 */
export function honoGuardrails(engine: GuardrailEngine, options: HonoGuardrailsOptions = {}): HonoMiddlewareHandler {
  // Iter-1-ready (Story 2.1b adversarial #7 / security A&D-7): freeze
  // options so a downstream middleware sharing the reference cannot
  // mutate `productionMode` or callbacks after construction.
  const frozenOptions = Object.freeze({ ...options });
  const logger: Logger = frozenOptions.logger ?? createLogger('console');
  const productionMode = resolveProductionMode(frozenOptions.productionMode);
  const validateMethods = new Set(
    (frozenOptions.validateMethods ?? DEFAULT_VALIDATE_METHODS).map(m => m.toUpperCase())
  );
  const bodyFields = frozenOptions.bodyFields;
  const validatorOverride: Validator[] | undefined = frozenOptions.validators;

  // Iter-1 security A&D #5: construction-time warning when `bodyFields`
  // is set — fields absent from the list pass through unvalidated.
  // The opt-in allowlist is intentional but operationally subtle;
  // a one-shot warn surfaces the design constraint at deploy time.
  if (bodyFields !== undefined && bodyFields.length > 0) {
    logger.warn(
      '[bonklm-hono] bodyFields allowlist active — fields NOT in this list pass through ' +
        'UNVALIDATED. Audit your route for any new field that accepts user input.',
      { bodyFields }
    );
  }

  return async function bonklmHonoMiddleware(c: HonoContextLike, next: HonoNext): Promise<Response | void> {
    const method = c.req.method.toUpperCase();
    if (!validateMethods.has(method)) {
      // Method not in the validate set — pass through.
      return next();
    }

    // Extract the validatable text from the body. Never throws — empty
    // body, malformed JSON, etc. all surface as `{ text: '' }`.
    let extracted: ExtractedBody;
    try {
      extracted = await extractBody(c.req.raw, bodyFields);
    } catch (err) {
      // Extra defence-in-depth — extractBody is documented as never-throws
      // but a future refactor might violate that. Log + skip validation
      // rather than 500-ing on the consumer's request.
      const e = err as Error;
      logger.warn('[bonklm-hono] body extraction threw; skipping validation', {
        error: e.message
      });
      return next();
    }

    // Iter-1 security BLOCK #4: charset mismatch refuse. Returning
    // 415 Unsupported Media Type prevents the validator from scanning
    // mojibake produced by a UTF-16-as-UTF-8 misread.
    if (extracted.charsetUnsupported === true) {
      const errorResponse: HonoGuardrailsErrorResponse = {
        error: productionMode
          ? 'Unsupported request charset'
          : 'Unsupported charset in content-type header. Supported: utf-8, ascii, iso-8859-1.',
        category: 'unsupported_charset'
      };
      return c.json(errorResponse, 415);
    }

    if (extracted.text.length === 0) {
      // Empty body — nothing to validate. Pass through.
      return next();
    }

    // Run the engine (or a per-middleware validator chain when an
    // override was supplied).
    let blockedReason: string | undefined;
    const blockedCategory: string = 'validation_failed';
    let severity: string | undefined;

    try {
      if (validatorOverride !== undefined && validatorOverride.length > 0) {
        // Per-middleware override path — run validators directly without
        // going through the engine (engine validators may differ).
        for (const validator of validatorOverride) {
          const result = await validator.validate(extracted.text);
          if (result.blocked) {
            blockedReason = result.reason ?? 'validation blocked';
            severity = result.risk_level;
            break;
          }
        }
      } else {
        // Default path — run the engine.
        const result = await engine.validate(extracted.text);
        if (result.blocked) {
          blockedReason = result.reason ?? 'validation blocked';
          severity = result.risk_level;
        }
      }
    } catch (err) {
      // Engine errors — TIMEOUT, internal exceptions — surface as
      // 500-level engine_error rather than 400 validation_failed so
      // operators can distinguish at the HTTP layer.
      const e = err as Error;
      logger.error('[bonklm-hono] engine threw during validate()', {
        error: e.message
      });
      const errorResponse: HonoGuardrailsErrorResponse = {
        error: productionMode ? 'Internal validation error' : `Engine error: ${e.message}`,
        category: 'engine_error'
      };
      return c.json(errorResponse, 500);
    }

    if (blockedReason !== undefined) {
      // Fire the onBlocked callback BEFORE returning the response so
      // telemetry-forwarding code runs before the network write.
      try {
        frozenOptions.onBlocked?.(blockedReason, blockedCategory);
      } catch (callbackErr) {
        // The callback threw — log but DO NOT propagate. The block
        // decision is already made.
        // Iter-1 code-reviewer LOW: include stack trace so future
        // regressions in consumer callbacks are debuggable. Falling
        // back to message-only when stack is absent.
        const e = callbackErr as Error;
        logger.warn('[bonklm-hono] onBlocked callback threw', {
          error: e.message,
          stack: e.stack
        });
      }
      const errorResponse: HonoGuardrailsErrorResponse = {
        error: productionMode ? 'Request blocked by security policy' : blockedReason,
        category: blockedCategory,
        ...(severity !== undefined && { severity })
      };
      return c.json(errorResponse, 400);
    }

    // Validation passed — defer to the next handler.
    return next();
  };
}

/**
 * Resolve the production-mode flag. Honours the explicit option when
 * set; otherwise falls back to `process.env.NODE_ENV === 'production'`
 * on Node and `false` on edge runtimes where `process` is absent.
 *
 * Mirrors the `resolveEnv` pattern in `guards/production.ts` —
 * `typeof` guard avoids ReferenceError on Workerd.
 */
function resolveProductionMode(explicit: boolean | undefined): boolean {
  if (explicit !== undefined) return explicit;
  if (typeof process !== 'undefined' && process && process.env) {
    return process.env.NODE_ENV === 'production';
  }
  return false;
}

// Re-export the error response type so consumers can type-narrow.
export { ConnectorValidationError };
