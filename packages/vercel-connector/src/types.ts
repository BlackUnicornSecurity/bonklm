/**
 * Vercel AI SDK Connector Types
 *
 * This file contains all TypeScript type definitions for the Vercel AI SDK connector.
 * Includes security-related options for incremental stream validation, buffer limits,
 * and complex message content handling.
 */

import type { CoreMessage, LanguageModelV1 } from 'ai';
import type { Guard, GuardrailResult, Logger, Validator } from '@blackunicorn/bonklm';

/**
 * Configuration options for the guarded AI wrapper.
 *
 * @remarks
 * All security options are included to address identified vulnerabilities:
 * - SEC-002: Incremental stream validation with early termination
 * - SEC-003: Max buffer size enforcement
 * - SEC-007: Production mode error messages
 * - SEC-008: Validation timeout
 * - DEV-002: Logger type instead of GenericLogger
 */
export interface GuardedAIOptions {
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
   * - 'buffer': Accumulates entire stream before validating (less secure, faster)
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
 * Options for generateText() calls.
 */
export interface GuardedGenerateTextOptions {
  /**
   * The language model to use for generation.
   */
  model: LanguageModelV1;

  /**
   * The messages to send to the model.
   *
   * @remarks
   * Supports complex content types per SEC-006:
   * - String content: "Hello"
   * - Array content: [{type: 'text', text: 'Hello'}, {type: 'image', image: '...'}]
   */
  messages: CoreMessage[];

  /**
   * Additional options passed to the underlying AI SDK.
   */
  [key: string]: any;
}

/**
 * Options for streamText() calls.
 */
export interface GuardedStreamOptions extends GuardedGenerateTextOptions {
  /**
   * Enable streaming mode.
   */
  stream: true;
}

/**
 * Result type for generateText() that may be filtered.
 */
export interface GuardedTextResult {
  /**
   * The generated text, or a placeholder if filtered.
   */
  text: string;

  /**
   * Token usage information.
   */
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };

  /**
   * The finish reason.
   */
  finishReason?: string;

  /**
   * Whether the result was filtered by guardrails.
   */
  filtered?: boolean;

  /**
   * The original result object from the AI SDK.
   */
  raw?: any;
}

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
