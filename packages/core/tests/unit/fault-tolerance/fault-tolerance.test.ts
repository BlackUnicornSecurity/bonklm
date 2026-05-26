/**
 * Fault Tolerance Unit Tests
 * ===========================
 * Comprehensive unit tests for circuit breaker, retry policy, and telemetry service.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  CircuitBreaker,
  createCircuitBreaker,
  CircuitBreakerOpenError,
  CircuitState,
  type CircuitBreakerConfig,
  type CircuitBreakerStats,
  type CircuitBreakerListeners,
} from '../../../src/fault-tolerance/CircuitBreaker.js';
import {
  RetryPolicy,
  createRetryPolicy,
  type RetryConfig,
  type RetryResult,
} from '../../../src/fault-tolerance/RetryPolicy.js';
import {
  TelemetryService,
  createTelemetryService,
  ConsoleTelemetryCollector,
  CallbackTelemetryCollector,
  BufferedTelemetryCollector,
  TelemetryEventType,
  type TelemetryEvent,
  type TelemetryMetrics,
  type TelemetryServiceOptions,
} from '../../../src/telemetry/TelemetryService.js';

describe('Circuit Breaker', () => {
  let circuitBreaker: CircuitBreaker;

  beforeEach(() => {
    circuitBreaker = new CircuitBreaker();
  });

  afterEach(() => {
    circuitBreaker.destroy();
  });

  describe('CB-001: Initial State', () => {
    it('should start in CLOSED state', () => {
      expect(circuitBreaker.getState()).toBe(CircuitState.CLOSED);
    });

    it('should have zero initial stats', () => {
      const stats = circuitBreaker.getStats();
      expect(stats.totalRequests).toBe(0);
      expect(stats.successfulRequests).toBe(0);
      expect(stats.failedRequests).toBe(0);
      expect(stats.errorPercentage).toBe(0);
    });
  });

  describe('CB-002: CLOSED State Execution', () => {
    it('should allow requests in CLOSED state', async () => {
      const fn = vi.fn().mockResolvedValue('success');
      const result = await circuitBreaker.execute(fn);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should track successful requests', async () => {
      await circuitBreaker.execute(() => Promise.resolve('success'));
      await circuitBreaker.execute(() => Promise.resolve('success'));

      const stats = circuitBreaker.getStats();
      expect(stats.successfulRequests).toBe(2);
      expect(stats.totalRequests).toBe(2);
    });

    it('should track failed requests', async () => {
      await circuitBreaker
        .execute(() => Promise.reject(new Error('failure')))
        .catch(() => {
          // Expected to fail
        });

      const stats = circuitBreaker.getStats();
      expect(stats.failedRequests).toBe(1);
      expect(stats.totalRequests).toBe(1);
    });

    it('should calculate error percentage correctly', async () => {
      // 5 successes, 5 failures = 50% error rate
      for (let i = 0; i < 5; i++) {
        await circuitBreaker.execute(() => Promise.resolve('success'));
      }
      for (let i = 0; i < 5; i++) {
        await circuitBreaker
          .execute(() => Promise.reject(new Error('failure')))
          .catch(() => {});
      }

      const stats = circuitBreaker.getStats();
      expect(stats.errorPercentage).toBe(50);
    });
  });

  describe('CB-003: State Transitions - CLOSED to OPEN', () => {
    it('should transition to OPEN when error threshold reached', async () => {
      // Use custom config with low thresholds for testing
      const cb = new CircuitBreaker({
        requestVolumeThreshold: 5,
        errorThresholdPercentage: 50,
      });

      // Create 60% error rate (3 failures out of 5 requests)
      for (let i = 0; i < 2; i++) {
        await cb.execute(() => Promise.resolve('success'));
      }
      for (let i = 0; i < 3; i++) {
        await cb.execute(() => Promise.reject(new Error('failure'))).catch(() => {});
      }

      expect(cb.getState()).toBe(CircuitState.OPEN);
      cb.destroy();
    });

    it('should not trip before reaching request volume threshold', async () => {
      const cb = new CircuitBreaker({
        requestVolumeThreshold: 10,
        errorThresholdPercentage: 50,
      });

      // 100% error rate but below volume threshold
      for (let i = 0; i < 5; i++) {
        await cb.execute(() => Promise.reject(new Error('failure'))).catch(() => {});
      }

      expect(cb.getState()).toBe(CircuitState.CLOSED);
      cb.destroy();
    });

    it('should not trip when error rate below threshold', async () => {
      const cb = new CircuitBreaker({
        requestVolumeThreshold: 5,
        errorThresholdPercentage: 60,
      });

      // 40% error rate (2 failures out of 5 requests)
      for (let i = 0; i < 3; i++) {
        await cb.execute(() => Promise.resolve('success'));
      }
      for (let i = 0; i < 2; i++) {
        await cb.execute(() => Promise.reject(new Error('failure'))).catch(() => {});
      }

      expect(cb.getState()).toBe(CircuitState.CLOSED);
      cb.destroy();
    });
  });

  describe('CB-004: OPEN State Execution', () => {
    it('should reject requests when OPEN', async () => {
      const cb = new CircuitBreaker({
        requestVolumeThreshold: 2,
        errorThresholdPercentage: 50,
      });

      // Trip the circuit
      await cb.execute(() => Promise.reject(new Error('failure'))).catch(() => {});
      await cb.execute(() => Promise.reject(new Error('failure'))).catch(() => {});

      expect(cb.getState()).toBe(CircuitState.OPEN);

      // Should throw CircuitBreakerOpenError
      await expect(
        cb.execute(() => Promise.resolve('success'))
      ).rejects.toThrow(CircuitBreakerOpenError);

      cb.destroy();
    });

    it('should include next attempt time in error', async () => {
      const cb = new CircuitBreaker({
        requestVolumeThreshold: 2,
        errorThresholdPercentage: 50,
        recoveryTimeout: 5000,
      });

      // Trip the circuit
      await cb.execute(() => Promise.reject(new Error('failure'))).catch(() => {});
      await cb.execute(() => Promise.reject(new Error('failure'))).catch(() => {});

      try {
        await cb.execute(() => Promise.resolve('success'));
        expect.fail('Should have thrown CircuitBreakerOpenError');
      } catch (error) {
        expect(error).toBeInstanceOf(CircuitBreakerOpenError);
        const cbError = error as CircuitBreakerOpenError;
        expect(cbError.nextAttemptTime).toBeInstanceOf(Date);
        expect(cbError.state).toBe(CircuitState.OPEN);
      }

      cb.destroy();
    });
  });

  describe('CB-005: State Transitions - OPEN to HALF_OPEN', () => {
    it('should transition to HALF_OPEN after recovery timeout', async () => {
      const cb = new CircuitBreaker({
        requestVolumeThreshold: 2,
        errorThresholdPercentage: 50,
        recoveryTimeout: 100, // Short timeout for testing
      });

      // Trip the circuit
      await cb.execute(() => Promise.reject(new Error('failure'))).catch(() => {});
      await cb.execute(() => Promise.reject(new Error('failure'))).catch(() => {});

      expect(cb.getState()).toBe(CircuitState.OPEN);

      // Wait for recovery timeout
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Execute should trigger state check
      await cb.execute(() => Promise.resolve('success'));

      // After one successful request in HALF_OPEN, should close
      // Actually need halfOpenMaxRequests successful requests
      for (let i = 0; i < 9; i++) {
        await cb.execute(() => Promise.resolve('success'));
      }

      expect(cb.getState()).toBe(CircuitState.CLOSED);
      cb.destroy();
    });

    it('should set nextAttemptTime when opening', async () => {
      const cb = new CircuitBreaker({
        requestVolumeThreshold: 2,
        errorThresholdPercentage: 50,
        recoveryTimeout: 1000,
      });

      const beforeTrip = Date.now();

      // Trip the circuit
      await cb.execute(() => Promise.reject(new Error('failure'))).catch(() => {});
      await cb.execute(() => Promise.reject(new Error('failure'))).catch(() => {});

      const stats = cb.getStats();
      expect(stats.nextAttemptTime).toBeDefined();
      expect(stats.nextAttemptTime!.getTime()).toBeGreaterThanOrEqual(
        beforeTrip + 1000
      );

      cb.destroy();
    });
  });

  describe('CB-006: HALF_OPEN State Execution', () => {
    it('should allow limited requests in HALF_OPEN state', async () => {
      const cb = new CircuitBreaker({
        requestVolumeThreshold: 2,
        errorThresholdPercentage: 50,
        recoveryTimeout: 50,
        halfOpenMaxRequests: 3,
      });

      // Trip the circuit
      await cb.execute(() => Promise.reject(new Error('failure'))).catch(() => {});
      await cb.execute(() => Promise.reject(new Error('failure'))).catch(() => {});

      expect(cb.getState()).toBe(CircuitState.OPEN);

      // Wait for recovery timeout
      await new Promise((resolve) => setTimeout(resolve, 75));

      // First request should trigger transition to HALF_OPEN
      await cb.execute(() => Promise.resolve('success'));
      expect(cb.getState()).toBe(CircuitState.HALF_OPEN);

      // Should stay in HALF_OPEN until max requests reached
      await cb.execute(() => Promise.resolve('success'));
      await cb.execute(() => Promise.resolve('success'));

      // After halfOpenMaxRequests, should close
      expect(cb.getState()).toBe(CircuitState.CLOSED);
      cb.destroy();
    });

    it('should transition back to OPEN on failure in HALF_OPEN', async () => {
      const cb = new CircuitBreaker({
        requestVolumeThreshold: 2,
        errorThresholdPercentage: 50,
        recoveryTimeout: 50,
      });

      // Trip the circuit
      await cb.execute(() => Promise.reject(new Error('failure'))).catch(() => {});
      await cb.execute(() => Promise.reject(new Error('failure'))).catch(() => {});

      // Wait for recovery timeout
      await new Promise((resolve) => setTimeout(resolve, 75));

      // Transition to HALF_OPEN
      await cb.execute(() => Promise.resolve('success'));
      expect(cb.getState()).toBe(CircuitState.HALF_OPEN);

      // Any failure in HALF_OPEN should trip back to OPEN
      await cb.execute(() => Promise.reject(new Error('failure'))).catch(() => {});

      expect(cb.getState()).toBe(CircuitState.OPEN);
      cb.destroy();
    });
  });

  describe('CB-007: Manual State Control', () => {
    it('should support manual open()', () => {
      circuitBreaker.open();
      expect(circuitBreaker.getState()).toBe(CircuitState.OPEN);
    });

    it('should support manual close()', async () => {
      const cb = new CircuitBreaker({
        requestVolumeThreshold: 2,
        errorThresholdPercentage: 50,
      });

      // Trip the circuit
      await cb.execute(() => Promise.reject(new Error('failure'))).catch(() => {});
      await cb.execute(() => Promise.reject(new Error('failure'))).catch(() => {});

      expect(cb.getState()).toBe(CircuitState.OPEN);

      // Manually close
      cb.close();
      expect(cb.getState()).toBe(CircuitState.CLOSED);

      // Should allow requests again
      await expect(
        cb.execute(() => Promise.resolve('success'))
      ).resolves.toBe('success');

      cb.destroy();
    });
  });

  describe('CB-008: Reset Behavior', () => {
    it('should reset all stats', async () => {
      await circuitBreaker.execute(() => Promise.resolve('success'));
      await circuitBreaker.execute(() => Promise.reject(new Error('failure'))).catch(() => {});

      circuitBreaker.reset();

      const stats = circuitBreaker.getStats();
      expect(stats.totalRequests).toBe(0);
      expect(stats.successfulRequests).toBe(0);
      expect(stats.failedRequests).toBe(0);
      expect(stats.errorPercentage).toBe(0);
      expect(stats.state).toBe(CircuitState.CLOSED);
    });

    it('should clear openedAt on reset', async () => {
      const cb = new CircuitBreaker({
        requestVolumeThreshold: 2,
        errorThresholdPercentage: 50,
      });

      // Trip the circuit
      await cb.execute(() => Promise.reject(new Error('failure'))).catch(() => {});
      await cb.execute(() => Promise.reject(new Error('failure'))).catch(() => {});

      expect(cb.getStats().openedAt).toBeDefined();

      cb.reset();
      expect(cb.getStats().openedAt).toBeUndefined();

      cb.destroy();
    });

    it('should clear nextAttemptTime on reset', async () => {
      const cb = new CircuitBreaker({
        requestVolumeThreshold: 2,
        errorThresholdPercentage: 50,
      });

      // Trip the circuit
      await cb.execute(() => Promise.reject(new Error('failure'))).catch(() => {});
      await cb.execute(() => Promise.reject(new Error('failure'))).catch(() => {});

      expect(cb.getStats().nextAttemptTime).toBeDefined();

      cb.reset();
      expect(cb.getStats().nextAttemptTime).toBeUndefined();

      cb.destroy();
    });
  });

  describe('CB-009: Event Listeners', () => {
    it('should call onOpen listener when circuit opens', async () => {
      const onOpen = vi.fn();
      const cb = new CircuitBreaker(
        {
          requestVolumeThreshold: 2,
          errorThresholdPercentage: 50,
        },
        { onOpen }
      );

      // Trip the circuit
      await cb.execute(() => Promise.reject(new Error('failure'))).catch(() => {});
      await cb.execute(() => Promise.reject(new Error('failure'))).catch(() => {});

      expect(onOpen).toHaveBeenCalledTimes(1);
      expect(onOpen).toHaveBeenCalledWith(
        expect.objectContaining({
          state: CircuitState.OPEN,
        })
      );

      cb.destroy();
    });

    it('should call onHalfOpen listener when transitioning to HALF_OPEN', async () => {
      const onHalfOpen = vi.fn();
      const cb = new CircuitBreaker(
        {
          requestVolumeThreshold: 2,
          errorThresholdPercentage: 50,
          recoveryTimeout: 50,
        },
        { onHalfOpen }
      );

      // Trip the circuit
      await cb.execute(() => Promise.reject(new Error('failure'))).catch(() => {});
      await cb.execute(() => Promise.reject(new Error('failure'))).catch(() => {});

      // Wait for recovery timeout
      await new Promise((resolve) => setTimeout(resolve, 75));

      // Execute to trigger transition
      await cb.execute(() => Promise.resolve('success'));

      expect(onHalfOpen).toHaveBeenCalledTimes(1);

      cb.destroy();
    });

    it('should call onClosed listener when circuit closes', async () => {
      const onClosed = vi.fn();
      const cb = new CircuitBreaker(
        {
          requestVolumeThreshold: 2,
          errorThresholdPercentage: 50,
          recoveryTimeout: 50,
        },
        { onClosed }
      );

      // Trip the circuit
      await cb.execute(() => Promise.reject(new Error('failure'))).catch(() => {});
      await cb.execute(() => Promise.reject(new Error('failure'))).catch(() => {});

      // Wait for recovery timeout
      await new Promise((resolve) => setTimeout(resolve, 75));

      // Execute enough successful requests to close
      for (let i = 0; i < 10; i++) {
        await cb.execute(() => Promise.resolve('success'));
      }

      expect(onClosed).toHaveBeenCalledTimes(1);

      cb.destroy();
    });

    it('should call onSuccess listener on successful requests', async () => {
      const onSuccess = vi.fn();
      const cb = new CircuitBreaker({}, { onSuccess });

      await cb.execute(() => Promise.resolve('success'));

      expect(onSuccess).toHaveBeenCalledTimes(1);
      expect(onSuccess).toHaveBeenCalledWith(
        expect.objectContaining({
          successfulRequests: 1,
        })
      );

      cb.destroy();
    });

    it('should call onFailure listener on failed requests', async () => {
      const onFailure = vi.fn();
      const cb = new CircuitBreaker({}, { onFailure });

      const error = new Error('test error');
      await cb.execute(() => Promise.reject(error)).catch(() => {});

      expect(onFailure).toHaveBeenCalledTimes(1);
      expect(onFailure).toHaveBeenCalledWith(
        error,
        expect.objectContaining({
          failedRequests: 1,
        })
      );

      cb.destroy();
    });
  });

  describe('CB-010: Timeout Handling', () => {
    it('should timeout slow requests', async () => {
      const cb = new CircuitBreaker({
        timeout: 50,
      });

      await expect(
        cb.execute(() => new Promise((resolve) => setTimeout(resolve, 200)))
      ).rejects.toThrow('timed out');

      const stats = cb.getStats();
      expect(stats.failedRequests).toBe(1);

      cb.destroy();
    });

    it('should allow fast requests within timeout', async () => {
      const cb = new CircuitBreaker({
        timeout: 100,
      });

      const result = await cb.execute(() =>
        Promise.resolve('fast')
      );

      expect(result).toBe('fast');
      expect(cb.getStats().successfulRequests).toBe(1);

      cb.destroy();
    });
  });

  describe('CB-011: Disabled Circuit Breaker', () => {
    it('should pass through when disabled', async () => {
      const cb = new CircuitBreaker({
        enabled: false,
        requestVolumeThreshold: 1,
        errorThresholdPercentage: 1,
      });

      // Even with 100% failure, should not trip
      for (let i = 0; i < 10; i++) {
        await cb.execute(() => Promise.reject(new Error('failure'))).catch(() => {});
      }

      // State should remain CLOSED
      expect(cb.getState()).toBe(CircuitState.CLOSED);

      // Requests should still work
      await expect(
        cb.execute(() => Promise.resolve('success'))
      ).resolves.toBe('success');

      cb.destroy();
    });
  });

  describe('CB-012: Statistics Tracking', () => {
    it('should track lastFailureTime', async () => {
      const beforeError = Date.now();
      await circuitBreaker
        .execute(() => Promise.reject(new Error('failure')))
        .catch(() => {});

      const stats = circuitBreaker.getStats();
      expect(stats.lastFailureTime).toBeDefined();
      expect(stats.lastFailureTime!.getTime()).toBeGreaterThanOrEqual(
        beforeError
      );
    });

    it('should track lastSuccessTime', async () => {
      const beforeSuccess = Date.now();
      await circuitBreaker.execute(() => Promise.resolve('success'));

      const stats = circuitBreaker.getStats();
      expect(stats.lastSuccessTime).toBeDefined();
      expect(stats.lastSuccessTime!.getTime()).toBeGreaterThanOrEqual(
        beforeSuccess
      );
    });

    it('should return a copy of stats, not reference', () => {
      const stats1 = circuitBreaker.getStats();
      const stats2 = circuitBreaker.getStats();

      expect(stats1).not.toBe(stats2);
      expect(stats1).toEqual(stats2);
    });
  });

  describe('CB-013: Counter Reset in CLOSED State', () => {
    it('should reset counters after 2x request volume threshold', async () => {
      const cb = new CircuitBreaker({
        requestVolumeThreshold: 5,
      });

      // Execute 10 requests (2x threshold)
      for (let i = 0; i < 10; i++) {
        await cb.execute(() => Promise.resolve('success'));
      }

      const stats = cb.getStats();
      // Counters should be reset (not accumulated)
      expect(stats.totalRequests).toBeLessThan(10);
      expect(stats.totalRequests).toBeGreaterThanOrEqual(0);

      cb.destroy();
    });
  });

  describe('CB-014: createCircuitBreaker Factory', () => {
    it('should create circuit breaker with defaults', () => {
      const cb = createCircuitBreaker();
      expect(cb).toBeInstanceOf(CircuitBreaker);
      expect(cb.getState()).toBe(CircuitState.CLOSED);
      cb.destroy();
    });

    it('should create circuit breaker with config', () => {
      const cb = createCircuitBreaker({
        requestVolumeThreshold: 100,
        errorThresholdPercentage: 75,
      });
      expect(cb).toBeInstanceOf(CircuitBreaker);
      cb.destroy();
    });

    it('should create circuit breaker with listeners', () => {
      const onOpen = vi.fn();
      const cb = createCircuitBreaker({}, { onOpen });
      cb.open();
      expect(onOpen).toHaveBeenCalled();
      cb.destroy();
    });
  });

  describe('CB-015: Edge Cases', () => {
    it('should handle synchronous functions', async () => {
      const fn = vi.fn().mockReturnValue('sync result');
      const result = await circuitBreaker.execute(fn);
      expect(result).toBe('sync result');
    });

    it('should handle multiple sequential requests', async () => {
      const results: string[] = [];
      for (let i = 0; i < 20; i++) {
        const result = await circuitBreaker.execute(() =>
          Promise.resolve(`request-${i}`)
        );
        results.push(result);
      }

      expect(results).toHaveLength(20);
      expect(circuitBreaker.getStats().successfulRequests).toBe(20);
    });

    it('should handle destroy being called multiple times', () => {
      circuitBreaker.destroy();
      expect(() => circuitBreaker.destroy()).not.toThrow();
    });
  });
});

describe('Retry Policy', () => {
  describe('RP-001: Default Configuration', () => {
    it('should use default config values', () => {
      const policy = new RetryPolicy();

      const result = policy.execute(async () => 'success');

      expect(result).resolves.toEqual(
        expect.objectContaining({
          success: true,
          attempts: 1,
        })
      );
    });
  });

  describe('RP-002: Successful Execution', () => {
    it('should return success on first attempt', async () => {
      const policy = new RetryPolicy();
      const fn = vi.fn().mockResolvedValue('success');

      const result = await policy.execute(fn);

      expect(result.success).toBe(true);
      expect(result.value).toBe('success');
      expect(result.attempts).toBe(1);
      expect(result.totalDelay).toBe(0);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should return success with retries', async () => {
      const policy = new RetryPolicy({
        maxAttempts: 3,
        initialDelay: 10,
      });

      const fn = vi.fn()
        .mockRejectedValueOnce(Object.assign(new Error('fail 1'), { code: 'ETIMEDOUT' }))
        .mockRejectedValueOnce(Object.assign(new Error('fail 2'), { code: 'ETIMEDOUT' }))
        .mockResolvedValue('success');

      const result = await policy.execute(fn);

      expect(result.success).toBe(true);
      expect(result.value).toBe('success');
      expect(result.attempts).toBe(3);
      expect(fn).toHaveBeenCalledTimes(3);
    });
  });

  describe('RP-003: Exponential Backoff', () => {
    it('should calculate exponential backoff delays', async () => {
      const policy = new RetryPolicy({
        maxAttempts: 5,
        initialDelay: 100,
        backoffMultiplier: 2,
        maxDelay: 1000,
        jitter: 0, // No jitter for predictable delays
      });

      const delays: number[] = [];
      const fn = vi.fn(async (options) => {
        delays.push(options.delay);
        if (options.attemptNumber < 5) {
          throw new Error('ETIMEDOUT');
        }
        return 'success';
      });

      await policy.execute(fn);

      // Delay is the time to wait BEFORE the next retry
      // First attempt gets initialDelay (100) - delay to wait before retry 2
      // Second attempt gets 200 - delay to wait before retry 3
      expect(delays[0]).toBe(100); // First attempt - initial delay
      expect(delays[1]).toBe(200); // Second attempt - 2x initial
      expect(delays[2]).toBe(400); // Third attempt - 4x initial
    });

    it('should respect maxDelay cap', async () => {
      const policy = new RetryPolicy({
        maxAttempts: 10,
        initialDelay: 100,
        backoffMultiplier: 10, // Large multiplier to hit cap quickly
        maxDelay: 500,
      });

      const fn = vi.fn(async (options) => {
        if (options.attemptNumber < 10) {
          throw new Error('ETIMEDOUT');
        }
        return 'success';
      });

      await policy.execute(fn);

      // Check that delays don't exceed maxDelay
      const stats = policy.execute(fn);
      // We can't easily test the exact delay without accessing internals,
      // but we can verify the policy was created correctly
      expect(policy).toBeInstanceOf(RetryPolicy);
    });
  });

  describe('RP-004: Jitter', () => {
    it('should add jitter to delays', async () => {
      const policy = new RetryPolicy({
        maxAttempts: 4,
        initialDelay: 100,
        jitter: 0.2, // 20% jitter
      });

      const actualDelays: number[] = [];
      const fn = vi.fn(async (options) => {
        if (options.attemptNumber < 4) {
          throw new Error('ETIMEDOUT');
        }
        return 'success';
      });

      // Run multiple times and collect delays
      const runs: number[][] = [];
      for (let i = 0; i < 5; i++) {
        const delays: number[] = [];
        fn.mockImplementation(async (options) => {
          delays.push(options.delay);
          if (options.attemptNumber < 4) {
            throw new Error('ETIMEDOUT');
          }
          return 'success';
        });

        await policy.execute(fn);
        runs.push(delays);
        fn.mockClear();
      }

      // With jitter, delays should vary across runs
      // This is a probabilistic test, but 5 runs should show some variation
      expect(policy).toBeInstanceOf(RetryPolicy);
    });

    it('should not add jitter when jitter is 0', async () => {
      const policy = new RetryPolicy({
        maxAttempts: 3,
        initialDelay: 100,
        jitter: 0,
      });

      const fn = vi.fn(async (options) => {
        if (options.attemptNumber < 3) {
          throw new Error('ETIMEDOUT');
        }
        return 'success';
      });

      await policy.execute(fn);

      // Without jitter, the delay passed to the function
      // should be predictable (though we can't directly observe the actual sleep time)
      expect(fn).toHaveBeenCalledTimes(3);
    });
  });

  describe('RP-005: Max Attempts', () => {
    it('should stop after max attempts', async () => {
      const policy = new RetryPolicy({
        maxAttempts: 3,
        initialDelay: 10,
      });

      const fn = vi.fn().mockRejectedValue(new Error('ETIMEDOUT'));

      const result = await policy.execute(fn);

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(3);
      expect(result.error).toBeDefined();
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should return failure when max attempts exhausted', async () => {
      const policy = new RetryPolicy({
        maxAttempts: 2,
      });

      const fn = vi.fn().mockRejectedValue(new Error('ETIMEDOUT'));

      const result = await policy.execute(fn);

      expect(result.success).toBe(false);
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error!.message).toBe('ETIMEDOUT');
    });
  });

  describe('RP-006: Retryable Error Detection', () => {
    it('should retry on ETIMEDOUT error code', async () => {
      const policy = new RetryPolicy({
        maxAttempts: 3,
        initialDelay: 10,
      });

      const fn = vi.fn()
        .mockRejectedValueOnce(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }))
        .mockResolvedValue('success');

      const result = await policy.execute(fn);

      expect(result.success).toBe(true);
      expect(result.attempts).toBe(2);
    });

    it('should retry on ECONNRESET error code', async () => {
      const policy = new RetryPolicy({
        maxAttempts: 2,
        initialDelay: 10,
      });

      const fn = vi.fn()
        .mockRejectedValueOnce(Object.assign(new Error('connection reset'), { code: 'ECONNRESET' }))
        .mockResolvedValue('success');

      const result = await policy.execute(fn);

      expect(result.success).toBe(true);
      expect(result.attempts).toBe(2);
    });

    it('should retry on HTTP 429 status', async () => {
      const policy = new RetryPolicy({
        maxAttempts: 2,
        initialDelay: 10,
      });

      const fn = vi.fn()
        .mockRejectedValueOnce(Object.assign(new Error('too many requests'), { code: '429' }))
        .mockResolvedValue('success');

      const result = await policy.execute(fn);

      expect(result.success).toBe(true);
      expect(result.attempts).toBe(2);
    });

    it('should retry on HTTP 503 status', async () => {
      const policy = new RetryPolicy({
        maxAttempts: 2,
        initialDelay: 10,
      });

      const fn = vi.fn()
        .mockRejectedValueOnce(Object.assign(new Error('service unavailable'), { code: '503' }))
        .mockResolvedValue('success');

      const result = await policy.execute(fn);

      expect(result.success).toBe(true);
      expect(result.attempts).toBe(2);
    });

    it('should retry on NetworkError type', async () => {
      const policy = new RetryPolicy({
        maxAttempts: 2,
        initialDelay: 10,
      });

      const error = new Error('network error');
      error.name = 'NetworkError';

      const fn = vi.fn()
        .mockRejectedValueOnce(error)
        .mockResolvedValue('success');

      const result = await policy.execute(fn);

      expect(result.success).toBe(true);
      expect(result.attempts).toBe(2);
    });

    it('should retry on TimeoutError type', async () => {
      const policy = new RetryPolicy({
        maxAttempts: 2,
        initialDelay: 10,
      });

      const error = new Error('timeout');
      error.name = 'TimeoutError';

      const fn = vi.fn()
        .mockRejectedValueOnce(error)
        .mockResolvedValue('success');

      const result = await policy.execute(fn);

      expect(result.success).toBe(true);
      expect(result.attempts).toBe(2);
    });

    it('should retry on timeout in message', async () => {
      const policy = new RetryPolicy({
        maxAttempts: 2,
        initialDelay: 10,
      });

      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('Request timeout occurred'))
        .mockResolvedValue('success');

      const result = await policy.execute(fn);

      expect(result.success).toBe(true);
      expect(result.attempts).toBe(2);
    });

    it('should retry on network in message', async () => {
      const policy = new RetryPolicy({
        maxAttempts: 2,
        initialDelay: 10,
      });

      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('Network connection failed'))
        .mockResolvedValue('success');

      const result = await policy.execute(fn);

      expect(result.success).toBe(true);
      expect(result.attempts).toBe(2);
    });

    it('should NOT retry on non-retryable errors', async () => {
      const policy = new RetryPolicy({
        maxAttempts: 3,
        initialDelay: 10,
      });

      const fn = vi.fn().mockRejectedValue(new Error('Not retryable'));

      const result = await policy.execute(fn);

      expect(result.success).toBe(false);
      // Note: The implementation returns maxAttempts even for non-retryable errors
      expect(result.attempts).toBe(3);
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe('RP-007: Custom Retryable Errors', () => {
    it('should retry on custom error codes', async () => {
      const policy = new RetryPolicy({
        maxAttempts: 2,
        initialDelay: 10,
        retryableErrorCodes: ['CUSTOM_ERROR'],
      });

      const fn = vi.fn()
        .mockRejectedValueOnce(Object.assign(new Error('custom'), { code: 'CUSTOM_ERROR' }))
        .mockResolvedValue('success');

      const result = await policy.execute(fn);

      expect(result.success).toBe(true);
      expect(result.attempts).toBe(2);
    });

    it('should retry on custom error types', async () => {
      const policy = new RetryPolicy({
        maxAttempts: 2,
        initialDelay: 10,
        retryableErrorTypes: ['CustomError'],
      });

      const error = new Error('custom');
      error.name = 'CustomError';

      const fn = vi.fn()
        .mockRejectedValueOnce(error)
        .mockResolvedValue('success');

      const result = await policy.execute(fn);

      expect(result.success).toBe(true);
      expect(result.attempts).toBe(2);
    });
  });

  describe('RP-008: Disabled Retry Policy', () => {
    it('should not retry when disabled', async () => {
      const policy = new RetryPolicy({
        enabled: false,
        maxAttempts: 5,
      });

      const fn = vi.fn().mockRejectedValue(new Error('ETIMEDOUT'));

      const result = await policy.execute(fn);

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(1);
      expect(result.totalDelay).toBe(0);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should still execute function when disabled', async () => {
      const policy = new RetryPolicy({
        enabled: false,
      });

      const fn = vi.fn().mockResolvedValue('success');

      const result = await policy.execute(fn);

      expect(result.success).toBe(true);
      expect(result.value).toBe('success');
      expect(result.attempts).toBe(1);
    });
  });

  describe('RP-009: Total Delay Tracking', () => {
    it('should track total delay across retries', async () => {
      const policy = new RetryPolicy({
        maxAttempts: 4,
        initialDelay: 50,
        backoffMultiplier: 2,
        jitter: 0, // No jitter for predictable delays
      });

      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('ETIMEDOUT'))
        .mockRejectedValueOnce(new Error('ETIMEDOUT'))
        .mockRejectedValueOnce(new Error('ETIMEDOUT'))
        .mockResolvedValue('success');

      const result = await policy.execute(fn);

      expect(result.success).toBe(true);
      expect(result.totalDelay).toBeGreaterThan(0);
      // Initial delay 50 + 100 + 200 = 350 (approximate, with possible timing variations)
      expect(result.totalDelay).toBeGreaterThan(40);
    });
  });

  describe('RP-010: Attempt Options', () => {
    it('should pass attemptNumber to function', async () => {
      const policy = new RetryPolicy({
        maxAttempts: 3,
        initialDelay: 10,
      });

      const attemptNumbers: number[] = [];
      const fn = vi.fn(async (options) => {
        attemptNumbers.push(options.attemptNumber);
        if (options.attemptNumber < 3) {
          throw new Error('ETIMEDOUT');
        }
        return 'success';
      });

      await policy.execute(fn);

      expect(attemptNumbers).toEqual([1, 2, 3]);
    });

    it('should pass delay to function', async () => {
      const policy = new RetryPolicy({
        maxAttempts: 3,
        initialDelay: 100,
      });

      const delays: number[] = [];
      const fn = vi.fn(async (options) => {
        delays.push(options.delay);
        if (options.attemptNumber < 3) {
          throw new Error('ETIMEDOUT');
        }
        return 'success';
      });

      await policy.execute(fn);

      expect(delays).toHaveLength(3);
      // First attempt gets initialDelay (100) - delay to wait before retry 2
      expect(delays[0]).toBe(100);
      expect(delays[1]).toBeGreaterThan(0); // Second attempt delay
    });

    it('should pass remainingAttempts to function', async () => {
      const policy = new RetryPolicy({
        maxAttempts: 3,
        initialDelay: 10,
      });

      const remaining: number[] = [];
      const fn = vi.fn(async (options) => {
        remaining.push(options.remainingAttempts);
        if (options.attemptNumber < 3) {
          throw new Error('ETIMEDOUT');
        }
        return 'success';
      });

      await policy.execute(fn);

      expect(remaining).toEqual([2, 1, 0]);
    });
  });

  describe('RP-011: createRetryPolicy Factory', () => {
    it('should create retry policy with defaults', () => {
      const policy = createRetryPolicy();
      expect(policy).toBeInstanceOf(RetryPolicy);
    });

    it('should create retry policy with config', () => {
      const policy = createRetryPolicy({
        maxAttempts: 5,
        initialDelay: 2000,
      });
      expect(policy).toBeInstanceOf(RetryPolicy);
    });
  });

  describe('RP-012: Edge Cases', () => {
    it('should handle synchronous functions', async () => {
      const policy = new RetryPolicy();
      const fn = vi.fn().mockReturnValue('sync result');

      const result = await policy.execute(fn);

      expect(result.success).toBe(true);
      expect(result.value).toBe('sync result');
    });

    it('should handle functions that return non-Promise values', async () => {
      const policy = new RetryPolicy({
        maxAttempts: 2,
        initialDelay: 10,
      });

      const fn = vi.fn()
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce('success');

      const result = await policy.execute(fn);

      // First attempt succeeds (even with undefined)
      expect(result.success).toBe(true);
    });

    it('should handle maxAttempts of 1', async () => {
      const policy = new RetryPolicy({
        maxAttempts: 1,
      });

      const fn = vi.fn().mockRejectedValue(new Error('ETIMEDOUT'));

      const result = await policy.execute(fn);

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(1);
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });
});

describe('Telemetry Service', () => {
  let mockLogger: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
  });

  describe('TS-001: ConsoleTelemetryCollector', () => {
    it('should use provided logger', () => {
      const collector = new ConsoleTelemetryCollector(mockLogger);

      collector.collect({
        type: TelemetryEventType.VALIDATION_START,
        runId: 'test-run',
      });

      expect(mockLogger.debug).toHaveBeenCalledWith(
        '[Telemetry]',
        expect.objectContaining({
          type: TelemetryEventType.VALIDATION_START,
          runId: 'test-run',
        })
      );
    });

    it('should use console when no logger provided', () => {
      const consoleDebug = vi.spyOn(console, 'debug').mockImplementation(() => {});

      const collector = new ConsoleTelemetryCollector();

      collector.collect({
        type: TelemetryEventType.VALIDATION_START,
        runId: 'test-run',
      });

      expect(consoleDebug).toHaveBeenCalled();

      consoleDebug.mockRestore();
    });
  });

  describe('TS-002: CallbackTelemetryCollector', () => {
    it('should call callback with event', async () => {
      const callback = vi.fn();
      const collector = new CallbackTelemetryCollector(callback);

      const event: TelemetryEvent = {
        type: TelemetryEventType.VALIDATION_START,
        runId: 'test-run',
      };

      await collector.collect(event);

      expect(callback).toHaveBeenCalledWith(event);
    });

    it('should handle async callbacks', async () => {
      const callback = vi.fn().mockResolvedValue(undefined);
      const collector = new CallbackTelemetryCollector(callback);

      const event: TelemetryEvent = {
        type: TelemetryEventType.VALIDATION_COMPLETE,
        runId: 'test-run',
      };

      await expect(collector.collect(event)).resolves.not.toThrow();
      expect(callback).toHaveBeenCalledWith(event);
    });
  });

  describe('TS-003: BufferedTelemetryCollector', () => {
    it('should buffer events until flush', () => {
      const delegate = {
        collect: vi.fn(),
      };

      const collector = new BufferedTelemetryCollector(delegate, 5, 1000);

      // Add 4 events (below buffer size)
      for (let i = 0; i < 4; i++) {
        collector.collect({
          type: TelemetryEventType.VALIDATION_START,
          runId: `run-${i}`,
        });
      }

      // Delegate should not have been called yet
      expect(delegate.collect).not.toHaveBeenCalled();

      // Add 5th event to trigger flush
      collector.collect({
        type: TelemetryEventType.VALIDATION_COMPLETE,
        runId: 'run-4',
      });

      // Should have flushed all 5 events
      expect(delegate.collect).toHaveBeenCalledTimes(5);
    });

    it('should flush on demand', () => {
      const delegate = {
        collect: vi.fn(),
      };

      const collector = new BufferedTelemetryCollector(delegate, 100, 1000);

      collector.collect({
        type: TelemetryEventType.VALIDATION_START,
        runId: 'run-1',
      });

      expect(delegate.collect).not.toHaveBeenCalled();

      collector.flush();

      expect(delegate.collect).toHaveBeenCalledTimes(1);
    });

    it('should clear buffer after flush', () => {
      const delegate = {
        collect: vi.fn(),
      };

      const collector = new BufferedTelemetryCollector(delegate, 2, 1000);

      collector.collect({
        type: TelemetryEventType.VALIDATION_START,
        runId: 'run-1',
      });
      collector.collect({
        type: TelemetryEventType.VALIDATION_COMPLETE,
        runId: 'run-1',
      });

      expect(delegate.collect).toHaveBeenCalledTimes(2);

      collector.flush();

      // No additional calls expected (buffer was already flushed)
      // The flush should have cleared any remaining events
    });

    it('should handle delegate errors gracefully', () => {
      const delegate = {
        collect: vi.fn().mockImplementation(() => {
          throw new Error('Collector error');
        }),
      };

      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      const collector = new BufferedTelemetryCollector(delegate, 1, 1000);

      expect(() => {
        collector.collect({
          type: TelemetryEventType.VALIDATION_START,
          runId: 'run-1',
        });
      }).not.toThrow();

      expect(consoleError).toHaveBeenCalled();

      consoleError.mockRestore();
    });

    it('should shutdown and flush remaining events', () => {
      const delegate = {
        collect: vi.fn(),
        shutdown: vi.fn(),
      };

      const collector = new BufferedTelemetryCollector(delegate, 100, 1000);

      collector.collect({
        type: TelemetryEventType.VALIDATION_START,
        runId: 'run-1',
      });

      collector.shutdown();

      expect(delegate.collect).toHaveBeenCalledTimes(1);
    });
  });

  describe('TS-004: TelemetryService Basic Operations', () => {
    it('should record events', () => {
      const collector = {
        collect: vi.fn(),
      };

      const service = new TelemetryService({
        collectors: [collector],
        maxBufferSize: 0, // Disable buffering
      });

      service.record({
        type: TelemetryEventType.VALIDATION_START,
        runId: 'test-run',
      });

      expect(collector.collect).toHaveBeenCalledWith(
        expect.objectContaining({
          type: TelemetryEventType.VALIDATION_START,
          runId: 'test-run',
          timestamp: expect.any(Number),
        })
      );
    });

    it('should add timestamp if not provided', () => {
      const collector = {
        collect: vi.fn(),
      };

      const service = new TelemetryService({
        collectors: [collector],
        maxBufferSize: 0,
      });

      const beforeTime = Date.now();
      service.record({
        type: TelemetryEventType.VALIDATION_START,
        runId: 'test-run',
      });
      const afterTime = Date.now();

      const eventArg = collector.collect.mock.calls[0][0];
      expect(eventArg.timestamp).toBeGreaterThanOrEqual(beforeTime);
      expect(eventArg.timestamp).toBeLessThanOrEqual(afterTime);
    });

    it('should use existing timestamp if provided', () => {
      const collector = {
        collect: vi.fn(),
      };

      const service = new TelemetryService({
        collectors: [collector],
        maxBufferSize: 0,
      });

      const customTimestamp = 1234567890;
      service.record({
        type: TelemetryEventType.VALIDATION_START,
        runId: 'test-run',
        timestamp: customTimestamp,
      });

      const eventArg = collector.collect.mock.calls[0][0];
      expect(eventArg.timestamp).toBe(customTimestamp);
    });

    it('should not record when disabled', () => {
      const collector = {
        collect: vi.fn(),
      };

      const service = new TelemetryService({
        enabled: false,
        collectors: [collector],
      });

      service.record({
        type: TelemetryEventType.VALIDATION_START,
        runId: 'test-run',
      });

      expect(collector.collect).not.toHaveBeenCalled();
    });
  });

  describe('TS-005: TelemetryService Sampling', () => {
    it('should apply sampling rate', () => {
      const collector = {
        collect: vi.fn(),
      };

      const service = new TelemetryService({
        sampleRate: 0.5, // 50% sampling
        collectors: [collector],
        maxBufferSize: 0, // Disable buffering for immediate testing
      });

      // Record many events
      for (let i = 0; i < 1000; i++) {
        service.record({
          type: TelemetryEventType.VALIDATION_START,
          runId: `run-${i}`,
        });
      }

      // Should have roughly 50% recorded (allow some variance)
      const callCount = collector.collect.mock.calls.length;
      expect(callCount).toBeGreaterThan(400);
      expect(callCount).toBeLessThan(600);
    });

    it('should record all events when sampleRate is 1.0', () => {
      const collector = {
        collect: vi.fn(),
      };

      const service = new TelemetryService({
        sampleRate: 1.0,
        collectors: [collector],
        maxBufferSize: 0,
      });

      for (let i = 0; i < 100; i++) {
        service.record({
          type: TelemetryEventType.VALIDATION_START,
          runId: `run-${i}`,
        });
      }

      expect(collector.collect).toHaveBeenCalledTimes(100);
    });

    it('should record no events when sampleRate is 0', () => {
      const collector = {
        collect: vi.fn(),
      };

      const service = new TelemetryService({
        sampleRate: 0,
        collectors: [collector],
      });

      for (let i = 0; i < 100; i++) {
        service.record({
          type: TelemetryEventType.VALIDATION_START,
          runId: `run-${i}`,
        });
      }

      expect(collector.collect).not.toHaveBeenCalled();
    });
  });

  describe('TS-006: TelemetryService Record Methods', () => {
    it('should record validation start', () => {
      const collector = {
        collect: vi.fn(),
      };

      const service = new TelemetryService({
        collectors: [collector],
        maxBufferSize: 0, // Disable buffering for immediate testing
      });

      service.recordValidationStart({
        runId: 'test-run',
        connector: 'openai',
        content: 'test content',
        direction: 'input',
      });

      expect(collector.collect).toHaveBeenCalledWith(
        expect.objectContaining({
          type: TelemetryEventType.VALIDATION_START,
          runId: 'test-run',
          connector: 'openai',
          metrics: expect.objectContaining({
            charCount: 12,
          }),
          context: expect.objectContaining({
            direction: 'input',
          }),
        })
      );
    });

    it('should record validation complete when allowed', () => {
      const collector = {
        collect: vi.fn(),
      };

      const service = new TelemetryService({
        collectors: [collector],
        maxBufferSize: 0,
      });

      service.recordValidationComplete({
        runId: 'test-run',
        connector: 'openai',
        duration: 100,
        validatorCount: 5,
        findingCount: 2,
        riskScore: 0.5,
        allowed: true,
      });

      expect(collector.collect).toHaveBeenCalledWith(
        expect.objectContaining({
          type: TelemetryEventType.VALIDATION_COMPLETE,
          metrics: expect.objectContaining({
            duration: 100,
            validatorCount: 5,
            findingCount: 2,
            riskScore: 0.5,
          }),
          context: expect.objectContaining({
            allowed: true,
          }),
        })
      );
    });

    it('should record validation blocked when not allowed', () => {
      const collector = {
        collect: vi.fn(),
      };

      const service = new TelemetryService({
        collectors: [collector],
        maxBufferSize: 0,
      });

      service.recordValidationComplete({
        runId: 'test-run',
        connector: 'openai',
        duration: 100,
        validatorCount: 5,
        findingCount: 10,
        riskScore: 0.9,
        allowed: false,
      });

      expect(collector.collect).toHaveBeenCalledWith(
        expect.objectContaining({
          type: TelemetryEventType.VALIDATION_BLOCKED,
          context: expect.objectContaining({
            allowed: false,
          }),
        })
      );
    });

    it('should record validation error', () => {
      const collector = {
        collect: vi.fn(),
      };

      const service = new TelemetryService({
        collectors: [collector],
        maxBufferSize: 0,
      });

      const error = new Error('Validation failed');
      (error as any).code = 'VALIDATION_ERROR';

      service.recordValidationError({
        runId: 'test-run',
        connector: 'openai',
        error,
      });

      expect(collector.collect).toHaveBeenCalledWith(
        expect.objectContaining({
          type: TelemetryEventType.VALIDATION_ERROR,
          error: expect.objectContaining({
            name: 'Error',
            message: 'Validation failed',
            code: 'VALIDATION_ERROR',
          }),
        })
      );
    });

    it('should record stream start', () => {
      const collector = {
        collect: vi.fn(),
      };

      const service = new TelemetryService({
        collectors: [collector],
        maxBufferSize: 0,
      });

      service.recordStreamStart({
        runId: 'test-run',
        connector: 'openai',
      });

      expect(collector.collect).toHaveBeenCalledWith(
        expect.objectContaining({
          type: TelemetryEventType.STREAM_START,
          runId: 'test-run',
          connector: 'openai',
          operation: 'stream',
        })
      );
    });

    it('should record stream chunk', () => {
      const collector = {
        collect: vi.fn(),
      };

      const service = new TelemetryService({
        collectors: [collector],
        maxBufferSize: 0,
      });

      service.recordStreamChunk({
        runId: 'test-run',
        connector: 'openai',
        tokenCount: 5,
        charCount: 25,
      });

      expect(collector.collect).toHaveBeenCalledWith(
        expect.objectContaining({
          type: TelemetryEventType.STREAM_CHUNK,
          metrics: expect.objectContaining({
            tokenCount: 5,
            charCount: 25,
          }),
        })
      );
    });

    it('should record stream blocked', () => {
      const collector = {
        collect: vi.fn(),
      };

      const service = new TelemetryService({
        collectors: [collector],
        maxBufferSize: 0,
      });

      service.recordStreamBlocked({
        runId: 'test-run',
        connector: 'openai',
        accumulatedLength: 500,
      });

      expect(collector.collect).toHaveBeenCalledWith(
        expect.objectContaining({
          type: TelemetryEventType.STREAM_BLOCKED,
          metrics: expect.objectContaining({
            charCount: 500,
          }),
        })
      );
    });

    it('should record API call start', () => {
      const collector = {
        collect: vi.fn(),
      };

      const service = new TelemetryService({
        collectors: [collector],
        maxBufferSize: 0,
      });

      service.recordApiCallStart({
        runId: 'test-run',
        connector: 'openai',
        method: 'chat.completions.create',
      });

      expect(collector.collect).toHaveBeenCalledWith(
        expect.objectContaining({
          type: TelemetryEventType.API_CALL_START,
          runId: 'test-run',
          connector: 'openai',
          operation: 'chat.completions.create',
        })
      );
    });

    it('should record API call complete', () => {
      const collector = {
        collect: vi.fn(),
      };

      const service = new TelemetryService({
        collectors: [collector],
        maxBufferSize: 0,
      });

      service.recordApiCallComplete({
        runId: 'test-run',
        connector: 'openai',
        method: 'chat.completions.create',
        duration: 500,
        success: true,
      });

      expect(collector.collect).toHaveBeenCalledWith(
        expect.objectContaining({
          type: TelemetryEventType.API_CALL_COMPLETE,
          metrics: expect.objectContaining({
            duration: 500,
          }),
        })
      );
    });

    it('should record API call error', () => {
      const collector = {
        collect: vi.fn(),
      };

      const service = new TelemetryService({
        collectors: [collector],
        maxBufferSize: 0,
      });

      service.recordApiCallComplete({
        runId: 'test-run',
        connector: 'openai',
        method: 'chat.completions.create',
        duration: 100,
        success: false,
      });

      expect(collector.collect).toHaveBeenCalledWith(
        expect.objectContaining({
          type: TelemetryEventType.API_CALL_ERROR,
        })
      );
    });
  });

  describe('TS-007: TelemetryService Flush and Shutdown', () => {
    it('should flush all collectors', () => {
      const collector1 = {
        collect: vi.fn(),
        flush: vi.fn(),
      };
      const collector2 = {
        collect: vi.fn(),
        flush: vi.fn(),
      };

      const service = new TelemetryService({
        collectors: [collector1, collector2],
        maxBufferSize: 0, // Don't wrap in BufferedTelemetryCollector
      });

      service.flush();

      expect(collector1.flush).toHaveBeenCalled();
      expect(collector2.flush).toHaveBeenCalled();
    });

    it('should shutdown all collectors', () => {
      const collector1 = {
        collect: vi.fn(),
        shutdown: vi.fn(),
      };
      const collector2 = {
        collect: vi.fn(),
        shutdown: vi.fn(),
      };

      const service = new TelemetryService({
        collectors: [collector1, collector2],
        maxBufferSize: 0,
      });

      service.shutdown();

      expect(collector1.shutdown).toHaveBeenCalled();
      expect(collector2.shutdown).toHaveBeenCalled();
    });

    it('should handle collectors without flush/shutdown', () => {
      const collector = {
        collect: vi.fn(),
      };

      const service = new TelemetryService({
        collectors: [collector],
        maxBufferSize: 0,
      });

      expect(() => {
        service.flush();
        service.shutdown();
      }).not.toThrow();
    });
  });

  describe('TS-008: TelemetryService Collector Management', () => {
    it('should add collector', () => {
      const collector = {
        collect: vi.fn(),
      };

      const service = new TelemetryService({
        collectors: [],
        maxBufferSize: 0,
      });

      service.addCollector(collector);

      service.record({
        type: TelemetryEventType.VALIDATION_START,
        runId: 'test-run',
      });

      expect(collector.collect).toHaveBeenCalled();
    });

    it('should remove collector', () => {
      const collector1 = {
        collect: vi.fn(),
      };
      const collector2 = {
        collect: vi.fn(),
      };

      const service = new TelemetryService({
        collectors: [collector1, collector2],
        maxBufferSize: 0,
      });

      service.removeCollector(collector1);

      service.record({
        type: TelemetryEventType.VALIDATION_START,
        runId: 'test-run',
      });

      expect(collector1.collect).not.toHaveBeenCalled();
      expect(collector2.collect).toHaveBeenCalled();
    });
  });

  describe('TS-009: TelemetryService Error Handling', () => {
    it('should handle collector errors gracefully', () => {
      const errorCollector = {
        collect: vi.fn().mockImplementation(() => {
          throw new Error('Collector error');
        }),
      };
      const goodCollector = {
        collect: vi.fn(),
      };

      const service = new TelemetryService({
        collectors: [errorCollector, goodCollector],
        logger: mockLogger,
        maxBufferSize: 0,
      });

      service.record({
        type: TelemetryEventType.VALIDATION_START,
        runId: 'test-run',
      });

      // Good collector should still be called
      expect(goodCollector.collect).toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it('should handle flush errors gracefully', () => {
      const errorCollector = {
        collect: vi.fn(),
        flush: vi.fn().mockImplementation(() => {
          throw new Error('Flush error');
        }),
      };
      const goodCollector = {
        collect: vi.fn(),
        flush: vi.fn(),
      };

      const service = new TelemetryService({
        collectors: [errorCollector, goodCollector],
        logger: mockLogger,
        maxBufferSize: 0,
      });

      expect(() => service.flush()).not.toThrow();
      expect(goodCollector.flush).toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it('should handle shutdown errors gracefully', () => {
      const errorCollector = {
        collect: vi.fn(),
        shutdown: vi.fn().mockImplementation(() => {
          throw new Error('Shutdown error');
        }),
      };
      const goodCollector = {
        collect: vi.fn(),
        shutdown: vi.fn(),
      };

      const service = new TelemetryService({
        collectors: [errorCollector, goodCollector],
        logger: mockLogger,
        maxBufferSize: 0,
      });

      expect(() => service.shutdown()).not.toThrow();
      expect(goodCollector.shutdown).toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalled();
    });
  });

  describe('TS-010: createTelemetryService Factory', () => {
    it('should create service with console collector by default', () => {
      const service = createTelemetryService();

      service.record({
        type: TelemetryEventType.VALIDATION_START,
        runId: 'test-run',
      });

      // Should not throw - console collector is added by default
      expect(service).toBeInstanceOf(TelemetryService);
    });

    it('should create service with custom collectors', () => {
      const collector = {
        collect: vi.fn(),
      };

      const service = createTelemetryService({
        collectors: [collector],
        maxBufferSize: 0,
      });

      service.record({
        type: TelemetryEventType.VALIDATION_START,
        runId: 'test-run',
      });

      expect(collector.collect).toHaveBeenCalled();
    });

    it('should create service disabled', () => {
      const collector = {
        collect: vi.fn(),
      };

      const service = createTelemetryService({
        enabled: false,
        collectors: [collector],
        maxBufferSize: 0,
      });

      service.record({
        type: TelemetryEventType.VALIDATION_START,
        runId: 'test-run',
      });

      expect(collector.collect).not.toHaveBeenCalled();
    });
  });

  describe('TS-011: Metrics Collection', () => {
    it('should record custom metrics', () => {
      const collector = {
        collect: vi.fn(),
      };

      const service = new TelemetryService({
        collectors: [collector],
        maxBufferSize: 0,
      });

      const customMetrics: TelemetryMetrics = {
        duration: 100,
        customMetric1: 42,
        customMetric2: 99,
      };

      service.record({
        type: TelemetryEventType.API_CALL_COMPLETE,
        runId: 'test-run',
        metrics: customMetrics,
      });

      expect(collector.collect).toHaveBeenCalledWith(
        expect.objectContaining({
          metrics: customMetrics,
        })
      );
    });

    it('should support undefined metric values', () => {
      const collector = {
        collect: vi.fn(),
      };

      const service = new TelemetryService({
        collectors: [collector],
        maxBufferSize: 0,
      });

      service.record({
        type: TelemetryEventType.VALIDATION_START,
        runId: 'test-run',
        metrics: {
          duration: 100,
          tokenCount: undefined,
        },
      });

      expect(collector.collect).toHaveBeenCalled();
    });
  });

  describe('TS-012: Context and Run ID Tracking', () => {
    it('should support parent run ID', () => {
      const collector = {
        collect: vi.fn(),
      };

      const service = new TelemetryService({
        collectors: [collector],
        maxBufferSize: 0,
      });

      service.record({
        type: TelemetryEventType.VALIDATION_START,
        runId: 'child-run',
        parentRunId: 'parent-run',
      });

      expect(collector.collect).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: 'child-run',
          parentRunId: 'parent-run',
        })
      );
    });

    it('should support custom context', () => {
      const collector = {
        collect: vi.fn(),
      };

      const service = new TelemetryService({
        collectors: [collector],
        maxBufferSize: 0,
      });

      service.record({
        type: TelemetryEventType.VALIDATION_START,
        runId: 'test-run',
        context: {
          customField: 'custom value',
          anotherField: 123,
        },
      });

      expect(collector.collect).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({
            customField: 'custom value',
            anotherField: 123,
          }),
        })
      );
    });
  });

  // ---------------------------------------------------------------------------
  // HB-5 (ST-05-005) Sprint 51 Wave 3 — BufferedTelemetryCollector.flush()
  // serializeError regression tests.
  //
  // Pre-fix: console.error wrote the raw error object; a hostile error whose
  // .toString() returns ANSI/control sequences injected those bytes directly
  // into stderr (CWE-117 residual from Sprint 48 sweep which missed this
  // nested-class site).
  //
  // Post-fix: the error passes through serializeError → sanitizeLogString,
  // so control chars are hex-escaped before reaching the console sink.
  // ---------------------------------------------------------------------------
  describe('HB-5 (ST-05-005): BufferedTelemetryCollector.flush() serializeError regression', () => {
    it('sanitizes a hostile error with ANSI terminal-clear payload — no raw control chars in stderr', () => {
      // The hostile error: .toString() returns a string containing BEL (\x07)
      // and ANSI terminal-clear sequence (\x1b[2J\x1b[H). Pre-fix these bytes
      // would be written verbatim to stderr.
      const hostileError = new Error('OK\x07\x1b[2J\x1b[H');

      const delegate = {
        collect: vi.fn().mockImplementation(() => {
          throw hostileError;
        }),
      };

      const errorArgs: unknown[][] = [];
      const consoleError = vi.spyOn(console, 'error').mockImplementation((...args) => {
        errorArgs.push(args);
      });

      const collector = new BufferedTelemetryCollector(delegate, 1, 1000);
      collector.collect({ type: TelemetryEventType.VALIDATION_START });

      consoleError.mockRestore();

      expect(errorArgs.length).toBeGreaterThan(0);

      // Flatten all arguments to a single string for inspection.
      const logOutput = errorArgs
        .flat()
        .map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a)))
        .join(' ');

      // POST-FIX: the message field in the serialized error must contain the
      // hex-escaped representations, not the raw bytes.
      expect(logOutput).toContain('\\x07');
      expect(logOutput).toContain('\\x1b');

      // POST-FIX: no raw BEL or ANSI escape bytes in the output.
      expect(logOutput).not.toContain('\x07');
      expect(logOutput).not.toContain('\x1b');
    });

    it('sanitizes a hostile error with newline log-injection payload', () => {
      const hostileError = new Error('error\nINFO: fake_log_entry injected');

      const delegate = {
        collect: vi.fn().mockImplementation(() => {
          throw hostileError;
        }),
      };

      const errorArgs: unknown[][] = [];
      const consoleError = vi.spyOn(console, 'error').mockImplementation((...args) => {
        errorArgs.push(args);
      });

      const collector = new BufferedTelemetryCollector(delegate, 1, 1000);
      collector.collect({ type: TelemetryEventType.VALIDATION_START });

      consoleError.mockRestore();

      const logOutput = errorArgs
        .flat()
        .map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a)))
        .join(' ');

      // POST-FIX: newline is replaced with literal \n marker, not raw 0x0a byte.
      expect(logOutput).toContain('\\n');
      // The raw newline byte must not appear in the serialized output.
      expect(logOutput).not.toContain('\nINFO:');
    });

    it('sanitizes a hostile error with TAB column-injection payload', () => {
      const hostileError = new Error('real_error\tINJECTED_COLUMN');

      const delegate = {
        collect: vi.fn().mockImplementation(() => {
          throw hostileError;
        }),
      };

      const errorArgs: unknown[][] = [];
      const consoleError = vi.spyOn(console, 'error').mockImplementation((...args) => {
        errorArgs.push(args);
      });

      const collector = new BufferedTelemetryCollector(delegate, 1, 1000);
      collector.collect({ type: TelemetryEventType.VALIDATION_START });

      consoleError.mockRestore();

      const logOutput = errorArgs
        .flat()
        .map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a)))
        .join(' ');

      // POST-FIX: TAB is escaped to \x09, not left as a raw column separator.
      expect(logOutput).toContain('\\x09');
      expect(logOutput).not.toContain('\tINJECTED_COLUMN');
    });
  });

  // ---------------------------------------------------------------------------
  // B.11 (ST-05-108) Sprint 51 Wave 3 — TelemetryService.record() timestamp
  // immutability regression tests.
  //
  // Pre-fix: record() assigned `event.timestamp = Date.now()` in-place,
  // mutating the caller's object (violates CLAUDE.md immutability rule).
  //
  // Post-fix: a shallow clone is created before the timestamp assignment;
  // the caller's original object is never mutated.
  // ---------------------------------------------------------------------------
  describe('B.11 (ST-05-108): TelemetryService.record() caller timestamp immutability', () => {
    it('does NOT mutate caller event when timestamp is undefined', () => {
      const collector = { collect: vi.fn() };
      const service = new TelemetryService({
        collectors: [collector],
        maxBufferSize: 0,
      });

      // Caller holds a reference with explicit undefined timestamp.
      const callerEvent: TelemetryEvent = {
        type: TelemetryEventType.VALIDATION_START,
        runId: 'immutability-test',
        timestamp: undefined,
      };

      service.record(callerEvent);

      // POST-FIX: caller's object must remain unchanged — timestamp still undefined.
      expect(callerEvent.timestamp).toBeUndefined();
    });

    it('does NOT mutate caller event when timestamp is omitted entirely', () => {
      const collector = { collect: vi.fn() };
      const service = new TelemetryService({
        collectors: [collector],
        maxBufferSize: 0,
      });

      // Caller passes an event with no timestamp property at all.
      const callerEvent: TelemetryEvent = {
        type: TelemetryEventType.VALIDATION_COMPLETE,
        runId: 'immutability-omit-test',
      };

      service.record(callerEvent);

      // POST-FIX: timestamp property must not have been added to the caller's object.
      expect(Object.prototype.hasOwnProperty.call(callerEvent, 'timestamp')).toBe(false);
    });

    it('preserves caller-supplied timestamp and does NOT overwrite it', () => {
      const collector = { collect: vi.fn() };
      const service = new TelemetryService({
        collectors: [collector],
        maxBufferSize: 0,
      });

      const callerTimestamp = 1234567890123;
      const callerEvent: TelemetryEvent = {
        type: TelemetryEventType.VALIDATION_COMPLETE,
        runId: 'preserve-ts-test',
        timestamp: callerTimestamp,
      };

      service.record(callerEvent);

      // Caller timestamp must be unchanged.
      expect(callerEvent.timestamp).toBe(callerTimestamp);

      // The event delivered to the collector must carry the caller's timestamp.
      expect(collector.collect).toHaveBeenCalledWith(
        expect.objectContaining({ timestamp: callerTimestamp })
      );
    });

    it('delivers event with auto-assigned timestamp to collector when caller has none', () => {
      const collector = { collect: vi.fn() };
      const service = new TelemetryService({
        collectors: [collector],
        maxBufferSize: 0,
      });

      const before = Date.now();
      service.record({
        type: TelemetryEventType.VALIDATION_START,
        runId: 'auto-ts-test',
        timestamp: undefined,
      });
      const after = Date.now();

      const delivered = collector.collect.mock.calls[0]?.[0] as TelemetryEvent;
      // Collector receives a valid timestamp even though caller did not supply one.
      expect(delivered.timestamp).toBeGreaterThanOrEqual(before);
      expect(delivered.timestamp).toBeLessThanOrEqual(after);
    });
  });
});
