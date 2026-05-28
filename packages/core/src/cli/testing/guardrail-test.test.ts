/**
 * Unit tests for Guardrail Validation Test
 *
 * Tests the guardrail-test module's functionality including:
 * - Core package availability detection
 * - Guardrail test execution
 * - Connector integration testing
 * - Result formatting and utilities
 */

import { describe, it, expect, vi } from 'vitest';
import {
  runGuardrailTest,
  runGuardrailTestWithConnector,
  formatGuardrailResult,
  isGuardrailTestSuccessful,
  type GuardrailTestResult
} from './guardrail-test.js';

// Mock the core package imports with proper class for vitest 4
class MockGuardrailEngine {
  validate() {
    return Promise.resolve({
      flagged: true,
      severity: 'critical'
    });
  }
}

vi.mock('@blackunicorn/bonklm', () => ({
  GuardrailEngine: class {
    constructor() {
      return new MockGuardrailEngine();
    }
  }
}));

vi.mock('@blackunicorn/bonklm/validators', () => ({
  PromptInjectionValidator: class {}
}));

describe('guardrail-test', () => {
  describe('runGuardrailTest', () => {
    it('should execute guardrail test and return detection result', async () => {
      const result = await runGuardrailTest();

      // With the mock in place, the test should execute
      expect(result.executed).toBe(true);
      expect(result.detected).toBe(true);
      expect(result.latency).toBeGreaterThanOrEqual(0);
      expect(result.error).toBeUndefined();
    });

    it('should measure latency accurately', async () => {
      const result = await runGuardrailTest();

      expect(result.latency).toBeGreaterThanOrEqual(0);
      // Latency should be reasonable for a mock (< 100ms)
      expect(result.latency).toBeLessThan(100);
    });
  });

  describe('runGuardrailTestWithConnector', () => {
    it('should execute guardrail test with connector config', async () => {
      const connectorConfig = {
        type: 'openai',
        apiKey: 'sk-test'
      };

      const result = await runGuardrailTestWithConnector(connectorConfig);

      expect(result.executed).toBe(true);
      expect(result.detected).toBe(true);
      expect(result.latency).toBeGreaterThanOrEqual(0);
      expect(result.error).toBeUndefined();
    });
  });

  describe('formatGuardrailResult', () => {
    it('should format skipped test result', () => {
      const result: GuardrailTestResult = {
        executed: false,
        detected: false
      };

      const formatted = formatGuardrailResult(result);

      expect(formatted).toContain('skipped');
      expect(formatted).toContain('core package not available');
    });

    it('should format successful detection result', () => {
      const result: GuardrailTestResult = {
        executed: true,
        detected: true,
        latency: 42
      };

      const formatted = formatGuardrailResult(result);

      expect(formatted).toContain('detected');
      expect(formatted).toContain('42');
    });

    it('should format failed detection result', () => {
      const result: GuardrailTestResult = {
        executed: true,
        detected: false,
        latency: 42
      };

      const formatted = formatGuardrailResult(result);

      expect(formatted).toContain('not detected');
    });

    it('should format error result', () => {
      const result: GuardrailTestResult = {
        executed: true,
        detected: false,
        error: 'Test error'
      };

      const formatted = formatGuardrailResult(result);

      expect(formatted).toContain('error');
      expect(formatted).toContain('Test error');
    });

    it('should include latency when available', () => {
      const result: GuardrailTestResult = {
        executed: true,
        detected: true,
        latency: 123
      };

      const formatted = formatGuardrailResult(result);

      expect(formatted).toContain('123');
    });
  });

  describe('isGuardrailTestSuccessful', () => {
    it('should return false for non-executed tests', () => {
      const result: GuardrailTestResult = {
        executed: false,
        detected: false
      };

      expect(isGuardrailTestSuccessful(result)).toBe(false);
    });

    it('should return true for successfully detected threats', () => {
      const result: GuardrailTestResult = {
        executed: true,
        detected: true
      };

      expect(isGuardrailTestSuccessful(result)).toBe(true);
    });

    it('should return false for failed detection', () => {
      const result: GuardrailTestResult = {
        executed: true,
        detected: false
      };

      expect(isGuardrailTestSuccessful(result)).toBe(false);
    });

    it('should return false for tests with errors', () => {
      const result: GuardrailTestResult = {
        executed: true,
        detected: false,
        error: 'Validation failed'
      };

      expect(isGuardrailTestSuccessful(result)).toBe(false);
    });
  });
});
