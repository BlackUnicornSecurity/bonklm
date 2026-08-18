/**
 * Timeout wrapper for detection operations
 *
 * Provides timeout enforcement for all detection phases to prevent
 * hanging operations and DoS vulnerabilities.
 *
 * @module detection/timeout
 */

import { WizardError } from '../utils/error.js';

/**
 * Detection timeout configuration (in milliseconds)
 *
 * These timeouts prevent any single detection phase from hanging
 * indefinitely, which could block the entire wizard.
 */
export const DETECTION_TIMEOUTS = {
  /** 2s for package.json parsing and framework detection */
  framework: 2000,
  /** 5s for port scanning and Docker container detection */
  services: 5000,
  /** 1s for environment variable reading */
  credentials: 1000
} as const;

/**
 * Detection phase names for error messages
 */
export type DetectionPhase = keyof typeof DETECTION_TIMEOUTS;

/**
 * Wraps an async function with a timeout
 *
 * If the function does not complete within the specified timeout,
 * the timeout promise rejects and the operation is cancelled.
 *
 * Uses AbortController for cooperative cancellation where supported.
 *
 * @param fn - Async function to execute
 * @param timeout - Timeout in milliseconds
 * @param phase - Detection phase name for error messages
 * @returns Result of the function
 * @throws WizardError with code 'DETECTION_TIMEOUT' if timeout expires
 */
export async function detectWithTimeout<T>(fn: () => Promise<T>, timeout: number, phase: DetectionPhase): Promise<T> {
  // Cap maximum timeout to prevent excessive waits
  const maxTimeout = Math.min(timeout, 10000);

  // For zero or negative timeout, reject immediately without calling the function
  if (maxTimeout <= 0) {
    throw new WizardError(
      'DETECTION_TIMEOUT',
      `${phase} detection timed out after ${maxTimeout}ms`,
      'Check for blocking processes or network issues',
      undefined,
      2
    );
  }

  // Create an abort controller for cooperative cancellation
  const controller = new AbortController();

  const timeoutPromise = createTimeoutPromise(maxTimeout, phase, controller);

  try {
    // Race between the function and the timeout
    // The function receives the abort signal for cooperative cancellation
    const fnPromise = fn();
    return await Promise.race([fnPromise, timeoutPromise]);
  } catch (error) {
    // If it's a WizardError from timeout, rethrow it
    if (error instanceof WizardError && error.code === 'DETECTION_TIMEOUT') {
      throw error;
    }
    // Otherwise rethrow the original error
    throw error;
  } finally {
    // Always clean up the timeout if the function wins the race
    controller.abort();
  }
}

/**
 * Creates a timeout promise that rejects after specified milliseconds
 *
 * Utility function for Promise.race() patterns.
 * The timeout is automatically cleared when the abort signal is received.
 *
 * @param ms - Milliseconds to wait before rejecting (must be > 0)
 * @param phase - Detection phase name for error messages
 * @param controller - AbortController to cancel the timeout
 * @returns Promise that rejects after timeout
 */
export function createTimeoutPromise(ms: number, phase: DetectionPhase, controller: AbortController): Promise<never> {
  return new Promise((_, reject) => {
    let timeoutId: NodeJS.Timeout | undefined;

    const onAbort = () => {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
        timeoutId = undefined;
      }
    };

    // Set up the timeout (ms must be > 0)
    timeoutId = setTimeout(() => {
      // Remove the abort listener since we're firing
      controller.signal.removeEventListener('abort', onAbort);
      reject(
        new WizardError(
          'DETECTION_TIMEOUT',
          `${phase} detection timed out after ${ms}ms`,
          'Check for blocking processes or network issues',
          undefined,
          2
        )
      );
    }, ms);

    // Set up cleanup on abort
    controller.signal.addEventListener('abort', onAbort, { once: true });
  });
}
