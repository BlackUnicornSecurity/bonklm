/**
 * Vercel AI SDK Guardrail Connector
 * =================================
 *
 * Main entry point for @blackunicorn/bonklm-vercel.
 *
 * @package @blackunicorn/bonklm-vercel
 */

// Main exports
export { createGuardedAI, messagesToText } from './guarded-ai.js';

/**
 * Story 1.4: alias for `messagesToText` named `messagesToTextLegacy`
 * per AC. Currently identical — when the v3/v4 type drop lands in a
 * follow-up PR, `messagesToTextLegacy` will retain the `CoreMessage`
 * shape while `messagesToText` switches to `ModelMessage`.
 */
export { messagesToText as messagesToTextLegacy } from './guarded-ai.js';

// Story 1.4 v5/v6 middleware pattern + agent / MCP wrappers (Phase-1).
export {
  bonkMiddleware,
  messagesToTextDucked,
  type BonkLanguageModelV2Middleware,
  type BonkMiddlewareOptions,
} from './bonk-middleware.js';
export {
  wrapAgent,
  wrapMCPClient,
  type ToolLoopAgentLike,
  type MCPClientLike,
  type WrapAgentOptions,
  type WrapMCPClientOptions,
} from './wrap-agent.js';

// Error classes
export { StreamValidationError, ConnectorValidationError } from '@blackunicorn/bonklm/core/connector-utils';

// Type exports
export type {
  GuardedAIOptions,
  GuardedGenerateTextOptions,
  GuardedStreamOptions,
  GuardedTextResult,
} from './types.js';

// Constants
export {
  VALIDATION_INTERVAL,
  DEFAULT_MAX_BUFFER_SIZE,
  DEFAULT_VALIDATION_TIMEOUT,
} from './types.js';
