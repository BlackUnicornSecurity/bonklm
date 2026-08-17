/**
 * Progress Indicators Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withSpinner, createProgressBar, withTimeout, createStepTracker, runTaskGroup } from './progress.js';

describe('progress utilities', () => {
  describe('withSpinner', () => {
    it('should execute function and return result', async () => {
      const fn = vi.fn(async () => 'result');
      const result = await withSpinner('Test message', fn);

      expect(result).toBe('result');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should handle errors from function', async () => {
      const fn = vi.fn(async () => {
        throw new Error('Test error');
      });

      await expect(withSpinner('Test message', fn)).rejects.toThrow('Test error');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should pass arguments to function correctly', async () => {
      let receivedArg: string | undefined;

      const fn = vi.fn(async (arg: string) => {
        receivedArg = arg;
        return `processed: ${arg}`;
      });

      // Note: withSpinner doesn't pass args, so we test the wrapper behavior
      await withSpinner('Test', () => fn('input'));

      expect(receivedArg).toBe('input');
    });
  });

  describe('createProgressBar', () => {
    it('should create progress bar with total steps', () => {
      const progress = createProgressBar(100);

      expect(progress).toBeDefined();
      expect(typeof progress.update).toBe('function');
      expect(typeof progress.complete).toBe('function');
    });

    it('should update progress value', () => {
      const progress = createProgressBar(100);

      // Should not throw
      progress.update(50);
      progress.update(75);
    });

    it('should complete progress', () => {
      const progress = createProgressBar(100);

      progress.update(100);

      // Should not throw
      progress.complete();
    });

    it('should handle zero total', () => {
      const progress = createProgressBar(0);

      progress.update(0);
      progress.complete();
    });
  });

  describe('withTimeout', () => {
    it('should return result when function completes', async () => {
      const fn = vi.fn(async () => 'result');
      const result = await withTimeout('Test message', fn, 5000);

      expect(result).toBe('result');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should timeout when function takes too long', async () => {
      const fn = vi.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 10000));
        return 'result';
      });

      await expect(withTimeout('Test', fn, 100)).rejects.toThrow('timed out');
    });

    it('should propagate function errors', async () => {
      const fn = vi.fn(async () => {
        throw new Error('Function error');
      });

      await expect(withTimeout('Test', fn, 5000)).rejects.toThrow('Function error');
    });

    it('should not timeout if function completes quickly', async () => {
      const fn = vi.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return 'result';
      });

      const result = await withTimeout('Test', fn, 1000);
      expect(result).toBe('result');
    });
  });

  describe('createStepTracker', () => {
    it('should create step tracker', () => {
      const tracker = createStepTracker(['Step 1', 'Step 2', 'Step 3']);

      expect(tracker).toBeDefined();
      expect(typeof tracker.run).toBe('function');
      expect(typeof tracker.complete).toBe('function');
    });

    it('should run steps sequentially', async () => {
      const tracker = createStepTracker(['Step 1', 'Step 2']);
      const results: string[] = [];

      await tracker.run('Step 1', async () => {
        results.push('step1');
        return 'a';
      });

      await tracker.run('Step 2', async () => {
        results.push('step2');
        return 'b';
      });

      expect(results).toEqual(['step1', 'step2']);
    });

    it('should complete all steps', async () => {
      const tracker = createStepTracker(['Step 1', 'Step 2']);

      await tracker.run('Step 1', async () => 'a');
      await tracker.run('Step 2', async () => 'b');

      // Should not throw
      tracker.complete();
    });

    it('should handle empty steps', async () => {
      const tracker = createStepTracker([]);
      tracker.complete();
    });

    it('should propagate step errors', async () => {
      const tracker = createStepTracker(['Step 1']);

      await expect(
        tracker.run('Step 1', async () => {
          throw new Error('Step failed');
        })
      ).rejects.toThrow('Step failed');
    });
  });

  describe('runTaskGroup', () => {
    it('should run all tasks successfully', async () => {
      const tasks = [
        { name: 'Task 1', fn: vi.fn(async () => 'result1') },
        { name: 'Task 2', fn: vi.fn(async () => 'result2') },
        { name: 'Task 3', fn: vi.fn(async () => 'result3') }
      ];

      const results = await runTaskGroup(tasks);

      expect(results).toHaveLength(3);
      expect(results[0].status).toBe('success');
      expect(results[0].result).toBe('result1');
      expect(results[1].status).toBe('success');
      expect(results[1].result).toBe('result2');
      expect(results[2].status).toBe('success');
      expect(results[2].result).toBe('result3');
    });

    it('should handle mixed success and error', async () => {
      const tasks = [
        { name: 'Task 1', fn: vi.fn(async () => 'result1') },
        {
          name: 'Task 2',
          fn: vi.fn(async () => {
            throw new Error('Failed');
          })
        },
        { name: 'Task 3', fn: vi.fn(async () => 'result3') }
      ];

      const results = await runTaskGroup(tasks);

      expect(results).toHaveLength(3);
      expect(results[0].status).toBe('success');
      expect(results[0].result).toBe('result1');
      expect(results[1].status).toBe('error');
      expect(results[1].error).toBe('Failed');
      expect(results[2].status).toBe('success');
      expect(results[2].result).toBe('result3');
    });

    it('should handle empty task array', async () => {
      const results = await runTaskGroup([]);
      expect(results).toEqual([]);
    });

    it('should handle all tasks failing', async () => {
      const tasks = [
        {
          name: 'Task 1',
          fn: vi.fn(async () => {
            throw new Error('Error 1');
          })
        },
        {
          name: 'Task 2',
          fn: vi.fn(async () => {
            throw new Error('Error 2');
          })
        }
      ];

      const results = await runTaskGroup(tasks);

      expect(results).toHaveLength(2);
      expect(results[0].status).toBe('error');
      expect(results[0].error).toBe('Error 1');
      expect(results[1].status).toBe('error');
      expect(results[1].error).toBe('Error 2');
    });
  });
});
