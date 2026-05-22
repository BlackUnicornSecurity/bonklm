/**
 * @blackunicorn/bonklm-langchain
 *
 * LangChain connector for LLM-Guardrails.
 *
 * Provides security guardrails for LangChain operations including:
 * - Input validation for prompt injection and jailbreak detection
 * - Output validation for content filtering
 * - Incremental stream validation for real-time protection
 * - Buffer size limits to prevent DoS
 * - Tool call validation
 *
 * @example
 * ```ts
 * import { GuardrailsCallbackHandler } from '@blackunicorn/bonklm-langchain';
 * import { PromptInjectionValidator } from '@blackunicorn/bonklm';
 *
 * const handler = new GuardrailsCallbackHandler({
 *   validators: [new PromptInjectionValidator()],
 *   validateStreaming: true,
 * });
 *
 * await chain.invoke(input, { callbacks: [handler] });
 * ```
 */

// Main class export
/**
 * @deprecated Story 1.5: prefer the `langchain@1.x` middleware
 * pattern via `createBonklmMiddleware`. `GuardrailsCallbackHandler`
 * is kept for dual-path runtime detection on `@langchain/core@^0.3.x`
 * peers and will be removed when the 0.3.x line reaches EOL.
 */
export { GuardrailsCallbackHandler, isGuardrailsViolationError, isStreamValidationError } from './guardrails-handler.js';

// Story 1.5 — langchain@1.x middleware + retriever wrap + LangGraph node.
export {
  createBonklmMiddleware,
  withRetrieverGuardrails,
  bonklmLangGraphNode,
  createBonklmLangGraphNode,
  type BonklmMiddlewareConfig,
  type BonklmMiddlewareScope,
  type BonklmLangchainMiddleware,
  type BonklmMiddlewareState,
  type BonklmModelResponse,
  type BonklmToolCall,
  type BonklmRetrieverLike,
  type WithRetrieverGuardrailsOptions,
  type BonklmLangGraphState,
} from './middleware/index.js';

// Types
export type {
  GuardrailsCallbackHandlerOptions,
  StreamValidationContext,
} from './types.js';

// Error classes
// S012-011: Export custom LangChain error class
export { GuardrailsViolationError } from './types.js';

// S012-011: Re-export standard connector error classes for consistency
// Note: StreamValidationError is also exported from guardrails-handler.ts
export {
  ConnectorValidationError,
  ConnectorConfigurationError,
  ConnectorTimeoutError,
} from '@blackunicorn/bonklm/core/connector-utils';

// Constants
export {
  DEFAULT_VALIDATION_INTERVAL,
  DEFAULT_MAX_BUFFER_SIZE,
  DEFAULT_VALIDATION_TIMEOUT,
} from './types.js';
