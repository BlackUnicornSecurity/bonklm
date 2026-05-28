/**
 * LLM-Guardrails Genkit Connector
 * ===============================
 *
 * Provides security guardrails integration for Google Genkit.
 *
 * @package @blackunicorn/bonklm-genkit
 * @version 1.0.0
 */

// Main exports
export { createGenkitGuardrailsPlugin, wrapFlow } from './genkit-plugin.js';

// Utility exports
export { messagesToText, toolCallsToText, normalizeToString } from './messages-to-text.js';

// Type exports
export type {
  GuardedGenkitOptions,
  GenkitMessage,
  GenkitToolCall,
  GenkitFlowContext,
  FlowHookResult,
  GenkitContentPart
} from './types.js';

export {
  StreamValidationError,
  DEFAULT_MAX_BUFFER_SIZE,
  DEFAULT_MAX_CONTENT_LENGTH,
  DEFAULT_VALIDATION_TIMEOUT,
  VALIDATION_INTERVAL
} from './types.js';
