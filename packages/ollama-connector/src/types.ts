/**
 * Ollama SDK Connector Types
 *
 * This file contains all TypeScript type definitions for the Ollama SDK connector.
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
  CircuitBreaker,
  Guard,
  GuardrailResult,
  Logger,
  TelemetryService,
  Validator,
} from '@blackunicorn/bonklm';

// Re-export Ollama types from the SDK for convenience
export type { Message, ChatRequest, ChatResponse, GenerateRequest, GenerateResponse } from 'ollama';

// Simplified Ollama message type for internal use
export interface OllamaMessage {
  role: string;
  content: string;
  thinking?: string;
  images?: Uint8Array[] | string[];
  tool_calls?: any[];
  tool_name?: string;
}

/**
 * Configuration options for the guarded Ollama wrapper.
 *
 * @remarks
 * All security options are included to address identified vulnerabilities.
 */
export interface GuardedOllamaOptions {
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
   * - 'buffer': NOT YET IMPLEMENTED - Will accumulate entire stream before validating (less secure, faster)
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
 * Options for chat() calls.
 *
 * @remarks
 * Extends the standard Ollama chat request to support both streaming and non-streaming modes.
 */
export type GuardedChatOptions = {
  model: string;
  messages: OllamaMessage[];
  stream?: boolean;
  format?: string | object;
  keep_alive?: string | number;
  tools?: any[];
  think?: boolean | 'high' | 'medium' | 'low';
  logprobs?: boolean;
  top_logprobs?: number;
  options?: any;
};

/**
 * Options for generate() calls.
 *
 * @remarks
 * Extends the standard Ollama generate request to support both streaming and non-streaming modes.
 */
export type GuardedGenerateOptions = {
  model: string;
  prompt: string;
  stream?: boolean;
  suffix?: string;
  system?: string;
  template?: string;
  context?: number[];
  raw?: boolean;
  format?: string | object;
  images?: Uint8Array[] | string[];
  keep_alive?: string | number;
  think?: boolean | 'high' | 'medium' | 'low';
  logprobs?: boolean;
  top_logprobs?: number;
  options?: any;
};

/**
 * Result type for non-streaming completions that may be filtered.
 */
export interface GuardedGenerateResult {
  /**
   * The generated content, or a placeholder if filtered.
   */
  response: string;

  /**
   * Whether the result was filtered by guardrails.
   */
  filtered?: boolean;

  /**
   * The raw response object from Ollama.
   */
  raw?: any;
}

/**
 * Result type for non-streaming chat that may be filtered.
 */
export interface GuardedChatResult {
  /**
   * The message content, or a placeholder if filtered.
   */
  message: {
    role: string;
    content: string;
    thinking?: string;
    images?: any[];
    tool_calls?: any[];
  };

  /**
   * Whether the result was filtered by guardrails.
   */
  filtered?: boolean;

  /**
   * The raw response object from Ollama.
   */
  raw?: any;
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
export class StreamValidationError extends Error {
  constructor(
    message: string,
    public readonly reason: string,
    public readonly blocked: boolean = true,
  ) {
    super(message);
    this.name = 'StreamValidationError';
  }
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
