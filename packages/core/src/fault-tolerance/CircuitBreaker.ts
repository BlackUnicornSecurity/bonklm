/**
 * Circuit Breaker
 *
 * Implements the circuit breaker pattern for fault tolerance.
 * Prevents cascading failures by failing fast when a service is down.
 *
 * @package @blackunicorn/bonklm
 */

import type { Logger } from '../base/GenericLogger.js';

/**
 * Circuit breaker states
 */
export enum CircuitState {
  /** Normal operation, requests pass through */
  CLOSED = 'closed',
  /** Circuit is tripped, all requests fail fast */
  OPEN = 'open',
  /** Testing if service has recovered */
  HALF_OPEN = 'half_open'
}

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  /** Minimum number of requests before calculating error rate */
  requestVolumeThreshold?: number;
  /** Error percentage threshold to trip the circuit (0-100) */
  errorThresholdPercentage?: number;
  /** Time in milliseconds before attempting recovery (half-open state) */
  recoveryTimeout?: number;
  /** Maximum number of requests to allow in half-open state */
  halfOpenMaxRequests?: number;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Logger instance */
  logger?: Logger;
  /** Enable/disable the circuit breaker */
  enabled?: boolean;
}

/**
 * Default circuit breaker configuration
 */
const DEFAULT_CONFIG: Required<Omit<CircuitBreakerConfig, 'logger'>> = {
  requestVolumeThreshold: 20,
  errorThresholdPercentage: 50,
  recoveryTimeout: 60000, // 1 minute
  halfOpenMaxRequests: 10,
  timeout: 30000, // 30 seconds
  enabled: true
};

/**
 * Circuit breaker error - thrown when circuit is open
 */
export class CircuitBreakerOpenError extends Error {
  name = 'CircuitBreakerOpenError';
  constructor(
    public readonly state: CircuitState,
    public readonly nextAttemptTime: Date
  ) {
    super('Circuit breaker is open - requests are temporarily blocked');
  }
}

/**
 * Circuit breaker statistics
 */
export interface CircuitBreakerStats {
  state: CircuitState;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  errorPercentage: number;
  lastFailureTime?: Date;
  lastSuccessTime?: Date;
  openedAt?: Date;
  nextAttemptTime?: Date;
}

/**
 * Circuit breaker event listeners
 */
export interface CircuitBreakerListeners {
  /** Called when circuit transitions to open state */
  onOpen?: (stats: CircuitBreakerStats) => void;
  /** Called when circuit transitions to half-open state */
  onHalfOpen?: (stats: CircuitBreakerStats) => void;
  /** Called when circuit transitions to closed state */
  onClosed?: (stats: CircuitBreakerStats) => void;
  /** Called when a request fails */
  onFailure?: (error: Error, stats: CircuitBreakerStats) => void;
  /** Called when a request succeeds */
  onSuccess?: (stats: CircuitBreakerStats) => void;
}

/**
 * Circuit Breaker
 *
 * Prevents cascading failures by failing fast when a service is experiencing issues.
 * Implements three states: CLOSED (normal), OPEN (failing fast), HALF_OPEN (testing recovery).
 */
