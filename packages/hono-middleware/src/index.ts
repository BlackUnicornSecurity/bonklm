// SPDX-License-Identifier: Apache-2.0
/**
 * @blackunicorn/bonklm-hono
 * ========================
 * Hono middleware for BonkLM — edge-targeted LLM security guardrails.
 *
 * Public surface:
 *  - `honoGuardrails(engine, options?)` — canonical-shape MiddlewareHandler
 *    factory per the connector-style ADR (shape #3).
 *  - `extractBody(req, bodyFields?)` — body extraction helper (re-exported
 *    for consumers building custom integrations).
 *  - `HonoGuardrailsOptions` / `HonoGuardrailsErrorResponse` — public types.
 *
 * Peer dependencies: `hono ^4.12.0`.
 * Edge runtimes: Workerd (`nodejs_compat`) / Deno / Bun supported (the
 * connector builds on BonkLM core, which uses Node built-ins) — not
 * strict Vercel `edge-light`.
 */
export { honoGuardrails, ConnectorValidationError } from './hono-guardrails.js';
export { extractBody, type ExtractedBody } from './body-extractor.js';
export type {
  HonoContextLike,
  HonoGuardrailsErrorResponse,
  HonoGuardrailsOptions,
  HonoMiddlewareHandler,
  HonoNext
} from './types.js';
