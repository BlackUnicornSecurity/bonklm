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

// Sprint 26 v1.0-RC1 API freeze: removed `messagesToTextLegacy` alias.
// The v3/v4 CoreMessage→ModelMessage type drop never landed; the alias
// duplicated the canonical `messagesToText` export with no semantic
// distinction. Consumers using `messagesToTextLegacy` should rename to
// `messagesToText` — the behavior is identical.

// Story 1.4 v5/v6 middleware pattern + agent / MCP wrappers (Phase-1).
export {
  bonkMiddleware,
  messagesToTextDucked,
  type BonkLanguageModelV2Middleware,
  type BonkMiddlewareOptions
} from './bonk-middleware.js';
export {
  wrapAgent,
  wrapMCPClient,
  type ToolLoopAgentLike,
  type MCPClientLike,
  type WrapAgentOptions,
  type WrapMCPClientOptions
} from './wrap-agent.js';

// Error classes
export { StreamValidationError, ConnectorValidationError } from '@blackunicorn/bonklm/core/connector-utils';

// Type exports
export type { GuardedAIOptions, GuardedGenerateTextOptions, GuardedStreamOptions, GuardedTextResult } from './types.js';

// Constants
export { VALIDATION_INTERVAL, DEFAULT_MAX_BUFFER_SIZE, DEFAULT_VALIDATION_TIMEOUT } from './types.js';