export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private stats: CircuitBreakerStats = {
    state: CircuitState.CLOSED,
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    errorPercentage: 0
  };
  private halfOpenRequestCount = 0;
  private openedAt?: Date;
  private nextAttemptTimer?: ReturnType<typeof setTimeout>;

  private readonly config: Required<CircuitBreakerConfig>;
  private readonly logger: Logger;
  private readonly listeners: CircuitBreakerListeners;

  constructor(config: CircuitBreakerConfig = {}, listeners: CircuitBreakerListeners = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config, logger: config.logger || console };
    this.logger = this.config.logger;
    this.listeners = listeners;
  }

  /**
   * Execute a function through the circuit breaker
   */
  async execute<T>(fn: () => Promise<T> | T): Promise<T> {
    if (!this.config.enabled) {
      return fn();
    }

    // Check if we should attempt recovery
    this.checkRecoveryTimeout();

    // Fail fast if circuit is open
    if (this.state === CircuitState.OPEN) {
      throw new CircuitBreakerOpenError(this.state, this.stats.nextAttemptTime!);
    }

    this.stats.totalRequests++;

    try {
      // Add timeout to the function
      const result = await this.withTimeout(fn, this.config.timeout);

      // Handle success
      this.handleSuccess();

      if (this.listeners.onSuccess) {
        this.listeners.onSuccess(this.getStats());
      }

      return result;
    } catch (err) {
      // Handle failure
      this.handleFailure(err as Error);

      if (this.listeners.onFailure) {
        this.listeners.onFailure(err as Error, this.getStats());
      }

      throw err;
    }
  }

  /**
   * Get current circuit breaker state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Get current statistics
   */
  getStats(): CircuitBreakerStats {
    return { ...this.stats };
  }

  /**
   * Reset the circuit breaker to closed state
   */
  reset(): void {
    this.state = CircuitState.CLOSED;
    this.stats = {
      state: CircuitState.CLOSED,
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      errorPercentage: 0
    };
    this.halfOpenRequestCount = 0;
    this.openedAt = undefined;
    this.stats.nextAttemptTime = undefined;

    if (this.nextAttemptTimer) {
      clearTimeout(this.nextAttemptTimer);
      this.nextAttemptTimer = undefined;
    }

    this.logger.info('[CircuitBreaker] Circuit reset to closed state');
  }

  /**
   * Manually open the circuit
   */
  open(): void {
    this.transitionTo(CircuitState.OPEN);
  }

  /**
   * Manually close the circuit
   */
  close(): void {
    this.transitionTo(CircuitState.CLOSED);
  }

  /**
   * Handle successful request
   */
  private handleSuccess(): void {
    this.stats.successfulRequests++;
    this.stats.lastSuccessTime = new Date();

    if (this.state === CircuitState.HALF_OPEN) {
      this.halfOpenRequestCount++;

      // If we've had enough successful requests in half-open, close the circuit
      if (this.halfOpenRequestCount >= this.config.halfOpenMaxRequests) {
        this.transitionTo(CircuitState.CLOSED);
      }
    } else if (this.state === CircuitState.CLOSED) {
      // Reset counters periodically in closed state
      if (this.stats.totalRequests >= this.config.requestVolumeThreshold * 2) {
        this.resetCounters();
      }
    }

    this.updateErrorPercentage();
  }

  /**
   * Handle failed request
   */
  private handleFailure(_error: Error): void {
    this.stats.failedRequests++;
    this.stats.lastFailureTime = new Date();

    this.updateErrorPercentage();

    // Check if we should trip the circuit
    if (
      this.state === CircuitState.CLOSED &&
      this.stats.totalRequests >= this.config.requestVolumeThreshold &&
      this.stats.errorPercentage >= this.config.errorThresholdPercentage
    ) {
      this.transitionTo(CircuitState.OPEN);
    } else if (this.state === CircuitState.HALF_OPEN) {
      // Any failure in half-open immediately opens the circuit
      this.transitionTo(CircuitState.OPEN);
    }
  }

  /**
   * Transition to a new state
   */
  private transitionTo(newState: CircuitState): void {
    this.state = newState;
    this.stats.state = newState;

    if (newState === CircuitState.OPEN) {
      this.openedAt = new Date();
      this.stats.openedAt = this.openedAt;
      this.stats.nextAttemptTime = new Date(Date.now() + this.config.recoveryTimeout);

      this.logger.warn(
        `[CircuitBreaker] Circuit opened due to ${this.stats.errorPercentage}% error rate (${this.stats.failedRequests}/${this.stats.totalRequests} requests failed)`
      );

      if (this.listeners.onOpen) {
        this.listeners.onOpen(this.getStats());
      }
    } else if (newState === CircuitState.HALF_OPEN) {
      this.halfOpenRequestCount = 0;
      this.resetCounters();

      this.logger.info('[CircuitBreaker] Circuit transitioned to half-open state');

      if (this.listeners.onHalfOpen) {
        this.listeners.onHalfOpen(this.getStats());
      }
    } else if (newState === CircuitState.CLOSED) {
      this.logger.info('[CircuitBreaker] Circuit closed - service recovered');

      if (this.listeners.onClosed) {
        this.listeners.onClosed(this.getStats());
      }
    }
  }

  /**
   * Check if recovery timeout has elapsed
   */
  private checkRecoveryTimeout(): void {
    if (this.state === CircuitState.OPEN && this.stats.nextAttemptTime && new Date() >= this.stats.nextAttemptTime) {
      this.transitionTo(CircuitState.HALF_OPEN);
    }
  }

  /**
   * Update error percentage
   */
  private updateErrorPercentage(): void {
    if (this.stats.totalRequests === 0) {
      this.stats.errorPercentage = 0;
      return;
    }

    this.stats.errorPercentage = Math.round((this.stats.failedRequests / this.stats.totalRequests) * 100);
  }

  /**
   * Reset counters (but not state)
   */
  private resetCounters(): void {
    this.stats.totalRequests = 0;
    this.stats.successfulRequests = 0;
    this.stats.failedRequests = 0;
    this.stats.errorPercentage = 0;
  }

  /**
   * Wrap a function with timeout
   */
  private async withTimeout<T>(fn: () => Promise<T> | T, timeoutMs: number): Promise<T> {
    return Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        setTimeout(() => {
          const error = new Error(`Operation timed out after ${timeoutMs}ms`);
          (error as any).code = 'ETIMEDOUT';
          reject(error);
        }, timeoutMs);
      })
    ]);
  }

  /**
   * Cleanup timers
   */
  destroy(): void {
    if (this.nextAttemptTimer) {
      clearTimeout(this.nextAttemptTimer);
      this.nextAttemptTimer = undefined;
    }
  }
}

/**
 * Create a circuit breaker with default configuration
 */
export function createCircuitBreaker(
  config?: CircuitBreakerConfig,
  listeners?: CircuitBreakerListeners
): CircuitBreaker {
  return new CircuitBreaker(config, listeners);
}
