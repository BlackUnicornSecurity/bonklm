/**
 * Express Connector Tests
 */

import { describe, it, expect } from 'vitest';
import { expressConnector } from './express.js';

describe('Express Connector', () => {
  describe('Definition', () => {
    it('should have correct id', () => {
      expect(expressConnector.id).toBe('express');
    });

    it('should have correct name', () => {
      expect(expressConnector.name).toBe('Express');
    });

    it('should be in framework category', () => {
      expect(expressConnector.category).toBe('framework');
    });

    it('should have packageJson detection', () => {
      expect(expressConnector.detection.packageJson).toContain('express');
    });
  });

  describe('Config Schema', () => {
    it('should accept boolean validateOnRequest', () => {
      const result = expressConnector.configSchema.safeParse({
        validateOnRequest: true
      });
      expect(result.success).toBe(true);
    });

    it('should accept empty config', () => {
      const result = expressConnector.configSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should accept optional validateOnRequest', () => {
      const result = expressConnector.configSchema.safeParse({
        validateOnRequest: undefined
      });
      expect(result.success).toBe(true);
    });
  });

  describe('Test Function', () => {
    it('should always succeed (framework connector)', async () => {
      const result = await expressConnector.test({});
      expect(result.connection).toBe(true);
      expect(result.validation).toBe(true);
    });

    it('should succeed with any config', async () => {
      const result = await expressConnector.test({
        validateOnRequest: true
      });
      expect(result.connection).toBe(true);
      expect(result.validation).toBe(true);
    });
  });

  describe('Code Snippet Generation', () => {
    it('should generate valid Express middleware snippet', () => {
      const snippet = expressConnector.generateSnippet({});
      expect(snippet).toContain('express');
      expect(snippet).toContain('expressMiddleware');
      expect(snippet).toContain('GuardrailEngine');
      expect(snippet).toContain('app.listen');
    });

    it('should include middleware usage pattern', () => {
      const snippet = expressConnector.generateSnippet({});
      expect(snippet).toContain('app.use(expressMiddleware(guardrails))');
    });
  });
});
