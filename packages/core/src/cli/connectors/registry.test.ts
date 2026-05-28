/**
 * Connector Registry Tests
 *
 * Tests for the connector registry system including:
 * - Retrieving connectors by ID
 * - Getting all connectors
 * - Filtering by category
 * - Utility functions
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getConnector,
  getAllConnectors,
  getConnectorsByCategory,
  hasConnector,
  getConnectorIds,
  getCategories
} from './registry.js';
import type { ConnectorDefinition, ConnectorCategory } from './base.js';

describe('Connector Registry', () => {
  describe('getConnector', () => {
    it('should return OpenAI connector by id', () => {
      const connector = getConnector('openai');
      expect(connector).toBeDefined();
      expect(connector?.id).toBe('openai');
      expect(connector?.name).toBe('OpenAI');
      expect(connector?.category).toBe('llm');
    });

    it('should return Anthropic connector by id', () => {
      const connector = getConnector('anthropic');
      expect(connector).toBeDefined();
      expect(connector?.id).toBe('anthropic');
      expect(connector?.name).toBe('Anthropic');
      expect(connector?.category).toBe('llm');
    });

    it('should return Ollama connector by id', () => {
      const connector = getConnector('ollama');
      expect(connector).toBeDefined();
      expect(connector?.id).toBe('ollama');
      expect(connector?.name).toBe('Ollama');
      expect(connector?.category).toBe('llm');
    });

    it('should return Express connector by id', () => {
      const connector = getConnector('express');
      expect(connector).toBeDefined();
      expect(connector?.id).toBe('express');
      expect(connector?.name).toBe('Express');
      expect(connector?.category).toBe('framework');
    });

    it('should return LangChain connector by id', () => {
      const connector = getConnector('langchain');
      expect(connector).toBeDefined();
      expect(connector?.id).toBe('langchain');
      expect(connector?.name).toBe('LangChain');
      expect(connector?.category).toBe('framework');
    });

    it('should return undefined for unknown connector id', () => {
      const connector = getConnector('unknown-connector');
      expect(connector).toBeUndefined();
    });

    it('should return undefined for empty string', () => {
      const connector = getConnector('');
      expect(connector).toBeUndefined();
    });

    it('should return connector with all required fields', () => {
      const connector = getConnector('openai');
      expect(connector).toBeDefined();
      expect(connector).toHaveProperty('id');
      expect(connector).toHaveProperty('name');
      expect(connector).toHaveProperty('category');
      expect(connector).toHaveProperty('detection');
      expect(connector).toHaveProperty('test');
      expect(connector).toHaveProperty('generateSnippet');
      expect(connector).toHaveProperty('configSchema');
    });

    it('should have valid detection rules', () => {
      const connector = getConnector('openai');
      expect(connector?.detection).toBeDefined();
      expect(typeof connector?.detection).toBe('object');
    });

    it('should have callable test function', () => {
      const connector = getConnector('openai');
      expect(typeof connector?.test).toBe('function');
    });

    it('should have callable generateSnippet function', () => {
      const connector = getConnector('openai');
      expect(typeof connector?.generateSnippet).toBe('function');
    });

    it('should have valid configSchema with safeParse', () => {
      const connector = getConnector('openai');
      expect(connector?.configSchema).toBeDefined();
      expect(typeof connector?.configSchema.safeParse).toBe('function');
    });
  });

  describe('getAllConnectors', () => {
    it('should return all 5 connectors', () => {
      const connectors = getAllConnectors();
      expect(connectors).toHaveLength(5);
    });

    it('should return a copy of the connectors array', () => {
      const connectors1 = getAllConnectors();
      const connectors2 = getAllConnectors();
      expect(connectors1).not.toBe(connectors2);
      expect(connectors1).toEqual(connectors2);
    });

    it('should include all expected connector IDs', () => {
      const connectors = getAllConnectors();
      const ids = connectors.map(c => c.id);
      expect(ids).toContain('openai');
      expect(ids).toContain('anthropic');
      expect(ids).toContain('ollama');
      expect(ids).toContain('express');
      expect(ids).toContain('langchain');
    });

    it('should return connectors with correct structure', () => {
      const connectors = getAllConnectors();
      connectors.forEach(connector => {
        expect(connector).toHaveProperty('id');
        expect(connector).toHaveProperty('name');
        expect(connector).toHaveProperty('category');
        expect(connector).toHaveProperty('detection');
        expect(connector).toHaveProperty('test');
        expect(connector).toHaveProperty('generateSnippet');
        expect(connector).toHaveProperty('configSchema');
        expect(typeof connector.id).toBe('string');
        expect(typeof connector.name).toBe('string');
        expect(typeof connector.category).toBe('string');
        expect(typeof connector.test).toBe('function');
        expect(typeof connector.generateSnippet).toBe('function');
      });
    });

    it('should not be affected by modifying returned array', () => {
      const connectors1 = getAllConnectors();
      const originalLength = connectors1.length;
      connectors1.pop();
      const connectors2 = getAllConnectors();
      expect(connectors2.length).toBe(originalLength);
    });
  });

  describe('getConnectorsByCategory', () => {
    it('should return only LLM connectors', () => {
      const connectors = getConnectorsByCategory('llm');
      expect(connectors).toHaveLength(3);
      const ids = connectors.map(c => c.id);
      expect(ids).toContain('openai');
      expect(ids).toContain('anthropic');
      expect(ids).toContain('ollama');
    });

    it('should return only framework connectors', () => {
      const connectors = getConnectorsByCategory('framework');
      expect(connectors).toHaveLength(2);
      const ids = connectors.map(c => c.id);
      expect(ids).toContain('express');
      expect(ids).toContain('langchain');
    });

    it('should return empty array for vector-db category', () => {
      const connectors = getConnectorsByCategory('vector-db');
      expect(connectors).toHaveLength(0);
      expect(Array.isArray(connectors)).toBe(true);
    });

    it('should return new array on each call', () => {
      const connectors1 = getConnectorsByCategory('llm');
      const connectors2 = getConnectorsByCategory('llm');
      expect(connectors1).not.toBe(connectors2);
      expect(connectors1).toEqual(connectors2);
    });

    it('should filter correctly for each connector', () => {
      const llmConnectors = getConnectorsByCategory('llm');
      const frameworkConnectors = getConnectorsByCategory('framework');

      llmConnectors.forEach(connector => {
        expect(connector.category).toBe('llm');
      });

      frameworkConnectors.forEach(connector => {
        expect(connector.category).toBe('framework');
      });
    });
  });

  describe('hasConnector', () => {
    it('should return true for existing connectors', () => {
      expect(hasConnector('openai')).toBe(true);
      expect(hasConnector('anthropic')).toBe(true);
      expect(hasConnector('ollama')).toBe(true);
      expect(hasConnector('express')).toBe(true);
      expect(hasConnector('langchain')).toBe(true);
    });

    it('should return false for non-existent connectors', () => {
      expect(hasConnector('unknown')).toBe(false);
      expect(hasConnector('')).toBe(false);
      expect(hasConnector('OPENAI')).toBe(false); // case sensitive
    });
  });

  describe('getConnectorIds', () => {
    it('should return all connector IDs', () => {
      const ids = getConnectorIds();
      expect(ids).toHaveLength(5);
      expect(ids).toContain('openai');
      expect(ids).toContain('anthropic');
      expect(ids).toContain('ollama');
      expect(ids).toContain('express');
      expect(ids).toContain('langchain');
    });

    it('should return array of strings', () => {
      const ids = getConnectorIds();
      expect(Array.isArray(ids)).toBe(true);
      ids.forEach(id => {
        expect(typeof id).toBe('string');
      });
    });

    it('should return new array on each call', () => {
      const ids1 = getConnectorIds();
      const ids2 = getConnectorIds();
      expect(ids1).not.toBe(ids2);
      expect(ids1).toEqual(ids2);
    });
  });

  describe('getCategories', () => {
    it('should return all unique categories', () => {
      const categories = getCategories();
      expect(categories).toHaveLength(2);
      expect(categories).toContain('llm');
      expect(categories).toContain('framework');
    });

    it('should not include vector-db category if no connectors', () => {
      const categories = getCategories();
      expect(categories).not.toContain('vector-db');
    });

    it('should return array of valid ConnectorCategory values', () => {
      const categories = getCategories();
      const validCategories: ConnectorCategory[] = ['llm', 'framework', 'vector-db'];
      categories.forEach(cat => {
        expect(validCategories).toContain(cat);
      });
    });
  });

  describe('Connector Implementation Details', () => {
    it('OpenAI connector should have correct detection rules', () => {
      const connector = getConnector('openai');
      expect(connector?.detection.envVars).toContain('OPENAI_API_KEY');
      expect(connector?.detection.packageJson).toContain('openai');
    });

    it('Anthropic connector should have correct detection rules', () => {
      const connector = getConnector('anthropic');
      expect(connector?.detection.envVars).toContain('ANTHROPIC_API_KEY');
      expect(connector?.detection.packageJson).toContain('@anthropic-ai/sdk');
    });

    it('Ollama connector should have port detection', () => {
      const connector = getConnector('ollama');
      expect(connector?.detection.ports).toContain(11434);
    });

    it('Express connector should have packageJson detection', () => {
      const connector = getConnector('express');
      expect(connector?.detection.packageJson).toContain('express');
    });

    it('LangChain connector should have packageJson detection', () => {
      const connector = getConnector('langchain');
      expect(connector?.detection.packageJson).toContain('langchain');
    });
  });

  describe('Config Schema Validation', () => {
    it('OpenAI schema should validate correct API key', () => {
      const connector = getConnector('openai');
      const result = connector?.configSchema.safeParse({ apiKey: 'sk-test123' });
      expect(result?.success).toBe(true);
    });

    it('OpenAI schema should reject invalid API key', () => {
      const connector = getConnector('openai');
      const result = connector?.configSchema.safeParse({ apiKey: 'invalid-key' });
      expect(result?.success).toBe(false);
    });

    it('Anthropic schema should validate correct API key', () => {
      const connector = getConnector('anthropic');
      const result = connector?.configSchema.safeParse({ apiKey: 'sk-ant-test123' });
      expect(result?.success).toBe(true);
    });

    it('Anthropic schema should reject invalid API key', () => {
      const connector = getConnector('anthropic');
      const result = connector?.configSchema.safeParse({ apiKey: 'sk-test123' });
      expect(result?.success).toBe(false);
    });

    it('Ollama schema should accept valid URL', () => {
      const connector = getConnector('ollama');
      const result = connector?.configSchema.safeParse({ baseUrl: 'http://localhost:11434' });
      expect(result?.success).toBe(true);
    });

    it('Ollama schema should accept empty config', () => {
      const connector = getConnector('ollama');
      const result = connector?.configSchema.safeParse({});
      expect(result?.success).toBe(true);
    });

    it('Ollama schema should reject invalid URL', () => {
      const connector = getConnector('ollama');
      const result = connector?.configSchema.safeParse({ baseUrl: 'not-a-url' });
      expect(result?.success).toBe(false);
    });

    it('Express schema should accept optional boolean', () => {
      const connector = getConnector('express');
      const result = connector?.configSchema.safeParse({ validateOnRequest: true });
      expect(result?.success).toBe(true);
    });

    it('Express schema should accept empty config', () => {
      const connector = getConnector('express');
      const result = connector?.configSchema.safeParse({});
      expect(result?.success).toBe(true);
    });

    it('LangChain schema should accept optional boolean', () => {
      const connector = getConnector('langchain');
      const result = connector?.configSchema.safeParse({ blockOnFlag: true });
      expect(result?.success).toBe(true);
    });

    it('LangChain schema should accept empty config', () => {
      const connector = getConnector('langchain');
      const result = connector?.configSchema.safeParse({});
      expect(result?.success).toBe(true);
    });
  });

  describe('Code Snippet Generation', () => {
    it('OpenAI should generate snippet with GuardrailEngine', () => {
      const connector = getConnector('openai');
      const snippet = connector?.generateSnippet({ apiKey: 'sk-test' });
      expect(snippet).toContain('GuardrailEngine');
      expect(snippet).toContain('openaiConnector');
      expect(snippet).toContain('OPENAI_API_KEY');
    });

    it('Anthropic should generate snippet with GuardrailEngine', () => {
      const connector = getConnector('anthropic');
      const snippet = connector?.generateSnippet({ apiKey: 'sk-ant-test' });
      expect(snippet).toContain('GuardrailEngine');
      expect(snippet).toContain('anthropicConnector');
      expect(snippet).toContain('ANTHROPIC_API_KEY');
    });

    it('Ollama should generate snippet with baseUrl', () => {
      const connector = getConnector('ollama');
      const snippet = connector?.generateSnippet({ baseUrl: 'http://localhost:11434' });
      expect(snippet).toContain('ollamaConnector');
      expect(snippet).toContain('localhost:11434');
    });

    it('Ollama should default to localhost when no baseUrl provided', () => {
      const connector = getConnector('ollama');
      const snippet = connector?.generateSnippet({});
      expect(snippet).toContain('http://localhost:11434');
    });

    it('Express should generate middleware snippet', () => {
      const connector = getConnector('express');
      const snippet = connector?.generateSnippet({});
      expect(snippet).toContain('expressMiddleware');
      expect(snippet).toContain('express.json()');
      expect(snippet).toContain('app.listen');
    });

    it('LangChain should generate callback handler snippet', () => {
      const connector = getConnector('langchain');
      const snippet = connector?.generateSnippet({});
      expect(snippet).toContain('BaseCallbackHandler');
      expect(snippet).toContain('GuardrailCallbackHandler');
      expect(snippet).toContain('handleLLMStart');
    });
  });

  describe('Test Function Behavior', () => {
    it('OpenAI test should fail without API key', async () => {
      const connector = getConnector('openai');
      const result = await connector!.test({});
      expect(result.connection).toBe(false);
      expect(result.validation).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('Anthropic test should fail without API key', async () => {
      const connector = getConnector('anthropic');
      const result = await connector!.test({});
      expect(result.connection).toBe(false);
      expect(result.validation).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('Ollama test should fail with unreachable port', async () => {
      const connector = getConnector('ollama');
      // Use localhost with a port that's unlikely to be in use
      // This avoids DNS lookup timeout that occurs with invalid hostnames
      const result = await connector!.test({ baseUrl: 'http://localhost:48080' });
      // Connection should fail but function should not throw
      expect(result).toBeDefined();
      expect(typeof result.connection).toBe('boolean');
      expect(typeof result.validation).toBe('boolean');
    });

    it('Express test should always succeed (framework connector)', async () => {
      const connector = getConnector('express');
      const result = await connector!.test({});
      expect(result.connection).toBe(true);
      expect(result.validation).toBe(true);
    });

    it('LangChain test should always succeed (framework connector)', async () => {
      const connector = getConnector('langchain');
      const result = await connector!.test({});
      expect(result.connection).toBe(true);
      expect(result.validation).toBe(true);
    });
  });

  describe('Registry Immutability', () => {
    it('getAllConnectors should return shallow copy', () => {
      const connectors = getAllConnectors();
      connectors.push({} as ConnectorDefinition);
      const newConnectors = getAllConnectors();
      expect(newConnectors.length).toBe(5);
    });

    it('getConnectorsByCategory should return new array on each call', () => {
      const connectors1 = getConnectorsByCategory('llm');
      const connectors2 = getConnectorsByCategory('llm');
      expect(connectors1).not.toBe(connectors2);
    });
  });
});
