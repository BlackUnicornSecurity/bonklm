/**
 * Retry Policy
 *
 * Implements retry logic with exponential backoff for transient failures.
 *
 * @package @blackunicorn/bonklm
 */

import type { Logger } from '../base/GenericLogger.js';
import { serializeError } from '../common/index.js';

/**
 * Retry configuration
 */
export interface RetryConfig {
  /** Maximum number of retry attempts */
  maxAttempts?: number;
  /** Initial delay in milliseconds */
  initialDelay?: number;
  /** Multiplier for exponential backoff */
  backoffMultiplier?: number;
  /** Maximum delay in milliseconds */
  maxDelay?: number;
  /** Jitter to add to delay (0-1) */
  jitter?: number;
  /** Logger instance */
  logger?: Logger;
  /** Enable/disable retry */
  enabled?: boolean;
  /** Error codes that should trigger retry */
  retryableErrorCodes?: string[];
  /** Error types that should trigger retry */
  retryableErrorTypes?: string[];
}

/**
 * Default retry configuration
 */
const DEFAULT_CONFIG: Required<Omit<RetryConfig, 'logger' | 'retryableErrorCodes' | 'retryableErrorTypes'>> = {
  maxAttempts: 3,
  initialDelay: 1000,
  backoffMultiplier: 2,
  maxDelay: 30000, // 30 seconds
  jitter: 0.1, // 10% jitter
  enabled: true
};

/**
 * Default retryable error codes (transient failures)
 */
const DEFAULT_RETRYABLE_CODES = [
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'EPIPE',
  'ENOTFOUND',
  'EAI_AGAIN',
  // HTTP status codes
  '429', // Too Many Requests
  '502', // Bad Gateway
  '503', // Service Unavailable
  '504' // Gateway Timeout
];

/**
 * Default retryable error types
 */
const DEFAULT_RETRYABLE_TYPES = ['NetworkError', 'TimeoutError'];

/**
 * Retry result
 */
export interface RetryResult<T> {
  success: boolean;
  value?: T;
  error?: Error;
  attempts: number;
  totalDelay: number;
}

/**
 * Retry options per attempt
 */
export interface RetryAttemptOptions {
  attemptNumber: number;
  delay: number;
  remainingAttempts: number;
}

/**
 * Retry Policy
 *
 * Implements retry logic with exponential backoff and jitter.
 * Supports configurable retry conditions for transient failures.
 */
export class RetryPolicy {
  private readonly config: Required<Omit<RetryConfig, 'retryableErrorCodes' | 'retryableErrorTypes'>>;
  private readonly retryableErrorCodes: Set<string>;
  private readonly retryableErrorTypes: Set<string>;
  private readonly logger: Logger;

  constructor(config: RetryConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config, logger: config.logger || console };
    this.retryableErrorCodes = new Set([...DEFAULT_RETRYABLE_CODES, ...(config.retryableErrorCodes || [])]);
    this.retryableErrorTypes = new Set([...DEFAULT_RETRYABLE_TYPES, ...(config.retryableErrorTypes || [])]);
    this.logger = this.config.logger;
  }

  /**
   * Execute a function with retry logic
   */
  async execute<T>(fn: (options: RetryAttemptOptions) => Promise<T> | T): Promise<RetryResult<T>> {
    if (!this.config.enabled) {
      try {
        const value = await fn({ attemptNumber: 1, delay: 0, remainingAttempts: 0 });
        return { success: true, value, attempts: 1, totalDelay: 0 };
      } catch (error) {
        return {
          success: false,
          error: error as Error,
          attempts: 1,
          totalDelay: 0
        };
      }
    }

    let lastError: Error | undefined;
    let totalDelay = 0;
    let delay = this.config.initialDelay;

    for (let attempt = 1; attempt <= this.config.maxAttempts; attempt++) {
      const remainingAttempts = this.config.maxAttempts - attempt;

      try {
        const value = await fn({
          attemptNumber: attempt,
          delay,
          remainingAttempts
        });

        if (attempt > 1) {
          this.logger.info(`[Retry] Success after ${attempt} attempts (total delay: ${totalDelay}ms)`);
        }

        return {
          success: true,
          value,
          attempts: attempt,
          totalDelay
        };
      } catch (error) {
        lastError = error as Error;

        // Check if error is retryable
        if (!this.isRetryableError(error as Error) || attempt === this.config.maxAttempts) {
          // Sprint 47 cross-subsystem CWE-117 sweep (architect MEDIUM #6
          // from Sprint 46 audit): `lastError.message` is upstream-
          // provider error text — attacker-influenceable when the
          // provider wraps user input. Switch to canonical
          // `serializeError(...).message` (handles
          // non-enumerable Error fields + sanitizes via
          // sanitizeLogString internally — no double-wrap needed per
          // lesson).
          this.logger.warn(`[Retry] Non-retryable error or max attempts reached: ${serializeError(lastError).message}`);
          break;
        }

        // Calculate delay with jitter
        const actualDelay = this.calculateDelay(delay);
        totalDelay += actualDelay;

        // CWE-117 sweep (sister site).
        this.logger.warn(
          `[Retry] Attempt ${attempt}/${this.config.maxAttempts} failed, retrying in ${actualDelay}ms: ${serializeError(lastError).message}`
        );

        // Wait before retry
        await this.sleep(actualDelay);

        // Calculate next delay with exponential backoff
        delay = Math.min(delay * this.config.backoffMultiplier, this.config.maxDelay);
      }
    }

    return {
      success: false,
      error: lastError!,
      attempts: this.config.maxAttempts,
      totalDelay
    };
  }

  /**
   * Check if an error is retryable
   */
  private isRetryableError(error: Error): boolean {
    // Check error code
    const code = (error as any).code;
    if (code && this.retryableErrorCodes.has(String(code))) {
      return true;
    }

    // Check error type/name
    const name = error.name;
    if (name && this.retryableErrorTypes.has(name)) {
      return true;
    }

    // Check error message for common patterns
    const message = error.message.toLowerCase();
    if (
      message.includes('timeout') ||
      message.includes('network') ||
      message.includes('connection') ||
      message.includes('econnreset') ||
      message.includes('etimedout')
    ) {
      return true;
    }

    return false;
  }

  /**
   * Calculate delay with jitter
   */
  private calculateDelay(baseDelay: number): number {
    if (this.config.jitter === 0) {
      return baseDelay;
    }

    // Add random jitter
    const jitterAmount = baseDelay * this.config.jitter;
    const randomJitter = (Math.random() - 0.5) * 2 * jitterAmount;

    return Math.max(0, Math.round(baseDelay + randomJitter));
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Create a retry policy with default configuration
 */
export function createRetryPolicy(config?: RetryConfig): RetryPolicy {
  return new RetryPolicy(config);
}
