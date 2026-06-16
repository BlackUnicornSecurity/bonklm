// SPDX-License-Identifier: Apache-2.0
/**
 * `@blackunicorn/bonklm-web-middleware-utils` — shared HTTP middleware
 * primitives for the Elysia plugin (Story 3.9) + Next.js helpers
 * (Story 3.9) + future framework adapters (deferred per Sprint 22 AC:
 * Express/Fastify NOT retrofitted to avoid touching production-
 * hardened code; future retrofit gated on v1.0 API freeze).
 *
 * Three exports:
 *   - `runRequestValidation(opts, body)` — runs the validator stack
 *     on a raw request body string, returns a structured decision +
 *     fires telemetry. Throws `WebMiddlewareBlockedError` on BLOCK
 *     when `returnInsteadOfThrow` is unset.
 *   - `runResponseValidation(opts, body)` — same for response bodies.
 *   - `getRequestBody(req, framework)` — framework-shape-aware
 *     raw-body extractor (Web Request, Node IncomingMessage,
 *     Elysia Context, etc.).
 *
 * Sprint 22 audit-pattern compliance (Sprint 21+20+19 closures):
 *   - Block events carry `kind: 'web-middleware'` for cross-package
 *     observability (mirrors BonklmBlockEvent unification).
 *   - Fail-safe onBlock + onError routing.
 *   - circular-ref-safe stringify fallback.
 */
export {
  runRequestValidation,
  runResponseValidation,
  type RunValidationOptions,
  type RunValidationResult
} from './run-validation.js';
export { getRequestBody, type SupportedFramework, type RequestLike } from './get-request-body.js';
export { WebMiddlewareBlockedError, type WebMiddlewareBlockEvent, type WebMiddlewarePhase } from './errors.js';
