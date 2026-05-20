/**
 * Exit handling utilities for the BonkLM Installation Wizard
 *
 * This module provides utilities for graceful process termination with
 * proper cleanup and logging.
 */

import { ExitCode, type ExitCodeType, WizardError } from './error.js';

/**
 * Exit handler options
 */
export interface ExitOptions {
  /** Message to display before exiting */
  message?: string;
  /** Whether to log to stderr (default: true for errors, false for success) */
  useStderr?: boolean;
}

/**
 * Logging function that writes to the appropriate stream
 */
function log(message: string, useStderr = false): void {
  const stream = useStderr ? process.stderr : process.stdout;
  stream.write(`${message  }\n`);
}

/**
 * Exits the process with the specified exit code
 *
 * This is the primary exit function that should be used for all
 * programmatic exits. It ensures consistent behavior across the CLI.
 *
 * @param code - Exit code key (SUCCESS, ERROR, or PARTIAL)
 * @param options - Optional exit options
 * @returns Never returns (always exits)
 */
export function exit(
  code: ExitCodeType = 'SUCCESS',
  options?: ExitOptions
): never {
  const exitCodeValue = ExitCode[code];

  if (options?.message) {
    // Explicit useStderr=true overrides default behavior
    // Default: errors to stderr, success to stdout
    let useStderr = code !== 'SUCCESS';
    if (options.useStderr !== undefined) {
      useStderr = options.useStderr;
    }
    log(options.message, useStderr);
  }

  process.exit(exitCodeValue);
}

/**
 * Converts exit code value to ExitCodeType
 */
function exitCodeValueToType(code: 0 | 1 | 2): ExitCodeType {
  if (code === 0) return 'SUCCESS';
  if (code === 2) return 'PARTIAL';
  return 'ERROR';
}

/**
 * Exits with an error, using WizardError information if available
 *
 * This function handles both WizardError instances and generic errors,
 * providing appropriate output formatting and exit codes.
 *
 * @param error - The error that caused the exit
 * @param defaultExitCode - Default exit code if not specified in error
 * @returns Never returns (always exits)
 */
export function exitWithError(
  error: unknown,
  defaultExitCode: ExitCodeType = 'ERROR'
): never {
  if (error instanceof WizardError) {
    // Use the WizardError's formatted output
    log(error.toString(), true);
    const exitCode = error.exitCode !== undefined
      ? exitCodeValueToType(error.exitCode)
      : defaultExitCode;
    exit(exitCode);
  }

  if (error instanceof Error) {
    log(`Error: ${error.message}`, true);
    exit(defaultExitCode);
  }

  // Handle non-Error errors (strings, numbers, etc.)
  const errorMessage = String(error);
  log(`Error: ${errorMessage}`, true);
  exit(defaultExitCode);
}

/**
 * Exits successfully with an optional message
 *
 * Convenience function for successful exits.
 *
 * @param message - Optional success message
 * @returns Never returns (always exits)
 */
export function exitSuccess(message?: string): never {
  if (message) {
    log(message, false);
  }
  exit('SUCCESS');
}

/**
 * Graceful shutdown handler
 *
 * Registers cleanup handlers for common termination signals.
 * Returns a cleanup function that should be called with any cleanup logic.
 *
 * @example
 * ```ts
 * const cleanup = registerShutdownHandlers();
 *
 * process.on('cleanup', async () => {
 *   await cleanup();
 * });
 * ```
 */
export function registerShutdownHandlers(
  cleanupFn?: () => void | Promise<void>
): () => void {
  const handlers = [
    'SIGINT',   // Ctrl+C
    'SIGTERM',  // kill command
    'SIGHUP',   // Terminal closed
  ];

  const handler = async () => {
    // Prevent default behavior (immediate exit)
    // Allow cleanup to run
    if (cleanupFn) {
      try {
        await cleanupFn();
      } catch {
        // Ignore cleanup errors
      }
    }
    process.exit(0);
  };

  for (const signal of handlers) {
    process.on(signal as NodeJS.Signals, handler);
  }

  // Return unregister function
  return () => {
    for (const signal of handlers) {
      process.off(signal as NodeJS.Signals, handler);
    }
  };
}

/**
 * Wraps an async function with error handling that exits on failure
 *
 * This is useful for CLI command handlers that need to handle errors
 * consistently.
 *
 * @param fn - Async function to wrap
 * @param options - Optional exit options
 * @returns Wrapped function that exits on error
 */
export function withErrorHandling<TArgs extends unknown[]>(
  fn: (...args: TArgs) => Promise<void>,
  options?: {
    errorMessage?: string;
    successMessage?: string;
  }
): (...args: TArgs) => Promise<void> {
  return async (...args: TArgs) => {
    try {
      await fn(...args);
      if (options?.successMessage) {
        log(options.successMessage, false);
      }
    } catch (error) {
      if (options?.errorMessage) {
        log(options.errorMessage, true);
      }
      exitWithError(error);
    }
  };
}

/**
 * Checks if the process is exiting
 *
 * Useful for preventing operations during shutdown.
 */
export function isExiting(): boolean {
  // @ts-expect-error - process.exiting is not in the type definition
  return process.exiting || false;
}
