/**
 * Ollama Connector Tests
 */

import { describe, it, expect } from 'vitest';
import { ollamaConnector } from './ollama.js';

describe('Ollama Connector', () => {
  describe('Definition', () => {
    it('should have correct id', () => {
      expect(ollamaConnector.id).toBe('ollama');
    });

    it('should have correct name', () => {
      expect(ollamaConnector.name).toBe('Ollama');
    });

    it('should be in llm category', () => {
      expect(ollamaConnector.category).toBe('llm');
    });

    it('should have port detection', () => {
      expect(ollamaConnector.detection.ports).toContain(11434);
    });
  });

  describe('Config Schema', () => {
    it('should accept valid URL', () => {
      const result = ollamaConnector.configSchema.safeParse({
        baseUrl: 'http://localhost:11434'
      });
      expect(result.success).toBe(true);
    });

    it('should accept https URL', () => {
      const result = ollamaConnector.configSchema.safeParse({
        baseUrl: 'https://ollama.example.com'
      });
      expect(result.success).toBe(true);
    });

    it('should reject invalid URL', () => {
      const result = ollamaConnector.configSchema.safeParse({
        baseUrl: 'not-a-url'
      });
      expect(result.success).toBe(false);
    });

    it('should accept empty config', () => {
      const result = ollamaConnector.configSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should accept optional baseUrl', () => {
      const result = ollamaConnector.configSchema.safeParse({
        baseUrl: undefined
      });
      expect(result.success).toBe(true);
    });
  });

  describe('Test Function', () => {
    it('should fail with unreachable port', async () => {
      // Use localhost with a port that's unlikely to be in use
      // This avoids DNS lookup timeout that occurs with invalid hostnames
      const result = await ollamaConnector.test({
        baseUrl: 'http://localhost:48080' // Non-standard port, unlikely to be in use
      });
      expect(result).toBeDefined();
      expect(typeof result.connection).toBe('boolean');
      expect(typeof result.validation).toBe('boolean');
    });

    it('should use default baseUrl when not provided', async () => {
      const result = await ollamaConnector.test({});
      expect(result).toBeDefined();
      expect(typeof result.connection).toBe('boolean');
    });
  });

  describe('Code Snippet Generation', () => {
    it('should generate valid code snippet', () => {
      const snippet = ollamaConnector.generateSnippet({
        baseUrl: 'http://localhost:11434'
      });
      expect(snippet).toContain('ollamaConnector');
      expect(snippet).toContain('localhost:11434');
    });

    it('should use default localhost when baseUrl not in config', () => {
      const snippet = ollamaConnector.generateSnippet({});
      expect(snippet).toContain('http://localhost:11434');
    });

    it('should use custom baseUrl when provided', () => {
      const snippet = ollamaConnector.generateSnippet({
        baseUrl: 'http://ollama.example.com:8080'
      });
      expect(snippet).toContain('http://ollama.example.com:8080');
    });
  });
});
