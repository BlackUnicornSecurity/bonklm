/**
 * Story 3.9 — `bonklmRouteHandler({GET, POST, ...})` Next.js Route Handler wrapper.
 *
 * Wraps user-defined HTTP-method handlers. For body-bearing methods
 * (POST / PUT / PATCH / DELETE), validates the request body via
 * `runRequestValidation`. On BLOCK returns 403 JSON.
 *
 * ```ts
 * // app/api/chat/route.ts
 * import { bonklmRouteHandler } from '@blackunicorn/bonklm-nextjs';
 *
 * export const { POST } = bonklmRouteHandler(
 *   {
 *     POST: async (req) => {
 *       const { msg } = await req.json();
 *       return Response.json({ echo: msg });
 *     },
 *   },
 *   { engine }
 * );
 * ```
 */
import type { GuardrailEngine } from '@blackunicorn/bonklm';
import {
  runRequestValidation,
  WebMiddlewareBlockedError,
  type WebMiddlewareBlockEvent
} from '@blackunicorn/bonklm-web-middleware-utils';

export interface BonklmRouteHandlerOptions {
  engine: GuardrailEngine;
  onBlock?: (event: WebMiddlewareBlockEvent) => void;
  onError?: (err: unknown) => void;
  blockedResponse?: (event: WebMiddlewareBlockEvent) => Response;
}

export type RouteHandlerMethod = (req: Request) => Promise<Response>;

export type RouteHandlerMethods = Partial<{
  GET: RouteHandlerMethod;
  POST: RouteHandlerMethod;
  PUT: RouteHandlerMethod;
  PATCH: RouteHandlerMethod;
  DELETE: RouteHandlerMethod;
  HEAD: RouteHandlerMethod;
  OPTIONS: RouteHandlerMethod;
}>;

const BODY_BEARING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function bonklmRouteHandler(
  handlers: RouteHandlerMethods,
  options: BonklmRouteHandlerOptions
): RouteHandlerMethods {
  if (!options?.engine) {
    throw new TypeError('bonklmRouteHandler: options.engine is required.');
  }
  const wrapped: RouteHandlerMethods = {};
  for (const [method, handler] of Object.entries(handlers)) {
    if (!handler) continue;
    if (!BODY_BEARING_METHODS.has(method)) {
      // GET / HEAD / OPTIONS — no body to validate; pass through.
      (wrapped as Record<string, RouteHandlerMethod>)[method] = handler;
      continue;
    }
    (wrapped as Record<string, RouteHandlerMethod>)[method] = async (req: Request) => {
      // Clone so the user handler can still read the body via req.text/json.
      const clone = req.clone();
      let body: string;
      try {
        body = await clone.text();
      } catch {
        body = '';
      }
      try {
        await runRequestValidation(
          {
            engine: options.engine,
            onBlock: options.onBlock,
            onError: options.onError
          },
          body
        );
      } catch (err) {
        if (err instanceof WebMiddlewareBlockedError) {
          if (options.blockedResponse) {
            return options.blockedResponse({
              kind: 'web-middleware',
              phase: 'request',
              reason: err.message,
              category: err.category,
              severity: err.severity
            });
          }
          return new Response(
            JSON.stringify({
              error: 'request_blocked',
              reason: err.message,
              category: err.category
            }),
            {
              status: 403,
              headers: { 'content-type': 'application/json' }
            }
          );
        }
        throw err;
      }
      return handler(req);
    };
  }
  return wrapped;
}
