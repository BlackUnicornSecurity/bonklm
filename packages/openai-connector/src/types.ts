/**
 * OpenAI SDK Connector Types
 *
 * This file contains all TypeScript type definitions for the OpenAI SDK connector.
 * Includes security-related options for incremental stream validation, buffer limits,
 * and complex message content handling.
 *
 * Security Features:
 * - SEC-002: Incremental stream validation with early termination
 * - SEC-003: Max buffer size enforcement
 * - SEC-006: Complex message content handling
 * - SEC-007: Production mode error messages
 * - SEC-008: Validation timeout
 * - DEV-001: Correct GuardrailEngine API
 * - DEV-002: Logger type
 */

import type {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
} from 'openai/resources/chat/completions';
import type { Guard, GuardrailResult, Logger, Validator } from '@blackunicorn/bonklm';

/**
 * Configuration options for the guarded OpenAI wrapper.
 *
 * @remarks
 * All security options are included to address identified vulnerabilities.
 */
export interface GuardedOpenAIOptions {
  /**
   * Validators to apply to inputs and outputs.
   */
  validators?: Validator[];

  /**
   * Guards to apply to inputs and outputs.
   */
  guards?: Guard[];

  /**
   * Logger instance for validation events.
   *
   * @defaultValue createLogger('console')
   */
  logger?: Logger;

  /**
   * Whether to validate streaming responses incrementally.
   *
   * @remarks
   * When enabled, the stream is validated in chunks rather than only after completion.
   * This prevents malicious content from being sent before validation detects it.
   *
   * @defaultValue false
   */
  validateStreaming?: boolean;

  /**
   * Stream validation mode.
   *
   * @remarks
   * - 'incremental': Validates every N chunks during streaming, early terminates on violation
   *
   * Addresses SEC-002: Post-hoc stream validation bypass.
   *
   * @defaultValue 'incremental'
   */
  streamingMode?: 'incremental' | 'buffer';

  /**
   * Maximum buffer size for stream accumulation.
   *
   * @remarks
   * Prevents memory exhaustion attacks via large streaming responses.
   * Stream is terminated when buffer size exceeds this limit.
   *
   * Addresses SEC-003: Accumulator buffer overflow.
   *
   * @defaultValue 1048576 (1MB)
   */
  maxStreamBufferSize?: number;

  /**
   * Production mode flag.
   *
   * @remarks
   * When true, error messages are generic to avoid leaking security information.
   * When false, detailed error messages include the reason for blocking.
   *
   * Addresses SEC-007: Information leakage in error messages.
   *
   * @defaultValue process.env.NODE_ENV === 'production'
   */
  productionMode?: boolean;

  /**
   * Validation timeout in milliseconds.
   *
   * @remarks
   * Prevents hanging on slow or malicious inputs.
   * Uses AbortController for timeout enforcement.
   *
   * Addresses SEC-008: Missing timeout enforcement.
   *
   * @defaultValue 30000 (30 seconds)
   */
  validationTimeout?: number;

  /**
   * Callback invoked when input is blocked.
   *
   * @param result - The validation result that caused blocking.
   */
  onBlocked?: (result: GuardrailResult) => void;

  /**
   * Callback invoked when stream is blocked during validation.
   *
   * @param accumulated - The accumulated text content before blocking.
   */
  onStreamBlocked?: (accumulated: string) => void;
}

/**
 * Options for chat.completions.create() calls.
 *
 * @remarks
 * Extends the standard OpenAI params to support both streaming and non-streaming modes.
 */
export type GuardedChatCompletionOptions =
  | ChatCompletionCreateParamsNonStreaming
  | ChatCompletionCreateParamsStreaming;

/**
 * Result type for non-streaming chat completions that may be filtered.
 */
export interface GuardedChatCompletion {
  /**
   * The generated content, or a placeholder if filtered.
   */
  content: string | null;

  /**
   * Whether the result was filtered by guardrails.
   */
  filtered?: boolean;

  /**
   * The raw ChatCompletion object from OpenAI.
   */
  raw?: any;
}

/**
 * Error thrown when stream validation fails.
 *
 * @remarks
 * This error class is provided for type-checking and catching stream validation errors.
 * Currently, the stream implementation throws a plain Error with a `name` property
 * set to 'StreamValidationError' for compatibility with existing code.
 *
 * To catch stream validation errors:
 * ```ts
 * try {
 *   for await (const chunk of stream) { ... }
 * } catch (error: any) {
 *   if (error?.name === 'StreamValidationError') {
 *     // Handle stream validation failure
 *   }
 * }
 * ```
 *
 * Future versions may throw this class directly.
 */
export { StreamValidationError } from '@blackunicorn/bonklm/core/connector-utils';

/**
 * Validation interval for incremental stream validation.
 *
 * @internal
 */
export const VALIDATION_INTERVAL = 10;

/**
 * Default max buffer size (1MB).
 *
 * @internal
 */
export const DEFAULT_MAX_BUFFER_SIZE = 1024 * 1024;

/**
 * Default validation timeout (30 seconds).
 *
 * @internal
 */
export const DEFAULT_VALIDATION_TIMEOUT = 30000;

/**
 * OpenAI message content types.
 *
 * @internal
 */
export type MessageContent = string | Array<ContentPart>;

/**
 * Content part types for array-form messages.
 *
 * @internal
 * @remarks
 * Note: Only 'text' and 'refusal' types are extracted for validation.
 * Non-text content (image_url, input_audio, file) is intentionally excluded
 * from validation because:
 * - Images: Cannot validate binary content directly; URLs are checked elsewhere
 * - Audio: Audio data requires specialized transcription before validation
 * - Files: File references are validated by the OpenAI API before processing
 */
export interface ContentPart {
  type: 'text' | 'image_url' | 'input_audio' | 'file' | 'refusal';
  text?: string;
  refusal?: string;
  image_url?: { url: string; detail?: 'auto' | 'low' | 'high' };
  input_audio?: { data: string; format: 'wav' | 'mp3' };
  file?: { file_id?: string; filename?: string; file_data?: string };
}
