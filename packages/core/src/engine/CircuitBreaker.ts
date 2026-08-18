/**
 * BonkLM - Circuit Breaker (S011-005)
 * ====================================
 * Prevents repeated buffer-overflow attacks by tripping a circuit breaker
 * after a configurable number of violations within a configurable window.
 *
 * Extracted from GuardrailEngine.ts for the project's 800-line file-size cap.
 */

import type { Logger } from '../base/GenericLogger.js';

export enum CircuitBreakerState {
  CLOSED = 'CLOSED', // Normal operation
  OPEN = 'OPEN', // Blocking requests after threshold
  HALF_OPEN = 'HALF_OPEN' // Testing if recovery is possible
}

export interface CircuitBreakerMetrics {
  violationCount: number;
  lastViolationTime: number;
  state: CircuitBreakerState;
  openUntil?: number;
}

export interface CircuitBreakerOptions {
  /** Number of buffer-overflow violations before tripping. */
  threshold: number;
  /** How long (ms) the breaker stays OPEN before transitioning to HALF_OPEN. */
  timeoutMs: number;
  /** Logger for state transitions. */
  logger: Logger;
}

/**
 * Three-state circuit breaker for buffer-overflow protection.
 *
 * Lifecycle: CLOSED → (threshold violations) → OPEN → (timeout) → HALF_OPEN
 *            HALF_OPEN → (success) → CLOSED
 *            HALF_OPEN → (violation) → OPEN
 */
export class CircuitBreaker {
  private metrics: CircuitBreakerMetrics = {
    violationCount: 0,
    lastViolationTime: 0,
    state: CircuitBreakerState.CLOSED
  };

  constructor(private readonly options: CircuitBreakerOptions) {}

  /**
   * Returns true when the breaker is blocking requests.
   * Transitions OPEN → HALF_OPEN when the timeout expires.
   */
  isOpen(): boolean {
    const now = Date.now();

    if (
      this.metrics.state === CircuitBreakerState.OPEN &&
      this.metrics.openUntil !== undefined &&
      now >= this.metrics.openUntil
    ) {
      this.metrics.state = CircuitBreakerState.HALF_OPEN;
      this.options.logger.info('Circuit breaker transitioned to HALF_OPEN');
      return false;
    }

    return this.metrics.state === CircuitBreakerState.OPEN;
  }

  /**
   * Records a buffer-overflow violation. In HALF_OPEN state any violation
   * immediately re-trips to OPEN. In CLOSED state, trips when the violation
   * count reaches the threshold.
   */
  recordViolation(): void {
    const now = Date.now();
    this.metrics.violationCount++;
    this.metrics.lastViolationTime = now;

    this.options.logger.warn('Buffer overflow violation recorded', {
      violationCount: this.metrics.violationCount,
      threshold: this.options.threshold,
      state: this.metrics.state
    });

    if (this.metrics.state === CircuitBreakerState.HALF_OPEN) {
      this.metrics.state = CircuitBreakerState.OPEN;
      this.metrics.openUntil = now + this.options.timeoutMs;
      this.options.logger.error('Circuit breaker re-tripped from HALF_OPEN due to new violation', {
        openUntil: new Date(this.metrics.openUntil).toISOString()
      });
      return;
    }

    if (this.metrics.violationCount >= this.options.threshold) {
      this.metrics.state = CircuitBreakerState.OPEN;
      this.metrics.openUntil = now + this.options.timeoutMs;
      this.options.logger.error('Circuit breaker tripped due to buffer overflow violations', {
        violationCount: this.metrics.violationCount,
        openUntil: new Date(this.metrics.openUntil).toISOString()
      });
    }
  }

  /**
   * Resets the breaker after a successful HALF_OPEN validation.
   * No-op in any other state.
   */
  resetIfRecovering(): void {
    if (this.metrics.state === CircuitBreakerState.HALF_OPEN) {
      this.metrics.state = CircuitBreakerState.CLOSED;
      this.metrics.violationCount = 0;
      this.metrics.openUntil = undefined;
      this.options.logger.info('Circuit breaker reset after successful validation');
    }
  }

  /**
   * Returns an immutable snapshot of current state for monitoring.
   */
  getState(): CircuitBreakerMetrics {
    return { ...this.metrics };
  }
}
