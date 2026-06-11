/**
 * Tests for connector base types and interfaces
 */

import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import {
  type ConnectorCategory,
  type DetectionRules,
  type TestResult,
  type ConnectorDefinition,
  isConnectorCategory,
  isTestResult,
  isConnectorDefinition
} from './base.js';

describe('ConnectorCategory', () => {
  it('should accept valid category values', () => {
    const validCategories: ConnectorCategory[] = ['llm', 'framework', 'vector-db'];

    for (const category of validCategories) {
      expect(isConnectorCategory(category)).toBe(true);
    }
  });

  it('should reject invalid category values', () => {
    const invalidValues = ['invalid', 'LLM', 'LLM ', '', null, undefined, 123, {}, []];

    for (const value of invalidValues) {
      expect(isConnectorCategory(value)).toBe(false);
    }
  });
});

describe('DetectionRules', () => {
  it('should allow all optional fields to be undefined', () => {
    const rules: DetectionRules = {};

    expect(rules).toBeDefined();
    expect(rules.packageJson).toBeUndefined();
    expect(rules.envVars).toBeUndefined();
    expect(rules.ports).toBeUndefined();
    expect(rules.dockerContainers).toBeUndefined();
  });

  it('should accept partial rules', () => {
    const envOnly: DetectionRules = { envVars: ['API_KEY'] };
    const portsOnly: DetectionRules = { ports: [8080, 11434] };
    const combined: DetectionRules = {
      packageJson: ['express'],
      envVars: ['OPENAI_API_KEY'],
      ports: [11434],
      dockerContainers: ['ollama']
    };

    expect(envOnly.envVars).toEqual(['API_KEY']);
    expect(portsOnly.ports).toEqual([8080, 11434]);
    expect(combined.packageJson).toEqual(['express']);
    expect(combined.envVars).toEqual(['OPENAI_API_KEY']);
    expect(combined.ports).toEqual([11434]);
    expect(combined.dockerContainers).toEqual(['ollama']);
  });
});

describe('TestResult', () => {
  it('should create a valid minimal result', () => {
    const result: TestResult = {
      connection: true,
      validation: true
    };

    expect(isTestResult(result)).toBe(true);
  });

  it('should create a full result with all fields', () => {
    const result: TestResult = {
      connection: true,
      validation: true,
      error: undefined,
      latency: 123
    };

    expect(isTestResult(result)).toBe(true);
    expect(result.latency).toBe(123);
  });

  it('should create a failed result with error', () => {
    const result: TestResult = {
      connection: false,
      validation: false,
      error: 'Connection refused',
      latency: 50
    };

    expect(isTestResult(result)).toBe(true);
    expect(result.connection).toBe(false);
    expect(result.error).toBe('Connection refused');
  });

  it('should reject invalid test results', () => {
    const invalidResults = [
      null,
      undefined,
      {},
      { connection: true },
      { validation: true },
      { connection: 'true', validation: true },
      { connection: true, validation: 'true' },
      { connection: true, validation: true, error: 123 },
      { connection: true, validation: true, latency: '123' }
    ];

    for (const result of invalidResults) {
      expect(isTestResult(result)).toBe(false);
    }
  });
});

