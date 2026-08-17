// SPDX-License-Identifier: Apache-2.0
/**
 * @blackunicorn/bonklm-express
 * ====================================
 * Express middleware for LLM security guardrails.
 *
 * @package @blackunicorn/bonklm-express
 */

export { createGuardrailsMiddleware } from './middleware.js';
export type { GuardrailsMiddlewareConfig, GuardrailsRequest, ErrorHandler, BodyExtractor } from './types.js';
