/**
 * LangChain Connector Types
 *
 * This file contains all TypeScript type definitions for the LangChain connector.
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

/**
 * Configuration options for the GuardrailsCallbackHandler.
 *
 * @remarks
 * All security options are included to address identified vulnerabilities.
 */
export interface GuardrailsCallbackHandlerOptions {
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
   * @deprecated This option is not currently used. Streaming validation always validates at the end of the stream.
   * Stream validation mode.
   *
   * @remarks
   * Note: This option is currently not used. Streaming validation validates accumulated content
   * when the stream completes. Future versions may support true incremental validation during streaming.
   *
   * @defaultValue 'incremental'
   */
  streamingMode?: 'incremental';

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
   * Streaming validation interval (number of tokens between validations).
   *
   * @remarks
   * Lower values provide better security but increase overhead.
   * Higher values reduce overhead but may allow more malicious content through.
   *
   * @defaultValue 10
   */
  streamingValidationInterval?: number;

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
   * Callback invoked when a validation error occurs.
   *
   * @param error - The error that occurred.
   * @param runId - The run ID for the execution.
   */
  onValidationError?: (error: Error, runId: string) => void;

  /**
   * Telemetry service for monitoring and observability.
   *
   * @remarks
   * When provided, telemetry events will be recorded for validation,
   * chain execution, streaming, and error events.
   *
   * @defaultValue undefined
   */
  telemetry?: TelemetryService;

  /**
   * Circuit breaker for fault tolerance.
   *
   * @remarks
   * When provided, chain execution will be protected by the circuit breaker
   * to prevent cascading failures during service issues.
   *
   * @defaultValue undefined
   */
  circuitBreaker?: CircuitBreaker;

  /**
   * Enable/disable automatic retry on transient failures.
   *
   * @remarks
   * When enabled, chain executions that fail with transient errors (timeouts,
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
 * Error thrown when guardrails validation blocks content.
 *
 * @remarks
 * This error class is provided for type-checking and catching guardrails violations.
 *
 * To catch guardrails violations:
 * ```ts
 * try {
 *   await chain.invoke(input);
 * } catch (error) {
 *   if (error instanceof GuardrailsViolationError) {
 *     // Handle blocked content
 *   }
 * }
 * ```
 */
export class GuardrailsViolationError extends Error {
  constructor(
    message: string,
    public readonly reason: string,
    public readonly findings: GuardrailResult['findings'] = [],
    public readonly riskScore: number = 0,
  ) {
    super(message);
    this.name = 'GuardrailsViolationError';
  }
}

// StreamValidationError is the single source of truth in
// @blackunicorn/bonklm/core/connector-utils. Re-exported here so existing
// consumers importing it from this module continue to work.
export { StreamValidationError } from '@blackunicorn/bonklm/core/connector-utils';

/**
 * Validation context for tracking stream state per run.
 *
 * @internal
 */
export interface StreamValidationContext {
  accumulatedText: string;
  tokenCount: number;
  validationCounter: number;
  startTime: number;
}

/**
 * Default validation interval for incremental stream validation.
 *
 * @internal
 */
export const DEFAULT_VALIDATION_INTERVAL = 10;

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