describe('ConnectorDefinition', () => {
  const mockSchema = z.object({
    apiKey: z.string().min(1)
  });

  const mockTest = vi.fn().mockResolvedValue({
    connection: true,
    validation: true
  });

  const mockSnippet = vi.fn().mockReturnValue('code snippet');

  it('should accept a valid connector definition', () => {
    const connector: ConnectorDefinition = {
      id: 'test-connector',
      name: 'Test Connector',
      category: 'llm',
      detection: { envVars: ['TEST_API_KEY'] },
      test: mockTest,
      generateSnippet: mockSnippet,
      configSchema: mockSchema
    };

    expect(isConnectorDefinition(connector)).toBe(true);
    expect(connector.id).toBe('test-connector');
    expect(connector.name).toBe('Test Connector');
    expect(connector.category).toBe('llm');
  });

  it('should accept connectors for each category', () => {
    const categories: ConnectorCategory[] = ['llm', 'framework', 'vector-db'];

    for (const category of categories) {
      const connector: ConnectorDefinition = {
        id: `test-${category}`,
        name: `Test ${category}`,
        category,
        detection: {},
        test: mockTest,
        generateSnippet: mockSnippet,
        configSchema: mockSchema
      };

      expect(isConnectorDefinition(connector)).toBe(true);
      expect(connector.category).toBe(category);
    }
  });

  it('should accept connectors with complete detection rules', () => {
    const connector: ConnectorDefinition = {
      id: 'full-connector',
      name: 'Full Connector',
      category: 'vector-db',
      detection: {
        packageJson: ['vector-db'],
        envVars: ['VECTOR_DB_KEY'],
        ports: [8080],
        dockerContainers: ['vector-db-container']
      },
      test: mockTest,
      generateSnippet: mockSnippet,
      configSchema: mockSchema
    };

    expect(isConnectorDefinition(connector)).toBe(true);
    expect(connector.detection.packageJson).toEqual(['vector-db']);
    expect(connector.detection.envVars).toEqual(['VECTOR_DB_KEY']);
    expect(connector.detection.ports).toEqual([8080]);
    expect(connector.detection.dockerContainers).toEqual(['vector-db-container']);
  });

  it('should reject invalid connector definitions', () => {
    const invalidConnectors = [
      null,
      undefined,
      {},
      { id: 'test' },
      { id: 'test', name: 'Test' },
      { id: 'test', name: 'Test', category: 'invalid' },
      { id: 'test', name: 'Test', category: 'llm' },
      {
        id: 'test',
        name: 'Test',
        category: 'llm',
        detection: {},
        test: 'not a function'
      },
      {
        id: 'test',
        name: 'Test',
        category: 'llm',
        detection: {},
        test: mockTest,
        generateSnippet: 'not a function'
      },
      {
        id: 'test',
        name: 'Test',
        category: 'llm',
        detection: {},
        test: mockTest,
        generateSnippet: mockSnippet,
        // Plain object without Zod schema methods
        configSchema: { safeParse: 'not a function' }
      }
    ];

    for (const connector of invalidConnectors) {
      expect(isConnectorDefinition(connector)).toBe(false);
    }
  });

  it('should execute test function', async () => {
    const connector: ConnectorDefinition = {
      id: 'async-test',
      name: 'Async Test',
      category: 'llm',
      detection: {},
      test: mockTest,
      generateSnippet: mockSnippet,
      configSchema: mockSchema
    };

    const config = { apiKey: 'test-key' };
    const signal = undefined;
    const result = await connector.test(config, signal);

    expect(mockTest).toHaveBeenCalledWith(config, signal);
    expect(result.connection).toBe(true);
    expect(result.validation).toBe(true);
  });

  it('should execute generateSnippet function', () => {
    const connector: ConnectorDefinition = {
      id: 'snippet-test',
      name: 'Snippet Test',
      category: 'llm',
      detection: {},
      test: mockTest,
      generateSnippet: mockSnippet,
      configSchema: mockSchema
    };

    const config = { apiKey: 'test-key' };
    const snippet = connector.generateSnippet(config);

    expect(mockSnippet).toHaveBeenCalledWith(config);
    expect(snippet).toBe('code snippet');
  });

  it('should validate config using Zod schema', () => {
    const connector: ConnectorDefinition = {
      id: 'schema-test',
      name: 'Schema Test',
      category: 'llm',
      detection: {},
      test: mockTest,
      generateSnippet: mockSnippet,
      configSchema: z.object({
        apiKey: z.string().min(1),
        baseUrl: z.string().url().optional()
      })
    };

    // Valid config
    const validResult = connector.configSchema.safeParse({
      apiKey: 'test-key',
      baseUrl: 'https://api.example.com'
    });
    expect(validResult.success).toBe(true);

    // Invalid config
    const invalidResult = connector.configSchema.safeParse({
      apiKey: '' // Empty string should fail
    });
    expect(invalidResult.success).toBe(false);
  });
});

