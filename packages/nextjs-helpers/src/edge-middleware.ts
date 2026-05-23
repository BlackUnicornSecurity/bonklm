/**
 * Story 3.9 — `bonklmEdgeMiddleware(opts)` Next.js middleware.ts factory.
 *
 * **Next.js 14+ contract** (Sprint 22 audit security B-2 closure):
 * Next.js middleware must return either a `Response` (terminate) OR
 * `NextResponse.next()` (continue) — `undefined` no longer
 * pass-throughs reliably across all Next.js versions. We do NOT
 * import `next` (it's an optional peer dep). Instead we accept a
 * caller-supplied `nextResponse` factory that returns the
 * pass-through response:
 *
 * ```ts
 * // middleware.ts
 * import { NextResponse } from 'next/server';
 * import { bonklmEdgeMiddleware } from '@blackunicorn/bonklm-nextjs';
 *
 * export const middleware = bonklmEdgeMiddleware({
 *   engine,
 *   nextResponse: () => NextResponse.next(),
 * });
 * export const config = { matcher: ['/api/:path*'] };
 * ```
 *
 * When `nextResponse` is unset the middleware returns a synthetic
 * `Response` with `x-bonklm-passthrough: 1` header — operators on
 * Next.js 13.x can still use this shape; on Next.js 14+ the
 * `nextResponse` factory is REQUIRED for correct pass-through.
 */
import type { GuardrailEngine } from '@blackunicorn/bonklm';
import {
  runRequestValidation,
  WebMiddlewareBlockedError,
  type WebMiddlewareBlockEvent,
} from '@blackunicorn/bonklm-web-middleware-utils';

export interface BonklmEdgeMiddlewareOptions {
  engine: GuardrailEngine;
  /**
   * URL path predicate. Return `false` to skip validation for this
   * request (useful when the matcher is broader than the validation
   * scope). Default: validate every request.
   */
  shouldValidate?: (req: Request) => boolean;
  onBlock?: (event: WebMiddlewareBlockEvent) => void;
  onError?: (err: unknown) => void;
  blockedResponse?: (event: WebMiddlewareBlockEvent) => Response;
  /**
   * Sprint 22 audit closure (security B-2): Next.js 14+ pass-through
   * factory. When set, returned for every non-block path so Next.js
   * continues request processing. When unset, returns a synthetic
   * Response with `x-bonklm-passthrough: 1` header (Next.js 13.x
   * fallback).
   */
  nextResponse?: () => Response;
}

const BODY_BEARING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function bonklmEdgeMiddleware(
  options: BonklmEdgeMiddlewareOptions
): (req: Request) => Promise<Response> {
  if (!options?.engine) {
    throw new TypeError('bonklmEdgeMiddleware: options.engine is required.');
  }
  const passthrough = (): Response =>
    options.nextResponse
      ? options.nextResponse()
      : new Response(null, {
          status: 200,
          headers: { 'x-bonklm-passthrough': '1' },
        });

  return async function middleware(req: Request): Promise<Response> {
    if (options.shouldValidate && options.shouldValidate(req) === false) {
      return passthrough();
    }
    if (!BODY_BEARING_METHODS.has(req.method)) {
      return passthrough();
    }
    let body: string;
    try {
      body = await req.clone().text();
    } catch {
      body = '';
    }
    if (body.length === 0) return passthrough();
    try {
      await runRequestValidation(
        {
          engine: options.engine,
          onBlock: options.onBlock,
          onError: options.onError,
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
            severity: err.severity,
          });
        }
        return new Response(
          JSON.stringify({
            error: 'request_blocked',
            reason: err.message,
            category: err.category,
          }),
          {
            status: 403,
            headers: { 'content-type': 'application/json' },
          }
        );
      }
      throw err;
    }
    return passthrough();
  };
}
