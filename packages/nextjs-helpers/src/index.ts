// SPDX-License-Identifier: Apache-2.0
/**
 * `@blackunicorn/bonklm-nextjs` — Next.js helpers for BonkLM.
 *
 * Three surfaces for Next.js ^16.0.0:
 *
 *   - `withBonklm(action, opts)` — Server Action wrapper. Validates
 *     the incoming arguments before the action runs.
 *   - `bonklmRouteHandler({ GET, POST, ... }, opts)` — Route Handler
 *     wrapper. Validates request bodies on the methods that have
 *     them (POST / PUT / PATCH).
 *   - `bonklmEdgeMiddleware(opts)` — middleware.ts factory. Returns
 *     a `NextResponse` from `(req) => Promise<Response>` that runs
 *     validation before the request reaches the route.
 *
 * All three feed the body through `web-middleware-utils.runRequestValidation`.
 * BLOCK returns a 403 `Response` (overridable via `blockedResponse`).
 */
export { withBonklm, type WithBonklmOptions, type ServerAction } from './with-bonklm.js';
export { bonklmRouteHandler, type BonklmRouteHandlerOptions, type RouteHandlerMethods } from './route-handler.js';
export { bonklmEdgeMiddleware, type BonklmEdgeMiddlewareOptions } from './edge-middleware.js';
