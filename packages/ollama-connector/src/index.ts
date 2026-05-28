/**
 * LLM-Guardrails Ollama Connector
 *
 * Provides security guardrails for Ollama SDK operations.
 *
 * @package @blackunicorn/bonklm-ollama
 *
 * @example
 * ```ts
 * import { Ollama } from 'ollama';
 * import { createGuardedOllama } from '@blackunicorn/bonklm-ollama';
 * import { PromptInjectionValidator } from '@blackunicorn/bonklm';
 *
 * // Create Ollama client
 * const ollama = new Ollama({ host: 'http://localhost:11434' });
 *
 * // Wrap with guardrails
 * const guardedOllama = createGuardedOllama(ollama, {
 *   validators: [new PromptInjectionValidator()],
 *   validateStreaming: true,
 * });
 *
 * // Use chat API
 * const response = await guardedOllama.chat({
 *   model: 'llama3.1',
 *   messages: [{ role: 'user', content: 'Hello!' }]
 * });
 * console.log(response.message.content);
 *
 * // Use generate API
 * const result = await guardedOllama.generate({
 *   model: 'llama3.1',
 *   prompt: 'Write a short poem'
 * });
 * console.log(result.response);
 *
 * // Use streaming with validation
 * const stream = await guardedOllama.chat({
 *   model: 'llama3.1',
 *   messages: [{ role: 'user', content: 'Tell me a story' }],
 *   stream: true
 * });
 *
 * for await (const chunk of stream) {
 *   process.stdout.write(chunk.message.content);
 * }
 * ```
 *
 * @remarks
 *
 * ## Features
 *
 * - **Input Validation**: Validates prompts before sending to Ollama
 * - **Output Validation**: Validates responses after generation
 * - **Streaming Support**: Incremental validation for streaming responses
 * - **Buffer Protection**: Prevents memory exhaustion attacks
 * - **Timeout Protection**: validateWithTimeoutSecure-based validation timeout
 * - **Production Mode**: Generic error messages in production
 *
 * ## Security Options
 *
 * - `validateStreaming`: Enable incremental stream validation
 * - `streamingMode`: 'incremental' (default) or 'buffer'
 * - `maxStreamBufferSize`: Maximum buffer size (default: 1MB)
 * - `productionMode`: Generic errors in production
 * - `validationTimeout`: Validation timeout in milliseconds (default: 30000)
 *
 * ## Validation
 *
 * The connector uses the GuardrailEngine from the core package to run validators
 * and guards. You can configure any validators from @blackunicorn/bonklm:
 *
 * - PromptInjectionValidator
 * - JailbreakValidator
 * - SecretGuard
 * - PIIGuard
 * - BashSafetyGuard
 * - XSSSafetyGuard
 *
 * And many more. See @blackunicorn/bonklm for the full list.
 */

// Main exports
export { createGuardedOllama, messagesToText } from './guarded-ollama.js';

// Types
export type {
  GuardedOllamaOptions,
  GuardedChatOptions,
  GuardedGenerateOptions,
  GuardedChatResult,
  GuardedGenerateResult
} from './types.js';

// Re-export Ollama types from the SDK for convenience
export type { Message, ChatRequest, ChatResponse, GenerateRequest, GenerateResponse } from 'ollama';

// Export our OllamaMessage type
export type { OllamaMessage } from './types.js';

// Error classes
export { StreamValidationError } from './types.js';

// Constants
export { VALIDATION_INTERVAL, DEFAULT_MAX_BUFFER_SIZE, DEFAULT_VALIDATION_TIMEOUT } from './types.js';