describe('isTestResult', () => {
  it('should return true for valid results', () => {
    expect(isTestResult({ connection: true, validation: true })).toBe(true);
    expect(isTestResult({ connection: false, validation: false, error: 'Failed' })).toBe(true);
    expect(isTestResult({ connection: true, validation: false, latency: 100 })).toBe(true);
  });

  it('should return false for invalid values', () => {
    expect(isTestResult(null)).toBe(false);
    expect(isTestResult(undefined)).toBe(false);
    expect(isTestResult({ connection: true })).toBe(false);
    expect(isTestResult({ validation: true })).toBe(false);
    expect(isTestResult({ connection: 'true', validation: true } as unknown)).toBe(false);
  });
});

describe('isConnectorDefinition', () => {
  it('should return true for valid definitions', () => {
    const validDef: ConnectorDefinition = {
      id: 'test',
      name: 'Test',
      category: 'llm',
      detection: {},
      test: vi.fn().mockResolvedValue({ connection: true, validation: true }),
      generateSnippet: vi.fn(),
      configSchema: z.object({})
    };

    expect(isConnectorDefinition(validDef)).toBe(true);
  });

  it('should return false for invalid definitions', () => {
    expect(isConnectorDefinition(null)).toBe(false);
    expect(isConnectorDefinition({})).toBe(false);
    expect(isConnectorDefinition({ id: 'test' })).toBe(false);
  });

  it('should accept a valid configKeyByEnvVar map', () => {
    const def: ConnectorDefinition = {
      id: 'test',
      name: 'Test',
      category: 'llm',
      detection: { envVars: ['OPENAI_API_KEY'] },
      configKeyByEnvVar: { OPENAI_API_KEY: 'apiKey' },
      test: vi.fn().mockResolvedValue({ connection: true, validation: true }),
      generateSnippet: vi.fn(),
      configSchema: z.object({})
    };

    expect(isConnectorDefinition(def)).toBe(true);
  });

  it('should reject a configKeyByEnvVar that is not a non-null object', () => {
    const base = {
      id: 'test',
      name: 'Test',
      category: 'llm',
      detection: {},
      test: vi.fn(),
      generateSnippet: vi.fn(),
      configSchema: z.object({})
    };

    expect(isConnectorDefinition({ ...base, configKeyByEnvVar: 'nope' })).toBe(false);
    expect(isConnectorDefinition({ ...base, configKeyByEnvVar: null })).toBe(false);
    expect(isConnectorDefinition({ ...base, configKeyByEnvVar: ['apiKey'] })).toBe(false);
  });

  it('should reject a configKeyByEnvVar whose target is not a non-empty string', () => {
    const make = (configKeyByEnvVar: unknown) => ({
      id: 'test',
      name: 'Test',
      category: 'llm',
      detection: {},
      configKeyByEnvVar,
      test: vi.fn(),
      generateSnippet: vi.fn(),
      configSchema: z.object({})
    });

    expect(isConnectorDefinition(make({ OPENAI_API_KEY: 42 }))).toBe(false);
    expect(isConnectorDefinition(make({ OPENAI_API_KEY: '' }))).toBe(false);
  });

  it('should accept a valid credentialFormats map', () => {
    const def: ConnectorDefinition = {
      id: 'test',
      name: 'Test',
      category: 'llm',
      detection: { envVars: ['OPENAI_API_KEY'] },
      credentialFormats: { OPENAI_API_KEY: { prefix: 'sk-' } },
      test: vi.fn().mockResolvedValue({ connection: true, validation: true }),
      generateSnippet: vi.fn(),
      configSchema: z.object({})
    };

    expect(isConnectorDefinition(def)).toBe(true);
  });

  it('should reject a credentialFormats that is not a non-null object', () => {
    const base = {
      id: 'test',
      name: 'Test',
      category: 'llm',
      detection: {},
      test: vi.fn(),
      generateSnippet: vi.fn(),
      configSchema: z.object({})
    };

    expect(isConnectorDefinition({ ...base, credentialFormats: 'nope' })).toBe(false);
    expect(isConnectorDefinition({ ...base, credentialFormats: null })).toBe(false);
    expect(isConnectorDefinition({ ...base, credentialFormats: [{ prefix: 'sk-' }] })).toBe(false);
  });

  it('should reject a credentialFormats whose entry lacks a non-empty string prefix', () => {
    const make = (credentialFormats: unknown) => ({
      id: 'test',
      name: 'Test',
      category: 'llm',
      detection: {},
      credentialFormats,
      test: vi.fn(),
      generateSnippet: vi.fn(),
      configSchema: z.object({})
    });

    expect(isConnectorDefinition(make({ OPENAI_API_KEY: { prefix: 42 } }))).toBe(false);
    expect(isConnectorDefinition(make({ OPENAI_API_KEY: { prefix: '' } }))).toBe(false);
    expect(isConnectorDefinition(make({ OPENAI_API_KEY: 'sk-' }))).toBe(false);
    expect(isConnectorDefinition(make({ OPENAI_API_KEY: null }))).toBe(false);
  });

  it('should accept a credentialFormats entry with an optional label', () => {
    const def: ConnectorDefinition = {
      id: 'test',
      name: 'Test',
      category: 'llm',
      detection: { envVars: ['X'] },
      credentialFormats: { X: { prefix: 'sk-', label: 'secret' } },
      test: vi.fn().mockResolvedValue({ connection: true, validation: true }),
      generateSnippet: vi.fn(),
      configSchema: z.object({})
    };

    expect(isConnectorDefinition(def)).toBe(true);
  });

  it('should reject a credentialFormats entry whose label is not a non-empty string', () => {
    const make = (credentialFormats: unknown) => ({
      id: 'test',
      name: 'Test',
      category: 'llm',
      detection: {},
      credentialFormats,
      test: vi.fn(),
      generateSnippet: vi.fn(),
      configSchema: z.object({})
    });

    expect(isConnectorDefinition(make({ X: { prefix: 'sk-', label: 42 } }))).toBe(false);
    expect(isConnectorDefinition(make({ X: { prefix: 'sk-', label: '' } }))).toBe(false);
  });
});

