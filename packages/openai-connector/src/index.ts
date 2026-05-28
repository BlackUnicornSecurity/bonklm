/**
 * OpenAI SDK Connector for LLM-Guardrails
 * ==========================================
 *
 * Main entry point for the OpenAI SDK connector.
 *
 * @package @blackunicorn/bonklm-openai
 */

export { createGuardedOpenAI, messagesToText } from './guarded-openai.js';

export type {
  GuardedOpenAIOptions,
  GuardedChatCompletionOptions,
  GuardedChatCompletion,
  MessageContent
} from './types.js';

export { StreamValidationError } from './types.js';

export { VALIDATION_INTERVAL, DEFAULT_MAX_BUFFER_SIZE, DEFAULT_VALIDATION_TIMEOUT } from './types.js';
