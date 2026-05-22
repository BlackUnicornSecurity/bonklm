/**
 * @blackunicorn/bonklm-hono
 * ========================
 * Hono middleware for BonkLM — edge-runtime-native LLM security guardrails.
 *
 * Public surface:
 *  - `honoGuardrails(engine, options?)` — canonical-shape MiddlewareHandler
 *    factory per the connector-style ADR (shape #3).
 *  - `extractBody(req, bodyFields?)` — body extraction helper (re-exported
 *    for consumers building custom integrations).
 *  - `HonoGuardrailsOptions` / `HonoGuardrailsErrorResponse` — public types.
 *
 * Peer dependencies: `hono ^4.12.0`.
 * Edge runtimes: Workerd / edge-light / Deno / Bun all supported via the
 * `@blackunicorn/bonklm/edge` subpath consumed internally.
 */
export { honoGuardrails, ConnectorValidationError } from './hono-guardrails.js';
export { extractBody, type ExtractedBody } from './body-extractor.js';
export type {
  HonoContextLike,
  HonoGuardrailsErrorResponse,
  HonoGuardrailsOptions,
  HonoMiddlewareHandler,
  HonoNext,
} from './types.js';
