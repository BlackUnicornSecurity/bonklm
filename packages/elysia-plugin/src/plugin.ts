/**
 * `bonklmGuardrails(opts)` Elysia plugin
 * ====================================================
 *
 * Structural typing for Elysia to keep `elysia` as an OPTIONAL peer
 * dep. The plugin shape is `(app) => app.onBeforeHandle(...)` —
 * compatible with Elysia 1.4.x lifecycle hooks.
 */
import type { GuardrailEngine } from '@blackunicorn/bonklm';
import {
  runRequestValidation,
  WebMiddlewareBlockedError,
  type WebMiddlewareBlockEvent
} from '@blackunicorn/bonklm-web-middleware-utils';

export interface BonklmElysiaOptions {
  engine: GuardrailEngine;
  /** Operator allowlist callback. Return `false` to skip validation. */
  shouldValidate?: (body: string, context: ElysiaContextLike) => boolean;
  /** Fires on BLOCK before the 403 response is sent. */
  onBlock?: (event: WebMiddlewareBlockEvent) => void;
  /** Error sink for validator exceptions. */
  onError?: (err: unknown) => void;
  /**
   * Custom BLOCK response builder. Default: HTTP 403 + JSON
   * `{ error: 'request_blocked', reason, category? }`.
   */
  blockedResponse?: (event: WebMiddlewareBlockEvent) => unknown;
}

interface ElysiaContextLike {
  body?: unknown;
  set?: { status?: number | string };
  request?: { method?: string };
}

interface ElysiaAppLike {
  onBeforeHandle: (fn: (ctx: ElysiaContextLike) => unknown | Promise<unknown>) => ElysiaAppLike;
}

/**
 * Returns an Elysia plugin function. Usage:
 *
 *   app.use(bonklmGuardrails({ engine }))
 *
 * Structural typing: `Elysia.use(fn)` accepts any function that
 * receives the app and returns the app (or void).
 */
export function bonklmGuardrails(options: BonklmElysiaOptions) {
  if (!options?.engine) {
    throw new TypeError('bonklmGuardrails: options.engine (GuardrailEngine) is required.');
  }
  return (app: ElysiaAppLike): ElysiaAppLike => {
    return app.onBeforeHandle(async (ctx): Promise<unknown> => {
      // Skip when no body (GET / HEAD).
      if (ctx.body === undefined || ctx.body === null) return undefined;

      const bodyString = stringifyBody(ctx.body);
      if (bodyString.length === 0) return undefined;
      if (options.shouldValidate && options.shouldValidate(bodyString, ctx) === false) {
        return undefined;
      }

      try {
        await runRequestValidation(
          {
            engine: options.engine,
            onBlock: options.onBlock,
            onError: options.onError
          },
          bodyString
        );
      } catch (err) {
        if (err instanceof WebMiddlewareBlockedError) {
          if (ctx.set) ctx.set.status = 403;
          if (options.blockedResponse) {
            return options.blockedResponse({
              kind: 'web-middleware',
              phase: 'request',
              reason: err.message,
              category: err.category,
              severity: err.severity
            });
          }
          return {
            error: 'request_blocked',
            reason: err.message,
            category: err.category
          };
        }
        throw err;
      }
      return undefined;
    });
  };
}

function stringifyBody(body: unknown): string {
  if (typeof body === 'string') return body;
  if (body === null || body === undefined) return '';
  try {
    return JSON.stringify(body);
  } catch {
    return `[unstringifiable:${typeof body}]`;
  }
}
