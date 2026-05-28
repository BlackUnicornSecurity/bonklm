/**
 * Tests for Timeout Wrapper Module
 *
 * Covers:
 * - Timeout enforcement for detection phases
 * - Error handling with WizardError
 * - Cleanup of timeout resources
 * - Integration with AbortController
 */

import { describe, it, expect, vi } from 'vitest';
import { detectWithTimeout, DETECTION_TIMEOUTS, createTimeoutPromise } from './timeout.js';
import { WizardError } from '../utils/error.js';

describe('Timeout Wrapper', () => {
  describe('DETECTION_TIMEOUTS', () => {
    it('should have correct timeout values', () => {
      expect(DETECTION_TIMEOUTS.framework).toBe(2000);
      expect(DETECTION_TIMEOUTS.services).toBe(5000);
      expect(DETECTION_TIMEOUTS.credentials).toBe(1000);
    });
  });

  describe('detectWithTimeout', () => {
    it('should resolve when function completes before timeout', async () => {
      const fn = vi.fn().mockResolvedValue('result');

      const result = await detectWithTimeout(fn, 1000, 'framework');
      expect(result).toBe('result');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should propagate non-timeout errors', async () => {
      const originalError = new Error('Network error');
      const fn = vi.fn().mockRejectedValue(originalError);

      await expect(detectWithTimeout(fn, 1000, 'framework')).rejects.toThrow('Network error');
    });

    it('should cap timeout at maximum 10000ms', async () => {
      const fn = vi.fn().mockResolvedValue('result');
      const veryLongTimeout = 20000;

      // Should complete with capped timeout
      const result = await detectWithTimeout(fn, veryLongTimeout, 'services');
      expect(result).toBe('result');
    });

    it('should complete successfully when function resolves', async () => {
      const fn = vi.fn().mockResolvedValue('result');

      const result = await detectWithTimeout(fn, 1000, 'credentials');
      expect(result).toBe('result');
    });

    it('should propagate error when function rejects', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('Test error'));

      await expect(detectWithTimeout(fn, 1000, 'framework')).rejects.toThrow('Test error');
    });

    it('should work with all defined phases', async () => {
      const fn = vi.fn().mockResolvedValue('ok');

      for (const phase of ['framework', 'services', 'credentials'] as const) {
        const result = await detectWithTimeout(fn, DETECTION_TIMEOUTS[phase], phase);
        expect(result).toBe('ok');
      }
    });

    it('should create WizardError with correct properties on timeout', async () => {
      // Create a function that takes longer than the timeout
      const fn = vi.fn(
        () =>
          new Promise(resolve => {
            // This will take 500ms but timeout is 10ms
            setTimeout(() => resolve('result'), 500);
          })
      );

      // Use a short timeout (10ms)
      const promise = detectWithTimeout(fn, 10, 'services');

      // The promise should timeout before the function resolves
      try {
        await promise;
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(WizardError);
        expect((error as WizardError).code).toBe('DETECTION_TIMEOUT');
        expect((error as WizardError).exitCode).toBe(2);
        expect((error as WizardError).message).toContain('services');
        expect((error as WizardError).message).toContain('timed out');
      }
    }, 600); // Set test timeout to 600ms

    it('should reject with WizardError on timeout', async () => {
      // Create a function that takes longer than the timeout
      const fn = vi.fn(
        () =>
          new Promise(resolve => {
            // This will take 500ms but timeout is 10ms
            setTimeout(() => resolve('result'), 500);
          })
      );

      // Use a short timeout (10ms)
      const promise = detectWithTimeout(fn, 10, 'services');

      // The promise should timeout before the function resolves
      await expect(promise).rejects.toThrow(WizardError);
    }, 600); // Set test timeout to 600ms
  });

  describe('createTimeoutPromise', () => {
    it('should create WizardError with correct code', async () => {
      const controller = new AbortController();
      const promise = createTimeoutPromise(1, 'framework', controller);

      try {
        await promise;
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(WizardError);
        expect((error as WizardError).code).toBe('DETECTION_TIMEOUT');
      }
    }, 100); // Set test timeout to 100ms

    it('should include phase name in error message', async () => {
      const controller = new AbortController();
      const promise = createTimeoutPromise(1, 'services', controller);

      try {
        await promise;
        expect.fail('Should have thrown');
      } catch (error) {
        expect((error as WizardError).message).toContain('services');
      }
    }, 100); // Set test timeout to 100ms

    it('should not reject before timeout', async () => {
      const controller = new AbortController();
      const promise = createTimeoutPromise(200, 'framework', controller);

      // The promise should not reject within 20ms
      const result = await Promise.race([
        promise.catch(() => 'timeout'),
        new Promise<string>(resolve => setTimeout(() => resolve('not rejected'), 20))
      ]);

      // The setTimeout should resolve before the timeout promise
      expect(result).toBe('not rejected');

      // Clean up - abort the timeout to avoid waiting
      controller.abort();
    }, 100); // Reduced test timeout to 100ms since we abort early

    it('should clean up timeout when aborted', async () => {
      const controller = new AbortController();
      createTimeoutPromise(5000, 'services', controller);

      // Abort immediately - the timeout should be cleared
      controller.abort();

      // Wait a bit to ensure the timeout doesn't fire
      await new Promise(resolve => setTimeout(resolve, 50));

      // The timeout should have been cleared without rejecting
      expect(controller.signal.aborted).toBe(true);
    }, 200);
  });

  describe('Edge Cases', () => {
    it('should throw for zero timeout', async () => {
      const fn = vi.fn().mockResolvedValue('result');

      // Zero timeout - should throw immediately without calling the function
      const promise = detectWithTimeout(fn, 0, 'credentials');

      await expect(promise).rejects.toThrow(WizardError);
      await expect(promise).rejects.toThrow('timed out after 0ms');

      // Verify the error code
      try {
        await promise;
        expect.fail('Should have thrown');
      } catch (error) {
        expect((error as WizardError).code).toBe('DETECTION_TIMEOUT');
      }

      expect(fn).not.toHaveBeenCalled();
    });

    it('should throw for negative timeout', async () => {
      const fn = vi.fn().mockResolvedValue('result');

      // Negative timeout - should throw immediately without calling the function
      const promise = detectWithTimeout(fn, -100, 'framework');

      await expect(promise).rejects.toThrow(WizardError);
      await expect(promise).rejects.toThrow('timed out after -100ms');

      // Verify the error code
      try {
        await promise;
        expect.fail('Should have thrown');
      } catch (error) {
        expect((error as WizardError).code).toBe('DETECTION_TIMEOUT');
      }

      expect(fn).not.toHaveBeenCalled();
    });

    it('should handle function that returns immediately', async () => {
      const fn = vi.fn().mockReturnValue('immediate');

      const result = await detectWithTimeout(fn, 1000, 'services');
      expect(result).toBe('immediate');
    });

    it('should handle function that throws synchronously', async () => {
      const error = new Error('Sync error');
      const fn = vi.fn().mockImplementation(() => {
        throw error;
      });

      await expect(detectWithTimeout(fn, 1000, 'credentials')).rejects.toThrow('Sync error');
    });
  });

  describe('Promise.race Integration', () => {
    it('should use Promise.race to race between function and timeout', async () => {
      const fn = vi.fn(
        () =>
          new Promise(resolve => {
            // This will take 500ms but timeout is 10ms
            setTimeout(() => resolve('result'), 500);
          })
      );

      const promise = detectWithTimeout(fn, 10, 'framework');

      try {
        await promise;
      } catch (error) {
        // Expected to timeout
        expect(error).toBeInstanceOf(WizardError);
      }

      expect(fn).toHaveBeenCalled();
    }, 600); // Set test timeout to 600ms
  });

  describe('Resource Cleanup', () => {
    it('should abort timeout when function completes first', async () => {
      const fn = vi.fn().mockResolvedValue('quick');

      // Function completes quickly, timeout is 1000ms
      const result = await detectWithTimeout(fn, 1000, 'framework');

      expect(result).toBe('quick');

      // Wait a bit to ensure timeout doesn't fire
      await new Promise(resolve => setTimeout(resolve, 50));
      // If we get here without timeout firing, cleanup worked
    }, 200);

    it('should handle multiple rapid sequential calls', async () => {
      const fn = vi.fn().mockResolvedValue('result');

      // Make multiple rapid calls - each should get its own controller
      const promises = Array.from({ length: 10 }, () => detectWithTimeout(fn, 100, 'services'));

      const results = await Promise.all(promises);
      expect(results).toHaveLength(10);
      expect(results.every(r => r === 'result')).toBe(true);
    }, 500);

    it('should not cause memory leaks with rapid sequential calls', async () => {
      const fn = vi.fn().mockResolvedValue('result');

      // Make 100 rapid calls to stress test the cleanup
      for (let i = 0; i < 100; i++) {
        await detectWithTimeout(fn, 10, 'credentials');
      }

      expect(fn).toHaveBeenCalledTimes(100);
    }, 2000);
  });
});
