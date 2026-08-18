/**
 * Anthropic SDK Connector Types
 *
 * This file contains all TypeScript type definitions for the Anthropic SDK connector.
 * Includes security-related options for incremental stream validation, buffer limits,
 * and complex message content handling.
 *
 * Security Features:
 * - Incremental stream validation with early termination
 * - Max buffer size enforcement
 * - Complex message content handling
 * - Production mode error messages
 * - Validation timeout
 * - regression: Correct GuardrailEngine API
 * - regression: Logger type
 */

import Anthropic from '@anthropic-ai/sdk';
import type { CircuitBreaker, Guard, GuardrailResult, Logger, TelemetryService, Validator } from '@blackunicorn/bonklm';

// Re-export Anthropic types for convenience
export type Message = Anthropic.Message;
export type MessageParam = Anthropic.MessageParam;

/**
 * Configuration options for the guarded Anthropic wrapper.
 *
 * @remarks
 * All security options are included to address identified vulnerabilities.
 */
export interface GuardedAnthropicOptions {
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
   * - `'incremental'` (default): validates the accumulated text every
   *   {@link VALIDATION_INTERVAL} chunks while streaming and stops forwarding on
   *   the first violation. Events are delivered progressively (lower latency to
   *   first token); content emitted before a violation is detected has already
   *   reached the consumer.
   * - `'buffer'`: holds every event back, runs a single validation pass over the
   *   full response at stream completion, then releases the buffered events
   *   unchanged only if validation passes. On a violation the buffered content is
   *   withheld entirely and a single blocked marker event is emitted (plus the
   *   {@link GuardedAnthropicOptions.onStreamBlocked} callback). One validation
   *   pass instead of one per interval, and zero pre-validation leakage, at the
   *   cost of progressive delivery — the consumer receives nothing until the full
   *   response clears.
   *
   * Both modes enforce {@link GuardedAnthropicOptions.maxStreamBufferSize}
   * and require {@link GuardedAnthropicOptions.validateStreaming} to be
   * `true`.
   *
   * Addresses post-hoc stream validation bypass.
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
   * Addresses accumulator buffer overflow.
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
   * Addresses information leakage in error messages.
   *
   * @defaultValue process.env.NODE_ENV === 'production'
   */
  productionMode?: boolean;

  /**
   * Validation timeout in milliseconds.
   *
   * @remarks
   * Prevents hanging on slow or malicious inputs.
   * Uses validateWithTimeoutSecure (canonical primitive) for timeout enforcement.
   *
   * Addresses missing timeout enforcement.
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

  /**
   * Telemetry service for monitoring and observability.
   *
   * @remarks
   * When provided, telemetry events will be recorded for validation,
   * API calls, streaming, and error events.
   *
   * @defaultValue undefined
   */
  telemetry?: TelemetryService;

  /**
   * Circuit breaker for fault tolerance.
   *
   * @remarks
   * When provided, API calls will be protected by the circuit breaker
   * to prevent cascading failures during service issues.
   *
   * @defaultValue undefined
   */
  circuitBreaker?: CircuitBreaker;

  /**
   * Enable/disable automatic retry on transient failures.
   *
   * @remarks
   * When enabled, requests that fail with transient errors (timeouts,
   * connection errors, 429, 503, etc.) will be retried with exponential backoff.
   *
   * @defaultValue true
   */
  enableRetry?: boolean;

  /**
   * Maximum number of retry attempts for transient failures.
   *
   * @defaultValue 3
   */
  maxRetries?: number;
}

/**
 * Options for messages.create() calls.
 *
 * @remarks
 * Extends the standard Anthropic MessageCreateParams to support both streaming and non-streaming modes.
 */
export type GuardedMessageOptions = {
  model: string;
  messages: MessageParam[];
  max_tokens?: number;
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  system?: string;
};

/**
 * Result type for non-streaming message completions that may be filtered.
 */
export interface GuardedMessage {
  /**
   * The generated content, or a placeholder if filtered.
   */
  content: string | null;

  /**
   * Whether the result was filtered by guardrails.
   */
  filtered?: boolean;

  /**
   * The raw Message object from Anthropic.
   */
  raw?: Message;
}

/**
 * Error thrown when stream validation fails.
 *
 * @remarks
 * This error class is provided for type-checking and catching stream validation errors.
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
