/**
 * Unit tests for exit handling utilities
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  exit,
  exitWithError,
  exitSuccess,
  registerShutdownHandlers,
  withErrorHandling,
  isExiting,
  type ExitOptions
} from './exit.js';
import { WizardError, ExitCode } from './error.js';

describe('exit', () => {
  // Store original process.exit to restore after tests
  let originalExit: typeof process.exit;

  beforeEach(() => {
    originalExit = process.exit;
    // Mock process.exit to throw instead of actually exiting
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exit = originalExit;
  });

  describe('exit', () => {
    it('should exit with SUCCESS code by default', () => {
      expect(() => exit()).toThrow('process.exit called');
      expect(process.exit).toHaveBeenCalledWith(0);
    });

    it('should exit with ERROR code', () => {
      expect(() => exit('ERROR')).toThrow('process.exit called');
      expect(process.exit).toHaveBeenCalledWith(1);
    });

    it('should exit with PARTIAL code', () => {
      expect(() => exit('PARTIAL')).toThrow('process.exit called');
      expect(process.exit).toHaveBeenCalledWith(2);
    });

    it('should write message to stdout on success', () => {
      const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

      expect(() => exit('SUCCESS', { message: 'Done!' })).toThrow('process.exit called');
      expect(writeSpy).toHaveBeenCalledWith('Done!\n');
      expect(process.exit).toHaveBeenCalledWith(0);

      writeSpy.mockRestore();
    });

    it('should write message to stderr on error', () => {
      const writeSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

      expect(() => exit('ERROR', { message: 'Failed!' })).toThrow('process.exit called');
      expect(writeSpy).toHaveBeenCalledWith('Failed!\n');
      expect(process.exit).toHaveBeenCalledWith(1);

      writeSpy.mockRestore();
    });

    it('should respect useStderr option for success', () => {
      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

      expect(() => exit('SUCCESS', { message: 'Test', useStderr: true })).toThrow('process.exit called');
      expect(stderrSpy).toHaveBeenCalledWith('Test\n');
      expect(stdoutSpy).not.toHaveBeenCalled();

      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
    });
  });

  describe('exitWithError', () => {
    it('should handle WizardError with all properties', () => {
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

      const error = new WizardError('TEST_ERROR', 'Test error message', 'Try again', undefined, 2);

      expect(() => exitWithError(error)).toThrow('process.exit called');
      expect(stderrSpy).toHaveBeenCalledWith('TEST_ERROR: Test error message\nSuggestion: Try again\n');
      expect(process.exit).toHaveBeenCalledWith(2);

      stderrSpy.mockRestore();
    });

    it('should handle WizardError with default exit code', () => {
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

      const error = new WizardError('TEST_ERROR', 'Test error');

      expect(() => exitWithError(error)).toThrow('process.exit called');
      expect(process.exit).toHaveBeenCalledWith(1);

      stderrSpy.mockRestore();
    });

    it('should handle generic Error', () => {
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

      const error = new Error('Generic error');

      expect(() => exitWithError(error)).toThrow('process.exit called');
      expect(stderrSpy).toHaveBeenCalledWith('Error: Generic error\n');
      expect(process.exit).toHaveBeenCalledWith(1);

      stderrSpy.mockRestore();
    });

    it('should handle string errors', () => {
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

      expect(() => exitWithError('String error')).toThrow('process.exit called');
      expect(stderrSpy).toHaveBeenCalledWith('Error: String error\n');
      expect(process.exit).toHaveBeenCalledWith(1);

      stderrSpy.mockRestore();
    });

    it('should handle number errors', () => {
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

      expect(() => exitWithError(404)).toThrow('process.exit called');
      expect(stderrSpy).toHaveBeenCalledWith('Error: 404\n');
      expect(process.exit).toHaveBeenCalledWith(1);

      stderrSpy.mockRestore();
    });

    it('should use default exit code from parameter', () => {
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

      expect(() => exitWithError(new Error('Test'), 'PARTIAL')).toThrow('process.exit called');
      expect(process.exit).toHaveBeenCalledWith(2);

      stderrSpy.mockRestore();
    });

    it('should handle null error', () => {
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

      expect(() => exitWithError(null as unknown as Error)).toThrow('process.exit called');
      expect(stderrSpy).toHaveBeenCalledWith('Error: null\n');

      stderrSpy.mockRestore();
    });

    it('should handle undefined error', () => {
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

      expect(() => exitWithError(undefined as unknown as Error)).toThrow('process.exit called');
      expect(stderrSpy).toHaveBeenCalledWith('Error: undefined\n');

      stderrSpy.mockRestore();
    });
  });

  describe('exitSuccess', () => {
    it('should exit with SUCCESS code', () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called');
      });

      expect(() => exitSuccess()).toThrow('process.exit called');
      expect(process.exit).toHaveBeenCalledWith(0);
    });

    it('should write message to stdout', () => {
      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

      expect(() => exitSuccess('All done!')).toThrow('process.exit called');
      expect(stdoutSpy).toHaveBeenCalledWith('All done!\n');
      expect(process.exit).toHaveBeenCalledWith(0);

      stdoutSpy.mockRestore();
    });
  });

  describe('registerShutdownHandlers', () => {
    it('should register signal handlers', () => {
      const onSpy = vi.spyOn(process, 'on');

      const unregister = registerShutdownHandlers();

      expect(onSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function));
      expect(onSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
      expect(onSpy).toHaveBeenCalledWith('SIGHUP', expect.any(Function));

      onSpy.mockRestore();
      unregister();
    });

    it('should return unregister function', () => {
      const onSpy = vi.spyOn(process, 'on');
      const offSpy = vi.spyOn(process, 'off');

      const unregister = registerShutdownHandlers();

      expect(typeof unregister).toBe('function');

      unregister();

      expect(offSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function));
      expect(offSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
      expect(offSpy).toHaveBeenCalledWith('SIGHUP', expect.any(Function));

      onSpy.mockRestore();
      offSpy.mockRestore();
    });

    it('should call cleanup function on signal', async () => {
      const cleanupFn = vi.fn();
      let signalHandler: ((...args: unknown[]) => unknown) | undefined;

      vi.spyOn(process, 'on').mockImplementation((event, listener) => {
        if (event === 'SIGINT') {
          signalHandler = listener as (...args: unknown[]) => unknown;
        }
        return process;
      });

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called');
      });

      registerShutdownHandlers(cleanupFn);

      expect(signalHandler).toBeDefined();

      // Simulate signal - the handler is async
      if (signalHandler) {
        await expect(signalHandler()).rejects.toThrow('process.exit called');
      }

      expect(cleanupFn).toHaveBeenCalled();

      exitSpy.mockRestore();
      vi.restoreAllMocks();
    });

    it('should handle cleanup function errors gracefully', async () => {
      const cleanupFn = vi.fn().mockRejectedValue(new Error('Cleanup failed'));
      let signalHandler: ((...args: unknown[]) => unknown) | undefined;

      vi.spyOn(process, 'on').mockImplementation((event, listener) => {
        if (event === 'SIGINT') {
          signalHandler = listener as (...args: unknown[]) => unknown;
        }
        return process;
      });

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called');
      });

      registerShutdownHandlers(cleanupFn);

      if (signalHandler) {
        // Should still exit even though cleanup fails
        await expect(signalHandler()).rejects.toThrow('process.exit called');
      }

      expect(cleanupFn).toHaveBeenCalled();

      exitSpy.mockRestore();
      vi.restoreAllMocks();
    });

    it('should work without cleanup function', async () => {
      let signalHandler: ((...args: unknown[]) => unknown) | undefined;

      vi.spyOn(process, 'on').mockImplementation((event, listener) => {
        if (event === 'SIGINT') {
          signalHandler = listener as (...args: unknown[]) => unknown;
        }
        return process;
      });

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called');
      });

      registerShutdownHandlers();

      if (signalHandler) {
        await expect(signalHandler()).rejects.toThrow('process.exit called');
      }

      expect(exitSpy).toHaveBeenCalledWith(0);

      exitSpy.mockRestore();
      vi.restoreAllMocks();
    });
  });

  describe('withErrorHandling', () => {
    it('should wrap async function and handle errors', async () => {
      const fn = vi.fn().mockResolvedValue(undefined);
      const wrapped = withErrorHandling(fn);

      // Should not throw when function succeeds
      await wrapped();
      expect(fn).toHaveBeenCalled();
      expect(process.exit).not.toHaveBeenCalled();
    });

    it('should exit with error when function throws', async () => {
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

      const fn = vi.fn().mockRejectedValue(new Error('Function failed'));
      const wrapped = withErrorHandling(fn);

      await expect(wrapped()).rejects.toThrow('process.exit called');
      expect(process.exit).toHaveBeenCalledWith(1);

      stderrSpy.mockRestore();
    });

    it('should show error message when configured', async () => {
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

      const fn = vi.fn().mockRejectedValue(new Error('Function failed'));
      const wrapped = withErrorHandling(fn, {
        errorMessage: 'Operation failed'
      });

      await expect(wrapped()).rejects.toThrow('process.exit called');
      expect(stderrSpy).toHaveBeenCalledWith('Operation failed\n');

      stderrSpy.mockRestore();
    });

    it('should show success message when configured', async () => {
      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

      const fn = vi.fn().mockResolvedValue(undefined);
      const wrapped = withErrorHandling(fn, {
        successMessage: 'Operation succeeded'
      });

      // Should not throw or call exit when function succeeds
      await wrapped();
      expect(stdoutSpy).toHaveBeenCalledWith('Operation succeeded\n');
      expect(process.exit).not.toHaveBeenCalled();

      stdoutSpy.mockRestore();
    });

    it('should pass arguments to wrapped function', async () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called');
      });

      const fn = vi.fn().mockResolvedValue(undefined);
      const wrapped = withErrorHandling(fn);

      // Should not throw or call exit when function succeeds
      await wrapped('arg1', 'arg2', 42);

      expect(fn).toHaveBeenCalledWith('arg1', 'arg2', 42);
      expect(process.exit).not.toHaveBeenCalled();
    });
  });

  describe('isExiting', () => {
    it('should return boolean indicating if process is exiting', () => {
      // In normal test environment, should be false
      expect(typeof isExiting()).toBe('boolean');
    });
  });

  describe('ExitOptions type', () => {
    it('should accept valid options', () => {
      const options: ExitOptions = {
        message: 'Test message',
        useStderr: true
      };

      expect(options.message).toBe('Test message');
      expect(options.useStderr).toBe(true);
    });

    it('should accept undefined options', () => {
      const options: ExitOptions | undefined = undefined;

      expect(options).toBeUndefined();
    });
  });

  describe('integration with WizardError', () => {
    it('should integrate with WizardError exit codes', () => {
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

      const error = new WizardError('TEST_CODE', 'Test message', 'Test suggestion', undefined, ExitCode.PARTIAL);

      expect(() => exitWithError(error)).toThrow('process.exit called');
      expect(process.exit).toHaveBeenCalledWith(2);

      stderrSpy.mockRestore();
    });
  });

  describe('ExitCode constants', () => {
    it('should have correct exit code values', () => {
      expect(ExitCode.SUCCESS).toBe(0);
      expect(ExitCode.ERROR).toBe(1);
      expect(ExitCode.PARTIAL).toBe(2);
    });
  });
});
