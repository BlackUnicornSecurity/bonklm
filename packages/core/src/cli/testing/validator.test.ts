/**
 * Unit tests for Connection Test Framework
 *
 * Tests the validator module's functionality including:
 * - Basic connector testing
 * - Timeout enforcement
 * - Multiple connector testing
 * - Configuration validation
 * - Result utilities
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  applyConnectorConfigKeys,
  testConnector,
  testConnectorWithTimeout,
  testMultipleConnectors,
  validateConnectorConfig,
  createTestResult,
  isTestSuccessful,
  isConnectionFailure,
  isValidationFailure,
  formatTestResult,
  validateTimeout
} from './validator.js';
import type { ConnectorDefinition, TestResult } from '../connectors/base.js';
import { openaiConnector } from '../connectors/implementations/openai.js';
import { anthropicConnector } from '../connectors/implementations/anthropic.js';
import { z } from 'zod';
import { WizardError } from '../utils/error.js';

describe('validator', () => {
  describe('validateTimeout', () => {
    it('should accept valid timeout values', () => {
      expect(validateTimeout(1000)).toBe(1000);
      expect(validateTimeout(10000)).toBe(10000);
      expect(validateTimeout(30000)).toBe(30000);
    });

    it('should throw on negative timeout', () => {
      expect(() => validateTimeout(-1)).toThrow(WizardError);
      expect(() => validateTimeout(-1000)).toThrow(WizardError);
    });

    it('should throw on timeout exceeding maximum', () => {
      expect(() => validateTimeout(30001)).toThrow(WizardError);
      expect(() => validateTimeout(60000)).toThrow(WizardError);
    });

    it('should accept zero timeout', () => {
      expect(validateTimeout(0)).toBe(0);
    });
  });

  describe('applyConnectorConfigKeys', () => {
    function makeConnector(configKeyByEnvVar?: Record<string, string>): ConnectorDefinition {
      return {
        id: 'c',
        name: 'C',
        category: 'llm',
        detection: { envVars: Object.keys(configKeyByEnvVar ?? {}) },
        configKeyByEnvVar,
        test: vi.fn(),
        generateSnippet: () => 'snippet',
        configSchema: z.object({})
      };
    }

    it('re-keys a declared env var to its connector config key', () => {
      const connector = makeConnector({ OPENAI_API_KEY: 'apiKey' });
      expect(applyConnectorConfigKeys(connector, { OPENAI_API_KEY: 'sk-x' })).toEqual({ apiKey: 'sk-x' });
    });

    it('passes through env vars that have no declared mapping', () => {
      const connector = makeConnector({ OPENAI_API_KEY: 'apiKey' });
      expect(applyConnectorConfigKeys(connector, { OTHER_VAR: 'v' })).toEqual({ OTHER_VAR: 'v' });
    });

    it('returns a shallow copy unchanged when the connector declares no mapping', () => {
      const connector = makeConnector();
      const input = { TEST_KEY: 'v' };
      const out = applyConnectorConfigKeys(connector, input);
      expect(out).toEqual({ TEST_KEY: 'v' });
      expect(out).not.toBe(input); // new object — never mutate the caller's bag
    });

    it('does not mutate the input config', () => {
      const connector = makeConnector({ OPENAI_API_KEY: 'apiKey' });
      const input = { OPENAI_API_KEY: 'sk-x' };
      applyConnectorConfigKeys(connector, input);
      expect(input).toEqual({ OPENAI_API_KEY: 'sk-x' });
    });

    it('maps the real OpenAI connector OPENAI_API_KEY to apiKey', () => {
      expect(applyConnectorConfigKeys(openaiConnector, { OPENAI_API_KEY: 'sk-x' })).toEqual({ apiKey: 'sk-x' });
    });

    it('maps the real Anthropic connector ANTHROPIC_API_KEY to apiKey', () => {
      expect(applyConnectorConfigKeys(anthropicConnector, { ANTHROPIC_API_KEY: 'sk-ant-x' })).toEqual({
        apiKey: 'sk-ant-x'
      });
    });
  });

  describe('testConnector', () => {
    let mockConnector: ConnectorDefinition;

    beforeEach(() => {
      mockConnector = {
        id: 'test-connector',
        name: 'Test Connector',
        category: 'llm',
        detection: { envVars: ['TEST_KEY'] },
        test: vi.fn(),
        generateSnippet: () => 'snippet',
        configSchema: z.object({ apiKey: z.string() })
      };
    });

    it('should return successful result with latency', async () => {
      (mockConnector.test as ReturnType<typeof vi.fn>).mockResolvedValue({
        connection: true,
        validation: true
      });

      const result = await testConnector(mockConnector, { apiKey: 'test-key' });

      expect(result.connection).toBe(true);
      expect(result.validation).toBe(true);
      expect(result.latency).toBeGreaterThanOrEqual(0);
      expect(result.latency).toBeLessThan(100);
    });

    it('should return failed result with error', async () => {
      const testError = 'Authentication failed';
      (mockConnector.test as ReturnType<typeof vi.fn>).mockResolvedValue({
        connection: false,
        validation: false,
        error: testError
      });

      const result = await testConnector(mockConnector, { apiKey: 'invalid-key' });

      expect(result.connection).toBe(false);
      expect(result.validation).toBe(false);
      expect(result.error).toBe(testError);
      expect(result.latency).toBeGreaterThanOrEqual(0);
    });

    it('should handle thrown errors gracefully', async () => {
      const testError = new Error('Network error');
      (mockConnector.test as ReturnType<typeof vi.fn>).mockRejectedValue(testError);

      const result = await testConnector(mockConnector, { apiKey: 'test-key' });

      expect(result.connection).toBe(false);
      expect(result.validation).toBe(false);
      expect(result.error).toBe('Network error');
    });

    it('should handle non-Error thrown values', async () => {
      (mockConnector.test as ReturnType<typeof vi.fn>).mockRejectedValue('string error');

      const result = await testConnector(mockConnector, { apiKey: 'test-key' });

      expect(result.connection).toBe(false);
      expect(result.validation).toBe(false);
      expect(result.error).toBe('Unknown error');
    });

    it('should return invalid result for malformed test output', async () => {
      (mockConnector.test as ReturnType<typeof vi.fn>).mockResolvedValue({
        connection: 'yes' as unknown as boolean,
        validation: true
      });

      const result = await testConnector(mockConnector, { apiKey: 'test-key' });

      expect(result.connection).toBe(false);
      expect(result.validation).toBe(false);
      expect(result.error).toBe('Connector test returned invalid result format');
    });

    it('should measure latency accurately', async () => {
      // Create a connector with a 50ms delay
      const slowConnector: ConnectorDefinition = {
        ...mockConnector,
        test: vi.fn(async () => {
          await new Promise(resolve => setTimeout(resolve, 50));
          return { connection: true, validation: true };
        })
      };

      const result = await testConnector(slowConnector, { apiKey: 'test-key' });

      expect(result.connection).toBe(true);
      expect(result.latency).toBeGreaterThanOrEqual(40); // Allow some margin
      expect(result.latency).toBeLessThan(200); // Should complete within 200ms
    });

    it('re-keys an env-var-keyed credential bag to the connector config key before testing (D-029)', async () => {
      // Mirrors the openai/anthropic contract: detection is keyed by env-var
      // name (OPENAI_API_KEY) but test() reads config.apiKey. The CLI loaders
      // build the bag keyed by env-var name, so testConnector must re-key it via
      // configKeyByEnvVar for the value to actually reach test(). Without the
      // seam mapping, test() sees { OPENAI_API_KEY } -> config.apiKey is
      // undefined -> "API key is required" (the D-029 false failure).
      const received: Array<Record<string, string>> = [];
      const apiKeyConnector: ConnectorDefinition = {
        id: 'apikey-connector',
        name: 'ApiKey Connector',
        category: 'llm',
        detection: { envVars: ['OPENAI_API_KEY'] },
        configKeyByEnvVar: { OPENAI_API_KEY: 'apiKey' },
        test: vi.fn(async (config: Record<string, string>) => {
          received.push(config);
          const ok = config.apiKey === 'sk-valid';
          return {
            connection: ok,
            validation: ok,
            error: ok ? undefined : 'API key is required'
          };
        }),
        generateSnippet: () => 'snippet',
        configSchema: z.object({ apiKey: z.string() })
      };

      const result = await testConnector(apiKeyConnector, { OPENAI_API_KEY: 'sk-valid' });

      // The connector saw the re-keyed config, not the raw env-var name...
      expect(received[0]).toEqual({ apiKey: 'sk-valid' });
      expect(received[0]).not.toHaveProperty('OPENAI_API_KEY');
      // ...and therefore reports success instead of "API key is required".
      expect(result.connection).toBe(true);
      expect(result.validation).toBe(true);
      expect(result.error).toBeUndefined();
    });
  });

  describe('testConnectorWithTimeout', () => {
    let mockConnector: ConnectorDefinition;
    let useRealTimers: boolean;

    beforeEach(() => {
      mockConnector = {
        id: 'test-connector',
        name: 'Test Connector',
        category: 'llm',
        detection: { envVars: ['TEST_KEY'] },
        test: vi.fn(),
        generateSnippet: () => 'snippet',
        configSchema: z.object({ apiKey: z.string() })
      };
      useRealTimers = true;
    });

    afterEach(() => {
      if (useRealTimers) {
        vi.useRealTimers();
      }
    });

    it('should return result within timeout', async () => {
      (mockConnector.test as ReturnType<typeof vi.fn>).mockResolvedValue({
        connection: true,
        validation: true
      });

      const result = await testConnectorWithTimeout(mockConnector, { apiKey: 'test-key' }, 5000);

      expect(result.connection).toBe(true);
      expect(result.validation).toBe(true);
    });

    it('should use default timeout of 10000ms', async () => {
      (mockConnector.test as ReturnType<typeof vi.fn>).mockResolvedValue({
        connection: true,
        validation: true
      });

      const result = await testConnectorWithTimeout(mockConnector, { apiKey: 'test-key' });

      expect(result.connection).toBe(true);
      expect(result.validation).toBe(true);
    });

    it('should throw WizardError on timeout', async () => {
      // Create a connector that respects abort signal but never otherwise resolves
      const hangingConnector: ConnectorDefinition = {
        ...mockConnector,
        test: vi.fn((_config, signal) => {
          return new Promise((_, reject) => {
            // Respect the abort signal - reject when aborted
            signal?.addEventListener('abort', () => {
              reject(new DOMException('Aborted', 'AbortError'));
            });
          });
        })
      };

      vi.useRealTimers();
      useRealTimers = true;

      // The test should timeout and throw WizardError
      await expect(
        testConnectorWithTimeout(
          hangingConnector,
          { apiKey: 'test-key' },
          100 // Short timeout for fast test
        )
      ).rejects.toThrow(WizardError);
    });

    it('should validate timeout parameter', async () => {
      (mockConnector.test as ReturnType<typeof vi.fn>).mockResolvedValue({
        connection: true,
        validation: true
      });

      await expect(testConnectorWithTimeout(mockConnector, { apiKey: 'test-key' }, -1)).rejects.toThrow(WizardError);

      await expect(testConnectorWithTimeout(mockConnector, { apiKey: 'test-key' }, 100000)).rejects.toThrow(
        WizardError
      );
    });

    it('should return error result for connector test errors', async () => {
      const testError = new Error('Network failure');
      (mockConnector.test as ReturnType<typeof vi.fn>).mockRejectedValue(testError);

      const result = await testConnectorWithTimeout(mockConnector, { apiKey: 'test-key' }, 5000);

      expect(result.connection).toBe(false);
      expect(result.validation).toBe(false);
      expect(result.error).toBe('Network failure');
    });
  });

  describe('testMultipleConnectors', () => {
    let mockConnectors: ConnectorDefinition[];

    beforeEach(() => {
      mockConnectors = [
        {
          id: 'connector-1',
          name: 'Connector 1',
          category: 'llm',
          detection: { envVars: ['KEY1'] },
          test: vi.fn(),
          generateSnippet: () => 'snippet1',
          configSchema: z.object({ key: z.string() })
        },
        {
          id: 'connector-2',
          name: 'Connector 2',
          category: 'llm',
          detection: { envVars: ['KEY2'] },
          test: vi.fn(),
          generateSnippet: () => 'snippet2',
          configSchema: z.object({ key: z.string() })
        },
        {
          id: 'connector-3',
          name: 'Connector 3',
          category: 'llm',
          detection: { envVars: ['KEY3'] },
          test: vi.fn(),
          generateSnippet: () => 'snippet3',
          configSchema: z.object({ key: z.string() })
        }
      ];
    });

    it('should test all connectors in parallel', async () => {
      (mockConnectors[0].test as ReturnType<typeof vi.fn>).mockResolvedValue({
        connection: true,
        validation: true
      });
      (mockConnectors[1].test as ReturnType<typeof vi.fn>).mockResolvedValue({
        connection: true,
        validation: true
      });
      (mockConnectors[2].test as ReturnType<typeof vi.fn>).mockResolvedValue({
        connection: false,
        validation: false,
        error: 'Auth failed'
      });

      const results = await testMultipleConnectors([
        { connectorId: 'connector-1', connector: mockConnectors[0], config: { key: 'key1' } },
        { connectorId: 'connector-2', connector: mockConnectors[1], config: { key: 'key2' } },
        { connectorId: 'connector-3', connector: mockConnectors[2], config: { key: 'key3' } }
      ]);

      expect(results).toHaveLength(3);
      expect(results[0].connectorId).toBe('connector-1');
      expect(results[0].result.connection).toBe(true);
      expect(results[1].connectorId).toBe('connector-2');
      expect(results[1].result.connection).toBe(true);
      expect(results[2].connectorId).toBe('connector-3');
      expect(results[2].result.connection).toBe(false);
      expect(results[2].result.error).toBe('Auth failed');
    });

    it('should include latency for all results', async () => {
      for (const connector of mockConnectors) {
        (connector.test as ReturnType<typeof vi.fn>).mockResolvedValue({
          connection: true,
          validation: true
        });
      }

      const results = await testMultipleConnectors([
        { connectorId: 'connector-1', connector: mockConnectors[0], config: { key: 'key1' } },
        { connectorId: 'connector-2', connector: mockConnectors[1], config: { key: 'key2' } },
        { connectorId: 'connector-3', connector: mockConnectors[2], config: { key: 'key3' } }
      ]);

      for (const { result } of results) {
        expect(result.latency).toBeGreaterThanOrEqual(0);
        expect(typeof result.latency).toBe('number');
      }
    });
  });

  describe('validateConnectorConfig', () => {
    let mockConnector: ConnectorDefinition;

    beforeEach(() => {
      mockConnector = {
        id: 'test-connector',
        name: 'Test Connector',
        category: 'llm',
        detection: { envVars: ['API_KEY', 'ENDPOINT'] },
        test: vi.fn(),
        generateSnippet: () => 'snippet',
        configSchema: z.object({
          apiKey: z.string().min(1),
          endpoint: z.string().url().optional(),
          model: z.string().default('gpt-4')
        })
      };
    });

    it('should validate complete configuration', () => {
      const result = validateConnectorConfig(mockConnector, {
        apiKey: 'sk-test',
        endpoint: 'https://api.example.com',
        model: 'gpt-4'
      });

      expect(result.isValid).toBe(true);
      expect(result.missing).toEqual([]);
      expect(result.errors).toEqual([]);
    });

    it('should detect missing required fields', () => {
      const result = validateConnectorConfig(mockConnector, {});

      expect(result.isValid).toBe(false);
      expect(result.missing).toContain('apiKey');
    });

    it('should detect validation errors', () => {
      const result = validateConnectorConfig(mockConnector, {
        apiKey: 'sk-test',
        endpoint: 'not-a-url'
      });

      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should use default values correctly', () => {
      const result = validateConnectorConfig(mockConnector, {
        apiKey: 'sk-test'
      });

      expect(result.isValid).toBe(true);
      expect(result.missing).toEqual([]);
      expect(result.errors).toEqual([]);
    });

    it('should handle empty config schema', () => {
      const lenientConnector: ConnectorDefinition = {
        ...mockConnector,
        configSchema: z.object({})
      };

      const result = validateConnectorConfig(lenientConnector, {});

      expect(result.isValid).toBe(true);
      expect(result.missing).toEqual([]);
      expect(result.errors).toEqual([]);
    });
  });

  describe('createTestResult', () => {
    it('should create test result with all fields', () => {
      const result = createTestResult(true, true, undefined, 123);

      expect(result.connection).toBe(true);
      expect(result.validation).toBe(true);
      expect(result.error).toBeUndefined();
      expect(result.latency).toBe(123);
    });

    it('should create test result with error', () => {
      const result = createTestResult(false, false, 'Test error', 456);

      expect(result.connection).toBe(false);
      expect(result.validation).toBe(false);
      expect(result.error).toBe('Test error');
      expect(result.latency).toBe(456);
    });

    it('should create test result with minimal fields', () => {
      const result = createTestResult(true, false);

      expect(result.connection).toBe(true);
      expect(result.validation).toBe(false);
      expect(result.error).toBeUndefined();
      expect(result.latency).toBeUndefined();
    });
  });

  describe('isTestSuccessful', () => {
    it('should return true for successful result', () => {
      const result: TestResult = {
        connection: true,
        validation: true
      };

      expect(isTestSuccessful(result)).toBe(true);
    });

    it('should return false for connection failure', () => {
      const result: TestResult = {
        connection: false,
        validation: true
      };

      expect(isTestSuccessful(result)).toBe(false);
    });

    it('should return false for validation failure', () => {
      const result: TestResult = {
        connection: true,
        validation: false
      };

      expect(isTestSuccessful(result)).toBe(false);
    });

    it('should return false for complete failure', () => {
      const result: TestResult = {
        connection: false,
        validation: false
      };

      expect(isTestSuccessful(result)).toBe(false);
    });
  });

  describe('isConnectionFailure', () => {
    it('should return true for connection failure', () => {
      const result: TestResult = {
        connection: false,
        validation: false
      };

      expect(isConnectionFailure(result)).toBe(true);
    });

    it('should return false for successful connection', () => {
      const result: TestResult = {
        connection: true,
        validation: true
      };

      expect(isConnectionFailure(result)).toBe(false);
    });

    it('should return false for validation failure with good connection', () => {
      const result: TestResult = {
        connection: true,
        validation: false
      };

      expect(isConnectionFailure(result)).toBe(false);
    });
  });

  describe('isValidationFailure', () => {
    it('should return true for validation failure with good connection', () => {
      const result: TestResult = {
        connection: true,
        validation: false
      };

      expect(isValidationFailure(result)).toBe(true);
    });

    it('should return false for successful validation', () => {
      const result: TestResult = {
        connection: true,
        validation: true
      };

      expect(isValidationFailure(result)).toBe(false);
    });

    it('should return false for connection failure', () => {
      const result: TestResult = {
        connection: false,
        validation: false
      };

      expect(isValidationFailure(result)).toBe(false);
    });
  });

  describe('formatTestResult', () => {
    it('should format successful result', () => {
      const result: TestResult = {
        connection: true,
        validation: true,
        latency: 123
      };

      const formatted = formatTestResult(result);

      expect(formatted).toContain('✓ Success');
      expect(formatted).toContain('123ms');
    });

    it('should format validation failure', () => {
      const result: TestResult = {
        connection: true,
        validation: false,
        error: 'Invalid API key',
        latency: 45
      };

      const formatted = formatTestResult(result);

      expect(formatted).toContain('✗ Validation Failed');
      expect(formatted).toContain('45ms');
      expect(formatted).toContain('Invalid API key');
    });

    it('should format connection failure', () => {
      const result: TestResult = {
        connection: false,
        validation: false,
        error: 'Service unreachable',
        latency: 500
      };

      const formatted = formatTestResult(result);

      expect(formatted).toContain('✗ Connection Failed');
      expect(formatted).toContain('500ms');
      expect(formatted).toContain('Service unreachable');
    });

    it('should format result without latency', () => {
      const result: TestResult = {
        connection: true,
        validation: true
      };

      const formatted = formatTestResult(result);

      expect(formatted).toContain('✓ Success');
      expect(formatted).not.toContain('ms');
    });

    it('should format result without error', () => {
      const result: TestResult = {
        connection: false,
        validation: false,
        latency: 100
      };

      const formatted = formatTestResult(result);

      expect(formatted).toContain('✗ Connection Failed');
      expect(formatted).toContain('100ms');
      expect(formatted).not.toContain('Error:');
    });
  });
});
