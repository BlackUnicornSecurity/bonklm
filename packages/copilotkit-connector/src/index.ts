/**
 * LLM-Guardrails CopilotKit Connector
 * =====================================
 *
 * Provides security guardrails integration for CopilotKit.
 *
 * @package @blackunicorn/bonklm-copilotkit
 * @version 1.0.0
 */

// Main exports
export { createGuardedCopilotKit } from './copilotkit-guardrail.js';

// Utility exports
export { messagesToText, actionsToText, normalizeToString } from './messages-to-text.js';

// Type exports
export type {
  GuardedCopilotKitOptions,
  CopilotKitMessage,
  CopilotKitAction,
  CopilotKitContext,
  HookResult,
  CopilotKitContentPart
} from './types.js';

export {
  StreamValidationError,
  DEFAULT_MAX_BUFFER_SIZE,
  DEFAULT_MAX_CONTENT_LENGTH,
  DEFAULT_VALIDATION_TIMEOUT,
  VALIDATION_INTERVAL
} from './types.js';
