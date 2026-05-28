/**
 * GenericLogger Unit Tests
 * =========================
 * Comprehensive unit tests for the logger abstraction.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LogLevel, Logger, ConsoleLogger, NullLogger, createLogger } from '../../../src/base/GenericLogger.js';

describe('LogLevel', () => {
  it('should have correct values', () => {
    expect(LogLevel.DEBUG).toBe('debug');
    expect(LogLevel.INFO).toBe('info');
    expect(LogLevel.WARN).toBe('warn');
    expect(LogLevel.ERROR).toBe('error');
  });
});

describe('ConsoleLogger', () => {
  let originalConsoleDebug: Console['debug'];
  let originalConsoleInfo: Console['info'];
  let originalConsoleWarn: Console['warn'];
  let originalConsoleError: Console['error'];
  let mockConsole: {
    debug: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockConsole = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };
    originalConsoleDebug = console.debug;
    originalConsoleInfo = console.info;
    originalConsoleWarn = console.warn;
    originalConsoleError = console.error;
    console.debug = mockConsole.debug;
    console.info = mockConsole.info;
    console.warn = mockConsole.warn;
    console.error = mockConsole.error;
  });

  afterEach(() => {
    console.debug = originalConsoleDebug;
    console.info = originalConsoleInfo;
    console.warn = originalConsoleWarn;
    console.error = originalConsoleError;
    vi.clearAllMocks();
  });

  describe('Constructor', () => {
    it('should use INFO level by default', () => {
      const logger = new ConsoleLogger();
      expect(logger).toBeDefined();
    });

    it('should use custom level', () => {
      const logger = new ConsoleLogger(LogLevel.DEBUG);
      expect(logger).toBeDefined();
    });
  });

  describe('Log Filtering', () => {
    it('should log DEBUG when level is DEBUG', () => {
      const logger = new ConsoleLogger(LogLevel.DEBUG);
      logger.debug('debug message');
      expect(mockConsole.debug).toHaveBeenCalled();
    });

    it('should not log DEBUG when level is INFO', () => {
      const logger = new ConsoleLogger(LogLevel.INFO);
      logger.debug('debug message');
      expect(mockConsole.debug).not.toHaveBeenCalled();
    });

    it('should log INFO when level is INFO', () => {
      const logger = new ConsoleLogger(LogLevel.INFO);
      logger.info('info message');
      expect(mockConsole.info).toHaveBeenCalled();
    });

    it('should log WARN when level is INFO', () => {
      const logger = new ConsoleLogger(LogLevel.INFO);
      logger.warn('warn message');
      expect(mockConsole.warn).toHaveBeenCalled();
    });

    it('should log ERROR when level is INFO', () => {
      const logger = new ConsoleLogger(LogLevel.INFO);
      logger.error('error message');
      expect(mockConsole.error).toHaveBeenCalled();
    });

    it('should not log INFO when level is WARN', () => {
      const logger = new ConsoleLogger(LogLevel.WARN);
      logger.info('info message');
      expect(mockConsole.info).not.toHaveBeenCalled();
    });

    it('should not log WARN when level is ERROR', () => {
      const logger = new ConsoleLogger(LogLevel.ERROR);
      logger.warn('warn message');
      expect(mockConsole.warn).not.toHaveBeenCalled();
    });
  });

  describe('Message Formatting', () => {
    it('should format message without context', () => {
      const logger = new ConsoleLogger(LogLevel.INFO);
      logger.info('test message');
      expect(mockConsole.info).toHaveBeenCalledWith('[INFO] test message');
    });

    it('should format message with context', () => {
      const logger = new ConsoleLogger(LogLevel.INFO);
      logger.info('test message', { key: 'value' });
      expect(mockConsole.info).toHaveBeenCalledWith('[INFO] test message key="value"');
    });

    it('should format message with multiple context values', () => {
      const logger = new ConsoleLogger(LogLevel.INFO);
      logger.info('test', { a: 1, b: 2 });
      expect(mockConsole.info).toHaveBeenCalledWith('[INFO] test a=1 b=2');
    });

    it('should format message with string context', () => {
      const logger = new ConsoleLogger(LogLevel.INFO);
      logger.info('test', { msg: 'hello' });
      expect(mockConsole.info).toHaveBeenCalledWith('[INFO] test msg="hello"');
    });

    it('should format message with object context', () => {
      const logger = new ConsoleLogger(LogLevel.INFO);
      logger.info('test', { obj: { nested: true } });
      expect(mockConsole.info).toHaveBeenCalledWith('[INFO] test obj={"nested":true}');
    });

    it('should format message with array context', () => {
      const logger = new ConsoleLogger(LogLevel.INFO);
      logger.info('test', { items: [1, 2, 3] });
      expect(mockConsole.info).toHaveBeenCalledWith('[INFO] test items=[1,2,3]');
    });

    it('should include DEBUG prefix', () => {
      const logger = new ConsoleLogger(LogLevel.DEBUG);
      logger.debug('test');
      expect(mockConsole.debug).toHaveBeenCalledWith('[DEBUG] test');
    });

    it('should include WARN prefix', () => {
      const logger = new ConsoleLogger(LogLevel.WARN);
      logger.warn('test');
      expect(mockConsole.warn).toHaveBeenCalledWith('[WARN] test');
    });

    it('should include ERROR prefix', () => {
      const logger = new ConsoleLogger(LogLevel.ERROR);
      logger.error('test');
      expect(mockConsole.error).toHaveBeenCalledWith('[ERROR] test');
    });
  });
});

describe('NullLogger', () => {
  it('should not output anything', () => {
    const logger = new NullLogger();
    expect(logger.debug('test')).toBeUndefined();
    expect(logger.info('test')).toBeUndefined();
    expect(logger.warn('test')).toBeUndefined();
    expect(logger.error('test')).toBeUndefined();
  });

  it('should accept context without errors', () => {
    const logger = new NullLogger();
    expect(() => {
      logger.debug('test', { key: 'value' });
      logger.info('test', { key: 'value' });
      logger.warn('test', { key: 'value' });
      logger.error('test', { key: 'value' });
    }).not.toThrow();
  });
});

describe('createLogger', () => {
  it('should create console logger by default', () => {
    const logger = createLogger();
    expect(logger).toBeInstanceOf(ConsoleLogger);
  });

  it('should create console logger with console type', () => {
    const logger = createLogger('console');
    expect(logger).toBeInstanceOf(ConsoleLogger);
  });

  it('should create null logger', () => {
    const logger = createLogger('null');
    expect(logger).toBeInstanceOf(NullLogger);
  });

  it('should create console logger with custom type but no custom logger', () => {
    const logger = createLogger('custom', LogLevel.INFO);
    expect(logger).toBeInstanceOf(ConsoleLogger);
  });

  it('should use custom logger when provided', () => {
    const customLogger: Logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };
    const logger = createLogger('custom', LogLevel.INFO, customLogger);
    expect(logger).toBe(customLogger);
  });

  it('should pass level to console logger', () => {
    const logger = createLogger('console', LogLevel.WARN);
    expect(logger).toBeInstanceOf(ConsoleLogger);
  });

  it('should use default case for unknown type', () => {
    const logger = createLogger('unknown' as any, LogLevel.INFO);
    expect(logger).toBeInstanceOf(ConsoleLogger);
  });
});
