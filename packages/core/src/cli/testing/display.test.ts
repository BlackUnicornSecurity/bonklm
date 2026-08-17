/**
 * Unit tests for Test Result Display
 *
 * Tests the display module's functionality including:
 * - Test result display in terminal format
 * - JSON output export
 * - Summary statistics
 * - Utility functions for filtering results
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  displayTestResults,
  displaySingleTestResult,
  formatTestSummary,
  displayTestSummary,
  exportTestResultsJson,
  exportTestSummaryJson,
  createProgressBar,
  formatTestDetail,
  getFailedTests,
  getSuccessfulTests,
  type TestDisplay
} from './display.js';
import type { TestResult } from '../connectors/base.js';

// Mock console methods
const consoleMock = {
  log: vi.fn(),
  error: vi.fn(),
  warn: vi.fn()
};

describe('display', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(consoleMock.log);
    vi.spyOn(console, 'error').mockImplementation(consoleMock.error);
    vi.spyOn(console, 'warn').mockImplementation(consoleMock.warn);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('displayTestResults', () => {
    let mockTests: TestDisplay[];

    beforeEach(() => {
      mockTests = [
        {
          connectorId: 'openai',
          connectorName: 'OpenAI',
          result: { connection: true, validation: true, latency: 123 }
        },
        {
          connectorId: 'anthropic',
          connectorName: 'Anthropic',
          result: { connection: true, validation: false, error: 'Invalid key', latency: 456 }
        },
        {
          connectorId: 'ollama',
          connectorName: 'Ollama',
          result: { connection: false, validation: false, error: 'Service unavailable', latency: 50 }
        }
      ];
    });

    it('should display test results in terminal format', () => {
      displayTestResults(mockTests, false);

      // Test 1: status + latency = 2 lines
      // Test 2: status + latency + error = 3 lines
      // Test 3: status + latency + error = 3 lines
      // Total = 8 lines
      expect(console.log).toHaveBeenCalledTimes(8);
    });

    it('should export test results as JSON when jsonMode is true', () => {
      displayTestResults(mockTests, true);

      const calls = console.log.mock.calls;
      const jsonOutput = calls[0]?.[0];

      expect(jsonOutput).toBeDefined();
      const parsed = JSON.parse(jsonOutput as string);
      expect(parsed).toHaveLength(3);
      expect(parsed[0]).toHaveProperty('connectorId', 'openai');
      expect(parsed[0]).toHaveProperty('connection', true);
      expect(parsed[0]).toHaveProperty('validation', true);
    });

    it('should use connector name when available', () => {
      displayTestResults(mockTests, false);

      const calls = console.log.mock.calls;
      const output = calls.map(c => c[0]).join(' ');

      expect(output).toContain('OpenAI');
      expect(output).toContain('Anthropic');
      expect(output).toContain('Ollama');
    });

    it('should fall back to connectorId when name is not available', () => {
      const testsWithoutNames: TestDisplay[] = [
        { connectorId: 'openai', result: { connection: true, validation: true, latency: 100 } }
      ];

      displayTestResults(testsWithoutNames, false);

      const calls = console.log.mock.calls;
      const output = calls.map(c => c[0]).join(' ');

      expect(output).toContain('openai');
    });

    it('should display latency when available', () => {
      displayTestResults(mockTests, false);

      const calls = console.log.mock.calls;
      const output = calls.map(c => c[0]).join(' ');

      expect(output).toContain('123ms');
      expect(output).toContain('456ms');
      expect(output).toContain('50ms');
    });

    it('should display errors when present', () => {
      displayTestResults(mockTests, false);

      const calls = console.log.mock.calls;
      const output = calls.map(c => c[0]).join(' ');

      expect(output).toContain('Invalid key');
      expect(output).toContain('Service unavailable');
    });
  });

  describe('displaySingleTestResult', () => {
    it('should display successful test result', () => {
      const result: TestResult = { connection: true, validation: true, latency: 100 };

      displaySingleTestResult('openai', 'OpenAI', result);

      const calls = console.log.mock.calls;
      const output = calls.map(c => c[0]).join(' ');

      expect(output).toContain('✓');
      expect(output).toContain('OpenAI');
    });

    it('should display connection failure', () => {
      const result: TestResult = { connection: false, validation: false, error: 'Failed' };

      displaySingleTestResult('openai', 'OpenAI', result, false);

      const calls = console.log.mock.calls;
      const output = calls.map(c => c[0]).join(' ');

      expect(output).toContain('✗');
      expect(output).toContain('Failed');
    });

    it('should display validation failure', () => {
      const result: TestResult = {
        connection: true,
        validation: false,
        error: 'Auth failed',
        latency: 100
      };

      displaySingleTestResult('openai', 'OpenAI', result, false);

      const calls = console.log.mock.calls;
      const output = calls.map(c => c[0]).join(' ');

      expect(output).toContain('Connection: ✓');
      expect(output).toContain('Validation: ✗');
      expect(output).toContain('Auth failed');
    });

    it('should respect supportsColor parameter', () => {
      const result: TestResult = { connection: true, validation: true };

      displaySingleTestResult('openai', 'OpenAI', result, false);

      // Should not contain ANSI color codes
      const calls = console.log.mock.calls;
      const output = calls.map(c => c[0]).join(' ');
      expect(output).not.toContain('\x1b[');
    });
  });

  describe('formatTestSummary', () => {
    it('should calculate summary statistics correctly', () => {
      const tests: TestDisplay[] = [
        { connectorId: 'test1', result: { connection: true, validation: true, latency: 100 } },
        { connectorId: 'test2', result: { connection: true, validation: true, latency: 200 } },
        { connectorId: 'test3', result: { connection: true, validation: false, latency: 150 } },
        { connectorId: 'test4', result: { connection: false, validation: false, error: 'Failed' } }
      ];

      const summary = formatTestSummary(tests);

      expect(summary.total).toBe(4);
      expect(summary.successful).toBe(2);
      expect(summary.failed).toBe(2);
      expect(summary.connectionFailures).toBe(1);
      expect(summary.validationFailures).toBe(1);
      expect(summary.averageLatency).toBe(150); // (100 + 200 + 150) / 3
      expect(summary.successRate).toBe(50); // 2/4 * 100
    });

    it('should handle empty test array', () => {
      const summary = formatTestSummary([]);

      expect(summary.total).toBe(0);
      expect(summary.successful).toBe(0);
      expect(summary.failed).toBe(0);
      expect(summary.averageLatency).toBe(0);
      expect(summary.successRate).toBe(0);
    });

    it('should calculate success rate correctly', () => {
      const tests: TestDisplay[] = [
        { connectorId: 'test1', result: { connection: true, validation: true } },
        { connectorId: 'test2', result: { connection: true, validation: true } },
        { connectorId: 'test3', result: { connection: true, validation: true } }
      ];

      const summary = formatTestSummary(tests);

      expect(summary.successRate).toBe(100);
    });

    it('should handle tests without latency', () => {
      const tests: TestDisplay[] = [
        { connectorId: 'test1', result: { connection: true, validation: true } },
        { connectorId: 'test2', result: { connection: true, validation: true, latency: 100 } }
      ];

      const summary = formatTestSummary(tests);

      expect(summary.averageLatency).toBe(100);
    });
  });

  describe('displayTestSummary', () => {
    it('should display formatted summary', () => {
      const summary = {
        total: 5,
        successful: 4,
        failed: 1,
        connectionFailures: 0,
        validationFailures: 1,
        averageLatency: 150,
        successRate: 80
      };

      displayTestSummary(summary);

      expect(console.log).toHaveBeenCalled();
      const calls = console.log.mock.calls;
      const output = calls.map(c => c[0]).join(' ');

      expect(output).toContain('Test Summary');
      expect(output).toContain('4 successful');
      expect(output).toContain('1 failed');
    });

    it('should include validation failures when present', () => {
      const summary = {
        total: 3,
        successful: 1,
        failed: 2,
        connectionFailures: 1,
        validationFailures: 1,
        averageLatency: 100,
        successRate: 33
      };

      displayTestSummary(summary);

      const calls = console.log.mock.calls;
      const output = calls.map(c => c[0]).join(' ');

      expect(output).toContain('Connection failures: 1');
      expect(output).toContain('Validation failures: 1');
    });
  });

  describe('exportTestResultsJson', () => {
    it('should export test results as pretty JSON by default', () => {
      const tests: TestDisplay[] = [
        { connectorId: 'openai', connectorName: 'OpenAI', result: { connection: true, validation: true } }
      ];

      exportTestResultsJson(tests);

      const calls = console.log.mock.calls;
      const jsonOutput = calls[0]?.[0];

      expect(jsonOutput).toContain('\n'); // Pretty printed
      expect(jsonOutput).toContain('  '); // Indentation

      const parsed = JSON.parse(jsonOutput as string);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].connectorId).toBe('openai');
    });

    it('should export test results as compact JSON when pretty is false', () => {
      const tests: TestDisplay[] = [{ connectorId: 'openai', result: { connection: true, validation: true } }];

      exportTestResultsJson(tests, false);

      const calls = console.log.mock.calls;
      const jsonOutput = calls[0]?.[0];

      expect(jsonOutput).not.toContain('\n');
      expect(jsonOutput).not.toContain('  ');
    });

    it('should include all result fields in JSON export', () => {
      const tests: TestDisplay[] = [
        {
          connectorId: 'test',
          connectorName: 'Test Connector',
          result: {
            connection: true,
            validation: false,
            error: 'Auth failed',
            latency: 250
          }
        }
      ];

      exportTestResultsJson(tests);

      const calls = console.log.mock.calls;
      const jsonOutput = calls[0]?.[0];
      const parsed = JSON.parse(jsonOutput as string);

      expect(parsed[0]).toEqual({
        connectorId: 'test',
        connectorName: 'Test Connector',
        connection: true,
        validation: false,
        error: 'Auth failed',
        latency: 250
      });
    });
  });

  describe('exportTestSummaryJson', () => {
    it('should export summary as JSON', () => {
      const summary = {
        total: 5,
        successful: 4,
        failed: 1,
        connectionFailures: 0,
        validationFailures: 1,
        averageLatency: 150,
        successRate: 80
      };

      exportTestSummaryJson(summary);

      const calls = console.log.mock.calls;
      const jsonOutput = calls[0]?.[0];
      const parsed = JSON.parse(jsonOutput as string);

      expect(parsed).toEqual(summary);
    });
  });

  describe('createProgressBar', () => {
    it('should create progress bar with correct percentage', () => {
      const bar = createProgressBar(2, 5);

      expect(bar).toMatch(/\[[█░]+\] 40%/);
      expect(bar).toContain('40%'); // 2/5 = 40%
    });

    it('should create empty progress bar for 0 progress', () => {
      const bar = createProgressBar(0, 10);

      expect(bar).toMatch(/\[[█░]+\] 0%/);
      expect(bar).toContain('0%');
    });

    it('should create full progress bar for completion', () => {
      const bar = createProgressBar(10, 10);

      expect(bar).toMatch(/\[[█░]+\] 100%/);
      expect(bar).toContain('100%');
    });

    it('should respect custom width', () => {
      const bar = createProgressBar(1, 2, 10);

      // Width 10 should result in 5 filled chars for 50%
      expect(bar).toContain('[█████░░░░░] 50%');
    });
  });

  describe('formatTestDetail', () => {
    it('should format successful test result', () => {
      const test: TestDisplay = {
        connectorId: 'openai',
        result: { connection: true, validation: true, latency: 100 }
      };

      const detail = formatTestDetail(test);

      expect(detail).toContain('[openai]');
      expect(detail).toContain('Connection: ✓');
      expect(detail).toContain('Validation: ✓');
      expect(detail).toContain('Latency: 100ms');
    });

    it('should format failed test result', () => {
      const test: TestDisplay = {
        connectorId: 'anthropic',
        result: { connection: false, validation: false, error: 'Auth failed' }
      };

      const detail = formatTestDetail(test);

      expect(detail).toContain('[anthropic]');
      expect(detail).toContain('Connection: ✗');
      expect(detail).toContain('Auth failed');
    });

    it('should format validation failure', () => {
      const test: TestDisplay = {
        connectorId: 'test',
        result: { connection: true, validation: false, error: 'Invalid key', latency: 50 }
      };

      const detail = formatTestDetail(test);

      expect(detail).toContain('[test]');
      expect(detail).toContain('Connection: ✓');
      expect(detail).toContain('Validation: ✗');
      expect(detail).toContain('Latency: 50ms');
      expect(detail).toContain('Error: Invalid key');
    });
  });

  describe('getFailedTests', () => {
    it('should return only failed tests', () => {
      const tests: TestDisplay[] = [
        { connectorId: 'test1', result: { connection: true, validation: true } },
        { connectorId: 'test2', result: { connection: true, validation: false } },
        { connectorId: 'test3', result: { connection: false, validation: false } }
      ];

      const failed = getFailedTests(tests);

      expect(failed).toHaveLength(2);
      expect(failed.map(t => t.connectorId)).toEqual(['test2', 'test3']);
    });

    it('should return empty array when all tests pass', () => {
      const tests: TestDisplay[] = [
        { connectorId: 'test1', result: { connection: true, validation: true } },
        { connectorId: 'test2', result: { connection: true, validation: true } }
      ];

      const failed = getFailedTests(tests);

      expect(failed).toHaveLength(0);
    });
  });

  describe('getSuccessfulTests', () => {
    it('should return only successful tests', () => {
      const tests: TestDisplay[] = [
        { connectorId: 'test1', result: { connection: true, validation: true } },
        { connectorId: 'test2', result: { connection: true, validation: false } },
        { connectorId: 'test3', result: { connection: false, validation: false } }
      ];

      const successful = getSuccessfulTests(tests);

      expect(successful).toHaveLength(1);
      expect(successful[0].connectorId).toBe('test1');
    });

    it('should return empty array when all tests fail', () => {
      const tests: TestDisplay[] = [
        { connectorId: 'test1', result: { connection: true, validation: false } },
        { connectorId: 'test2', result: { connection: false, validation: false } }
      ];

      const successful = getSuccessfulTests(tests);

      expect(successful).toHaveLength(0);
    });
  });
});