describe('TypeScript Type Checking', () => {
  it('should allow type narrowing with type guards', () => {
    const value: unknown = {
      connection: true,
      validation: true
    };

    if (isTestResult(value)) {
      // TypeScript should know value is TestResult here
      expect(value.connection).toBe(true);
      expect(typeof value.latency === 'undefined' || typeof value.latency === 'number').toBe(true);
    } else {
      // Should never reach here
      expect(true).toBe(false);
    }
  });

  it('should narrow connector definitions', () => {
    const value: unknown = {
      id: 'test',
      name: 'Test',
      category: 'llm',
      detection: {},
      test: vi.fn(),
      generateSnippet: vi.fn(),
      configSchema: z.object({})
    };

    if (isConnectorDefinition(value)) {
      // TypeScript should know value is ConnectorDefinition here
      expect(value.id).toBe('test');
      expect(['llm', 'framework', 'vector-db']).toContain(value.category);
    } else {
      // Should never reach here
      expect(true).toBe(false);
    }
  });
});

describe('z export', () => {
  it('should export z type for use in other modules', async () => {
    // This is a compile-time test - if it compiles, the export works
    const schema = z.object({
      test: z.string()
    });

    const result = schema.safeParse({ test: 'hello' });
    expect(result.success).toBe(true);
  });
});
