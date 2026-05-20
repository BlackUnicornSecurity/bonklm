/**
 * BonkLM - GuardrailEngine Types
 * ===============================
 * Interface and type declarations for GuardrailEngine. Extracted to keep the
 * orchestration class file under the 800-line cap.
 */

import type { Logger } from '../base/GenericLogger.js';
import type { GuardrailResult } from '../base/GuardrailResult.js';
import type { OverrideTokenConfigString } from '../security/override-token.js';

/**
 * Validator instance interface.
 * All validators must implement a validate method that accepts content
 * and returns a GuardrailResult.
 */
export interface Validator {
  /**
   * Validate content and return a result.
   */
  validate(content: string): GuardrailResult;

  /**
   * Optional validator name for identification.
   */
  name?: string;
}

/**
 * Guard instance interface.
 * Guards validate content with optional context (e.g., file path).
 */
export interface Guard {
  /**
   * Validate content and return a result.
   */
  validate(content: string, context?: string): GuardrailResult;

  /**
   * Optional guard name for identification.
   */
  name?: string;
}

/**
 * Execution order for validators.
 */
export type ExecutionOrder = 'sequential' | 'parallel';

/**
 * Engine configuration options.
 */
export interface GuardrailEngineConfig {
  /**
   * List of validators to run.
   */
  validators?: Validator[];

  /**
   * List of guards to run.
   */
  guards?: Guard[];

  /**
   * Whether to stop execution on first failure.
   * @default true
   */
  shortCircuit?: boolean;

  /**
   * Execution order for validators.
   * @default 'sequential'
   */
  executionOrder?: ExecutionOrder;

  /**
   * Custom logger.
   */
  logger?: Logger;

  /**
   * Whether to include individual validator results in the output.
   * @default true
   */
  includeIndividualResults?: boolean;

  /**
   * Global sensitivity level.
   * @default 'standard'
   */
  sensitivity?: 'strict' | 'standard' | 'permissive';

  /**
   * Global action mode.
   * @default 'block'
   */
  action?: 'block' | 'sanitize' | 'log' | 'allow';

  /**
   * Override token to bypass validation.
   * S011-006: Now supports cryptographic validation.
   * - string: Legacy plaintext token (INSECURE, not recommended)
   * - OverrideTokenConfig object: Secure HMAC-based token validation
   *
   * @example
   * // Legacy (insecure)
   * overrideToken: 'BYPASS-VALIDATION'
   *
   * // Secure (recommended)
   * overrideToken: { secret: 'your-32-char-secret' }
   */
  overrideToken?: OverrideTokenConfigString;

  /**
   * Maximum time in milliseconds for validation to complete.
   * Prevents DoS via complex regex patterns. @default 5000ms
   */
  validationTimeout?: number;

  /**
   * Maximum time for individual pattern matching.
   * Prevents ReDoS attacks. @default 100ms
   */
  patternTimeout?: number;

  /**
   * Maximum buffer size for streaming validation in bytes.
   * Prevents memory exhaustion through buffer overflow attacks. @default 1MB
   */
  maxBufferSize?: number;

  /**
   * Circuit breaker threshold for buffer overflow violations.
   * Triggers circuit breaker after this many violations. @default 3
   */
  circuitBreakerThreshold?: number;

  /**
   * Circuit breaker timeout in milliseconds.
   * How long to stay in OPEN state before attempting recovery. @default 60000ms (1 minute)
   */
  circuitBreakerTimeout?: number;
}

/**
 * Individual validator result with metadata.
 */
export interface ValidatorResult extends GuardrailResult {
  /**
   * Name of the validator that produced this result.
   */
  validatorName: string;
}

/**
 * Aggregated engine result.
 */
export interface EngineResult extends GuardrailResult {
  /**
   * Individual results from each validator/guard.
   */
  results: ValidatorResult[];

  /**
   * Number of validators run.
   */
  validatorCount: number;

  /**
   * Number of guards run.
   */
  guardCount: number;

  /**
   * Execution time in milliseconds.
   */
  executionTime: number;
}

/**
 * Callback function type for intercept events.
 * Called when validation completes with a result.
 *
 * @param result - The engine result from validation
 * @param context - Context including original content and optional validation context
 */
export type InterceptCallback = (
  result: EngineResult,
  context: {
    content: string;
    validation_context?: string;
  }
) => void | Promise<void>;
