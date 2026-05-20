/**
 * Progress Indicators
 *
 * This module provides utilities for displaying progress during
 * long-running operations in the wizard.
 *
 * Features:
 * - Spinner wrapper for async operations
 * - Progress bars for multi-step operations
 * - TTY capability detection for graceful fallback
 *
 * @module utils/progress
 */

import * as p from '@clack/prompts';
import { getTerminalCapabilities } from './terminal.js';

/**
 * Wraps an async operation with a spinner
 *
 * In TTY environments, shows an animated spinner.
 * In non-TTY environments, logs a simple message.
 *
 * @param message - The message to display
 * @param fn - The async function to execute
 * @returns Promise resolving to the function's result
 *
 * @example
 * ```ts
 * const result = await withSpinner('Loading data...', async () => {
 *   return await fetchData();
 * });
 * ```
 */
export async function withSpinner<T>(
  message: string,
  fn: () => Promise<T>
): Promise<T> {
  const { isTTY } = getTerminalCapabilities();

  if (!isTTY) {
    // Non-TTY fallback: simple logging
    console.log(message);
    const result = await fn();
    console.log(`${message} ✓`);
    return result;
  }

  // Use Clack spinner for TTY environments
  const spin = p.spinner();
  spin.start(message);

  const startTime = Date.now();

  try {
    const result = await fn();
    const duration = Date.now() - startTime;
    spin.stop(`${message} ✓ (${duration}ms)`);
    return result;
  } catch (error) {
    spin.stop(`${message} ✗`);
    throw error;
  }
}

/**
 * Creates a progress bar for multi-step operations
 *
 * @param total - Total number of steps
 * @returns Object with update method
 *
 * @example
 * ```ts
 * const progress = createProgressBar(100);
 * for (let i = 0; i < 100; i++) {
 *   await doWork();
 *   progress.update(i + 1);
 * }
 * progress.complete();
 * ```
 */
export function createProgressBar(total: number) {
  const { isTTY } = getTerminalCapabilities();
  let current = 0;
  const startTime = Date.now();

  if (!isTTY) {
    // Non-TTY fallback
    return {
      update: (value: number) => {
        current = value;
        const percent = Math.round((value / total) * 100);
        console.log(`Progress: ${value}/${total} (${percent}%)`);
      },
      complete: () => {
        const duration = Date.now() - startTime;
        console.log(`Complete: ${total}/${total} (${duration}ms)`);
      },
    };
  }

  // TTY: Use Clack spinner with text-based progress
  const spin = p.spinner();
  const message = () => `Processing... ${current}/${total}`;

  return {
    update: (value: number) => {
      current = value;
      const percent = Math.round((value / total) * 100);
      spin.message(`${message()} (${percent}%)`);
    },
    complete: () => {
      const duration = Date.now() - startTime;
      spin.stop(`Complete! ${total}/${total} (${duration}ms)`);
    },
  };
}

/**
 * Runs an operation with a timeout and progress display
 *
 * @param message - Message to display
 * @param fn - Async function to execute
 * @param timeout - Timeout in milliseconds
 * @returns Promise resolving to the result
 * @throws Error if timeout is exceeded
 *
 * @example
 * ```ts
 * const result = await withTimeout(
 *   'Connecting to API...',
 *   () => fetch('https://api.example.com'),
 *   5000
 * );
 * ```
 */
export async function withTimeout<T>(
  message: string,
  fn: () => Promise<T>,
  timeout: number
): Promise<T> {
  const { isTTY } = getTerminalCapabilities();

  if (!isTTY) {
    console.log(`${message} (timeout: ${timeout}ms)`);
    return Promise.race([
      fn(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Operation timed out')), timeout)
      ),
    ]);
  }

  const spin = p.spinner();
  spin.start(message);

  try {
    const result = await Promise.race([
      fn(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Operation timed out')), timeout)
      ),
    ]);
    spin.stop(`${message} ✓`);
    return result;
  } catch (error) {
    spin.stop(`${message} ✗`);
    throw error;
  }
}

/**
 * Creates a multi-step progress tracker
 *
 * @param steps - Array of step names
 * @returns Object with methods to track progress
 *
 * @example
 * ```ts
 * const tracker = createStepTracker(['Step 1', 'Step 2', 'Step 3']);
 * await tracker.run('Step 1', async () => { ... });
 * await tracker.run('Step 2', async () => { ... });
 * tracker.complete();
 * ```
 */
export function createStepTracker(steps: string[]) {
  const { isTTY } = getTerminalCapabilities();
  let completed = 0;
  const total = steps.length;
  const startTime = Date.now();

  if (!isTTY) {
    return {
      run: async (step: string, fn: () => Promise<unknown>) => {
        console.log(`[${completed + 1}/${total}] ${step}`);
        const result = await fn();
        completed++;
        return result;
      },
      complete: () => {
        const duration = Date.now() - startTime;
        console.log(`All steps complete (${total}/${total}) in ${duration}ms`);
      },
    };
  }

  const spin = p.spinner();

  return {
    run: async (step: string, fn: () => Promise<unknown>) => {
      spin.start(`[${completed + 1}/${total}] ${step}`);
      const result = await fn();
      completed++;
      const percent = Math.round((completed / total) * 100);
      spin.stop(`[${completed}/${total}] ${step} (${percent}%)`);
      return result;
    },
    complete: () => {
      const duration = Date.now() - startTime;
      console.log(`All steps complete (${total}/${total}) in ${duration}ms`);
    },
  };
}

/**
 * Displays a group of tasks with individual status
 *
 * @param tasks - Array of {name, fn} tuples
 * @returns Array of results with status
 *
 * @example
 * ```ts
 * const results = await runTaskGroup([
 *   { name: 'Task 1', fn: async () => 'result1' },
 *   { name: 'Task 2', fn: async () => 'result2' },
 * ]);
 * ```
 */
export async function runTaskGroup<T>(
  tasks: Array<{ name: string; fn: () => Promise<T> }>
): Promise<Array<{ name: string; status: 'success' | 'error'; result?: T; error?: string }>> {
  const results: Array<{ name: string; status: 'success' | 'error'; result?: T; error?: string }> = [];
  const { isTTY } = getTerminalCapabilities();

  for (const task of tasks) {
    if (!isTTY) {
      console.log(`Running: ${task.name}...`);
    }

    const spin = isTTY ? p.spinner() : null;

    if (spin) {
      spin.start(task.name);
    }

    try {
      const result = await task.fn();
      results.push({ name: task.name, status: 'success', result });
      if (spin) {
        spin.stop(`${task.name} ✓`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      results.push({ name: task.name, status: 'error', error: message });
      if (spin) {
        spin.stop(`${task.name} ✗`);
      }
    }
  }

  return results;
}
