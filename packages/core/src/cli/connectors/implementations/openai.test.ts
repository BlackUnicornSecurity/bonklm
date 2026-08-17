/**
 * OpenAI Connector Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { openaiConnector } from './openai.js';

describe('OpenAI Connector', () => {
  describe('Definition', () => {
    it('should have correct id', () => {
      expect(openaiConnector.id).toBe('openai');
    });

    it('should have correct name', () => {
      expect(openaiConnector.name).toBe('OpenAI');
    });

    it('should be in llm category', () => {
      expect(openaiConnector.category).toBe('llm');
    });

    it('should have correct detection rules', () => {
      expect(openaiConnector.detection.envVars).toContain('OPENAI_API_KEY');
      expect(openaiConnector.detection.packageJson).toContain('openai');
    });
  });

  describe('Config Schema', () => {
    it('should accept valid OpenAI API key', () => {
      const result = openaiConnector.configSchema.safeParse({
        apiKey: 'sk-1234567890abcdef'
      });
      expect(result.success).toBe(true);
    });

    it('should reject API key without sk- prefix', () => {
      const result = openaiConnector.configSchema.safeParse({
        apiKey: 'invalid-key'
      });
      expect(result.success).toBe(false);
    });

    it('should reject empty string', () => {
      const result = openaiConnector.configSchema.safeParse({
        apiKey: ''
      });
      expect(result.success).toBe(false);
    });

    it('should reject missing apiKey', () => {
      const result = openaiConnector.configSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe('Test Function', () => {
    it('should fail without API key', async () => {
      const result = await openaiConnector.test({});
      expect(result.connection).toBe(false);
      expect(result.validation).toBe(false);
      expect(result.error).toBe('API key is required');
    });

    it('should fail with empty API key', async () => {
      const result = await openaiConnector.test({ apiKey: '' });
      expect(result.connection).toBe(false);
      expect(result.validation).toBe(false);
    });
  });

  describe('Code Snippet Generation', () => {
    it('should generate valid code snippet', () => {
      const snippet = openaiConnector.generateSnippet({ apiKey: 'sk-test' });
      expect(snippet).toContain('GuardrailEngine');
      expect(snippet).toContain('openaiConnector');
      expect(snippet).toContain('OPENAI_API_KEY');
    });

    it('should not include actual API key in snippet', () => {
      const snippet = openaiConnector.generateSnippet({ apiKey: 'sk-secret-key' });
      expect(snippet).not.toContain('sk-secret-key');
    });
  });
});
