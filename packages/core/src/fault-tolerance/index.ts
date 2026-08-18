/**
 * Fault tolerance module
 *
 * Provides circuit breaker and retry mechanisms for resilience.
 *
 * @package @blackunicorn/bonklm
 */

export {
  CircuitBreaker,
  createCircuitBreaker,
  CircuitBreakerOpenError,
  CircuitState,
  type CircuitBreakerConfig,
  type CircuitBreakerStats,
  type CircuitBreakerListeners
} from './CircuitBreaker.js';

export {
  RetryPolicy,
  createRetryPolicy,
  type RetryConfig,
  type RetryResult,
  type RetryAttemptOptions
} from './RetryPolicy.js';
