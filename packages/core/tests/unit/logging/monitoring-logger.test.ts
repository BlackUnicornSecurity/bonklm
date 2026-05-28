/**
 * MonitoringLogger Unit Tests
 * ============================
 * Comprehensive unit tests for the monitoring logger.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  MonitoringLogger,
  MonitoringLogLevel,
  createMonitoringLogger,
  type MonitoringLoggerOptions,
  type LogEntry
} from '../../../src/logging/MonitoringLogger.js';

describe('MonitoringLogger', () => {
  let originalConsoleDebug: Console['debug'];
  let mockConsole: { debug: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockConsole = { debug: vi.fn() };
    originalConsoleDebug = console.debug;
    console.debug = mockConsole.debug as any;
  });

  afterEach(() => {
    console.debug = originalConsoleDebug;
    vi.clearAllMocks();
  });

  describe('Constructor', () => {
    it('should use default options', () => {
      const logger = new MonitoringLogger();
      expect(logger).toBeDefined();
    });

    it('should use custom options', () => {
      const options: MonitoringLoggerOptions = {
        level: MonitoringLogLevel.WARN,
        json: true,
        metrics: true,
        audit: true,
        prefix: '[TEST]'
      };
      const logger = new MonitoringLogger(options);
      expect(logger).toBeDefined();
    });

    it('should use custom logger', () => {
      const customLogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      const logger = new MonitoringLogger({ logger: customLogger as any, level: MonitoringLogLevel.INFO });
      logger.info('test');
      // The MonitoringLogger always calls debug on the base logger
      expect(customLogger.debug).toHaveBeenCalled();
    });
  });

  describe('Log Levels', () => {
    it('should log debug when level is DEBUG', () => {
      const logger = new MonitoringLogger({ level: MonitoringLogLevel.DEBUG });
      logger.debug('debug message');
      expect(mockConsole.debug).toHaveBeenCalled();
    });

    it('should not log debug when level is INFO', () => {
      const logger = new MonitoringLogger({ level: MonitoringLogLevel.INFO });
      logger.debug('debug message');
      expect(mockConsole.debug).not.toHaveBeenCalled();
    });

    it('should log info when level is INFO', () => {
      const logger = new MonitoringLogger({ level: MonitoringLogLevel.INFO });
      logger.info('info message');
      expect(mockConsole.debug).toHaveBeenCalled();
    });

    it('should log warn when level is WARN', () => {
      const logger = new MonitoringLogger({ level: MonitoringLogLevel.WARN });
      logger.warn('warn message');
      expect(mockConsole.debug).toHaveBeenCalled();
    });

    it('should log error when level is ERROR', () => {
      const logger = new MonitoringLogger({ level: MonitoringLogLevel.ERROR });
      logger.error('error message');
      expect(mockConsole.debug).toHaveBeenCalled();
    });

    it('should not log lower levels', () => {
      const logger = new MonitoringLogger({ level: MonitoringLogLevel.ERROR });
      logger.info('info message');
      logger.warn('warn message');
      expect(mockConsole.debug).not.toHaveBeenCalled();
    });
  });

  describe('Log Formatting', () => {
    it('should add prefix to messages', () => {
      const logger = new MonitoringLogger({
        level: MonitoringLogLevel.INFO,
        prefix: '[PREFIX]'
      });
      logger.info('test message');
      expect(mockConsole.debug).toHaveBeenCalledWith(expect.stringContaining('[PREFIX]'));
    });

    it('should format JSON logs', () => {
      const logger = new MonitoringLogger({
        level: MonitoringLogLevel.INFO,
        json: true
      });
      logger.info('test message', { count: 42 });
      const callArgs = mockConsole.debug.mock.calls[0];
      const logged = JSON.parse(callArgs[0]);
      expect(logged.message).toContain('test message');
      expect(logged.context).toEqual({ count: 42 });
    });

    it('should format text logs', () => {
      const logger = new MonitoringLogger({
        level: MonitoringLogLevel.INFO,
        json: false
      });
      logger.info('test message');
      expect(mockConsole.debug).toHaveBeenCalledWith(expect.stringContaining('[INFO]'));
      expect(mockConsole.debug).toHaveBeenCalledWith(expect.stringContaining('test message'));
    });

    it('should include context in text logs', () => {
      const logger = new MonitoringLogger({
        level: MonitoringLogLevel.INFO,
        json: false
      });
      logger.info('test message', { count: 42 });
      expect(mockConsole.debug).toHaveBeenCalledWith(expect.stringContaining('{"count":42}'));
    });
  });

  describe('Error Handling', () => {
    it('should extract error details with sanitization (S011-003)', () => {
      const logger = new MonitoringLogger({
        level: MonitoringLogLevel.INFO,
        json: true
      });
      const error = new Error('Test error');
      error.stack = 'Error: Test error\n    at test.js:1:1';
      logger.info('message', { error });

      const callArgs = mockConsole.debug.mock.calls[0];
      const logged = JSON.parse(callArgs[0]);
      expect(logged.error).toBeDefined();
      expect(logged.error.name).toBe('Error');
      expect(logged.error.message).toBe('Test error');
      // Stack trace should be sanitized (file paths replaced)
      expect(logged.error.stack).toBeDefined();
      expect(logged.error.stack).not.toContain('test.js:1:1');
      expect(logged.error.stack).toContain('[FILE]:[LINE]');
    });

    it('should extract error code', () => {
      const logger = new MonitoringLogger({
        level: MonitoringLogLevel.INFO,
        json: true
      });
      const error = new Error('Test error') as any;
      error.code = 'ENOENT';
      logger.info('message', { error });

      const callArgs = mockConsole.debug.mock.calls[0];
      const logged = JSON.parse(callArgs[0]);
      expect(logged.error.code).toBe('ENOENT');
    });

    it('should remove error from context when extracted', () => {
      const logger = new MonitoringLogger({
        level: MonitoringLogLevel.INFO,
        json: true
      });
      const error = new Error('Test error');
      logger.info('message', { error, other: 'value' });

      const callArgs = mockConsole.debug.mock.calls[0];
      const logged = JSON.parse(callArgs[0]);
      expect(logged.context?.error).toBeUndefined();
      expect(logged.context?.other).toBe('value');
    });
  });

  describe('Metadata', () => {
    it('should extract metadata from context', () => {
      const logger = new MonitoringLogger({
        level: MonitoringLogLevel.INFO,
        json: true
      });
      const metadata = { runId: '123', operation: 'test' };
      logger.info('message', { metadata });

      const callArgs = mockConsole.debug.mock.calls[0];
      const logged = JSON.parse(callArgs[0]);
      expect(logged.metadata).toEqual(metadata);
    });
  });

  describe('Metrics', () => {
    it('should not collect metrics when disabled', () => {
      const logger = new MonitoringLogger({ metrics: false });
      logger.incrementCounter('test');
      const metrics = logger.getMetrics();
      expect(metrics.counters.test).toBeUndefined();
    });

    it('should increment counter', () => {
      const logger = new MonitoringLogger({ metrics: true });
      logger.incrementCounter('requests');
      expect(logger.getMetrics().counters.requests).toBe(1);
      logger.incrementCounter('requests', 5);
      expect(logger.getMetrics().counters.requests).toBe(6);
    });

    it('should set gauge', () => {
      const logger = new MonitoringLogger({ metrics: true });
      logger.setGauge('temperature', 98.6);
      expect(logger.getMetrics().gauges.temperature).toBe(98.6);
      logger.setGauge('temperature', 100);
      expect(logger.getMetrics().gauges.temperature).toBe(100);
    });

    it('should record histogram', () => {
      const logger = new MonitoringLogger({ metrics: true });
      logger.recordHistogram('latency', 100);
      logger.recordHistogram('latency', 200);
      logger.recordHistogram('latency', 150);

      const histogram = logger.getMetrics().histograms.latency;
      expect(histogram).toEqual([100, 200, 150]);
    });

    it('should limit histogram size to 1000', () => {
      const logger = new MonitoringLogger({ metrics: true });
      for (let i = 0; i < 1100; i++) {
        logger.recordHistogram('test', i);
      }
      const histogram = logger.getMetrics().histograms.test;
      expect(histogram.length).toBe(1000);
    });

    it('should record timestamp', () => {
      const logger = new MonitoringLogger({ metrics: true });
      const ts = Date.now();
      logger.recordTimestamp('start', ts);
      expect(logger.getMetrics().timestamps.start).toBe(ts);
    });

    it('should use current time when timestamp not provided', () => {
      const logger = new MonitoringLogger({ metrics: true });
      const before = Date.now();
      logger.recordTimestamp('now');
      const after = Date.now();
      const ts = logger.getMetrics().timestamps.now;
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(after);
    });

    it('should return copy of metrics', () => {
      const logger = new MonitoringLogger({ metrics: true });
      logger.incrementCounter('test');
      const metrics1 = logger.getMetrics();
      const metrics2 = logger.getMetrics();
      expect(metrics1).not.toBe(metrics2);
      expect(metrics1.counters).not.toBe(metrics2.counters);
    });

    it('should return copy of histogram arrays', () => {
      const logger = new MonitoringLogger({ metrics: true });
      logger.recordHistogram('test', 1);
      const metrics1 = logger.getMetrics();
      const metrics2 = logger.getMetrics();
      expect(metrics1.histograms.test).not.toBe(metrics2.histograms.test);
      expect(metrics1.histograms.test).toEqual(metrics2.histograms.test);
    });

    it('should reset metrics', () => {
      const logger = new MonitoringLogger({ metrics: true });
      logger.incrementCounter('test');
      logger.setGauge('value', 10);
      logger.recordHistogram('hist', 5);
      logger.recordTimestamp('ts');

      logger.resetMetrics();

      const metrics = logger.getMetrics();
      expect(metrics.counters).toEqual({});
      expect(metrics.gauges).toEqual({});
      expect(metrics.histograms).toEqual({});
      expect(metrics.timestamps).toEqual({});
    });
  });

  describe('Audit Log', () => {
    it('should not add to audit log when disabled', () => {
      const logger = new MonitoringLogger({ audit: false, level: MonitoringLogLevel.WARN });
      logger.warn('warning');
      expect(logger.getAuditLog()).toHaveLength(0);
    });

    it('should add WARN entries to audit log', () => {
      const logger = new MonitoringLogger({ audit: true, level: MonitoringLogLevel.WARN });
      logger.warn('warning message');
      const auditLog = logger.getAuditLog();
      expect(auditLog).toHaveLength(1);
      expect(auditLog[0].message).toBe('warning message');
      expect(auditLog[0].level).toBe(MonitoringLogLevel.WARN);
    });

    it('should add ERROR entries to audit log', () => {
      const logger = new MonitoringLogger({ audit: true, level: MonitoringLogLevel.ERROR });
      logger.error('error message');
      const auditLog = logger.getAuditLog();
      expect(auditLog).toHaveLength(1);
      expect(auditLog[0].message).toBe('error message');
      expect(auditLog[0].level).toBe(MonitoringLogLevel.ERROR);
    });

    it('should not add INFO entries to audit log', () => {
      const logger = new MonitoringLogger({ audit: true, level: MonitoringLogLevel.INFO });
      logger.info('info message');
      expect(logger.getAuditLog()).toHaveLength(0);
    });

    it('should not add DEBUG entries to audit log', () => {
      const logger = new MonitoringLogger({ audit: true, level: MonitoringLogLevel.DEBUG });
      logger.debug('debug message');
      expect(logger.getAuditLog()).toHaveLength(0);
    });

    it('should limit audit log to max entries', () => {
      const logger = new MonitoringLogger({ audit: true, level: MonitoringLogLevel.WARN });
      // Add more than maxAuditEntries (1000)
      for (let i = 0; i < 1100; i++) {
        logger.warn(`warning ${i}`);
      }
      const auditLog = logger.getAuditLog();
      expect(auditLog.length).toBe(1000);
    });

    it('should return copy of audit log', () => {
      const logger = new MonitoringLogger({ audit: true, level: MonitoringLogLevel.WARN });
      logger.warn('warning');
      const log1 = logger.getAuditLog();
      const log2 = logger.getAuditLog();
      expect(log1).not.toBe(log2);
      expect(log1).toEqual(log2);
    });

    it('should clear audit log', () => {
      const logger = new MonitoringLogger({ audit: true, level: MonitoringLogLevel.WARN });
      logger.warn('warning');
      logger.clearAuditLog();
      expect(logger.getAuditLog()).toHaveLength(0);
    });

    it('should include context in audit log entries', () => {
      const logger = new MonitoringLogger({ audit: true, level: MonitoringLogLevel.WARN });
      logger.warn('warning', { userId: '123' });
      const auditLog = logger.getAuditLog();
      expect(auditLog[0].context).toEqual({ userId: '123' });
    });

    it('should include timestamp in audit log entries', () => {
      const logger = new MonitoringLogger({ audit: true, level: MonitoringLogLevel.WARN });
      const before = Date.now();
      logger.warn('warning');
      const after = Date.now();
      const auditLog = logger.getAuditLog();
      expect(auditLog[0].timestamp).toBeGreaterThanOrEqual(before);
      expect(auditLog[0].timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe('Sampling', () => {
    it('should apply sampling to debug logs', () => {
      const logger = new MonitoringLogger({
        level: MonitoringLogLevel.DEBUG,
        sampleRate: 0.0
      });
      logger.debug('debug message');
      expect(mockConsole.debug).not.toHaveBeenCalled();
    });

    it('should log all when sample rate is 1.0', () => {
      const logger = new MonitoringLogger({
        level: MonitoringLogLevel.DEBUG,
        sampleRate: 1.0
      });
      logger.debug('debug message');
      expect(mockConsole.debug).toHaveBeenCalled();
    });

    it('should not sample non-debug logs', () => {
      const logger = new MonitoringLogger({
        level: MonitoringLogLevel.INFO,
        sampleRate: 0.0
      });
      logger.info('info message');
      expect(mockConsole.debug).toHaveBeenCalled();
    });
  });

  describe('Child Logger', () => {
    it('should create child logger', () => {
      const parent = new MonitoringLogger({ metrics: true });
      parent.incrementCounter('parent');
      const child = parent.child({ child: true });
      expect(child).toBeInstanceOf(MonitoringLogger);
    });

    it('should share metrics with parent', () => {
      const parent = new MonitoringLogger({ metrics: true });
      parent.incrementCounter('parent', 5);

      const child = parent.child({});
      child.incrementCounter('child', 3);

      const parentMetrics = parent.getMetrics();
      const childMetrics = child.getMetrics();

      expect(parentMetrics.counters.parent).toBe(5);
      expect(childMetrics.counters.parent).toBe(5);
      expect(childMetrics.counters.child).toBe(3);
    });

    it('should share gauges with parent', () => {
      const parent = new MonitoringLogger({ metrics: true });
      parent.setGauge('parent', 10);

      const child = parent.child({});
      child.setGauge('child', 20);

      const parentMetrics = parent.getMetrics();
      const childMetrics = child.getMetrics();

      expect(parentMetrics.gauges.parent).toBe(10);
      expect(childMetrics.gauges.parent).toBe(10);
      expect(childMetrics.gauges.child).toBe(20);
    });
  });

  describe('Factory Function', () => {
    it('should create logger via factory', () => {
      const logger = createMonitoringLogger({ level: MonitoringLogLevel.INFO });
      expect(logger).toBeInstanceOf(MonitoringLogger);
    });

    it('should use default options in factory', () => {
      const logger = createMonitoringLogger();
      expect(logger).toBeInstanceOf(MonitoringLogger);
    });
  });
});
