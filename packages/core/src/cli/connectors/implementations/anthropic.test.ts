/**
 * Anthropic Connector Tests
 */

import { describe, it, expect } from 'vitest';
import { anthropicConnector } from './anthropic.js';

describe('Anthropic Connector', () => {
  describe('Definition', () => {
    it('should have correct id', () => {
      expect(anthropicConnector.id).toBe('anthropic');
    });

    it('should have correct name', () => {
      expect(anthropicConnector.name).toBe('Anthropic');
    });

    it('should be in llm category', () => {
      expect(anthropicConnector.category).toBe('llm');
    });

    it('should have correct detection rules', () => {
      expect(anthropicConnector.detection.envVars).toContain('ANTHROPIC_API_KEY');
      expect(anthropicConnector.detection.packageJson).toContain('@anthropic-ai/sdk');
    });
  });

  describe('Config Schema', () => {
    it('should accept valid Anthropic API key', () => {
      const result = anthropicConnector.configSchema.safeParse({
        apiKey: 'sk-ant-api123'
      });
      expect(result.success).toBe(true);
    });

    it('should reject API key without sk-ant- prefix', () => {
      const result = anthropicConnector.configSchema.safeParse({
        apiKey: 'sk-1234567890abcdef'
      });
      expect(result.success).toBe(false);
    });

    it('should reject empty string', () => {
      const result = anthropicConnector.configSchema.safeParse({
        apiKey: ''
      });
      expect(result.success).toBe(false);
    });

    it('should reject missing apiKey', () => {
      const result = anthropicConnector.configSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe('Test Function', () => {
    it('should fail without API key', async () => {
      const result = await anthropicConnector.test({});
      expect(result.connection).toBe(false);
      expect(result.validation).toBe(false);
      expect(result.error).toBe('API key is required');
    });

    it('should fail with empty API key', async () => {
      const result = await anthropicConnector.test({ apiKey: '' });
      expect(result.connection).toBe(false);
      expect(result.validation).toBe(false);
    });
  });

  describe('Code Snippet Generation', () => {
    it('should generate valid code snippet', () => {
      const snippet = anthropicConnector.generateSnippet({ apiKey: 'sk-ant-test' });
      expect(snippet).toContain('GuardrailEngine');
      expect(snippet).toContain('anthropicConnector');
      expect(snippet).toContain('ANTHROPIC_API_KEY');
    });

    it('should not include actual API key in snippet', () => {
      const snippet = anthropicConnector.generateSnippet({ apiKey: 'sk-ant-secret-key' });
      expect(snippet).not.toContain('sk-ant-secret-key');
    });
  });
});
