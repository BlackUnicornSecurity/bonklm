/**
 * LangChain Connector Tests
 */

import { describe, it, expect } from 'vitest';
import { langchainConnector } from './langchain.js';

describe('LangChain Connector', () => {
  describe('Definition', () => {
    it('should have correct id', () => {
      expect(langchainConnector.id).toBe('langchain');
    });

    it('should have correct name', () => {
      expect(langchainConnector.name).toBe('LangChain');
    });

    it('should be in framework category', () => {
      expect(langchainConnector.category).toBe('framework');
    });

    it('should have packageJson detection for langchain', () => {
      expect(langchainConnector.detection.packageJson).toContain('langchain');
    });

    it('should have packageJson detection for @langchain/core', () => {
      expect(langchainConnector.detection.packageJson).toContain('@langchain/core');
    });
  });

  describe('Config Schema', () => {
    it('should accept boolean blockOnFlag', () => {
      const result = langchainConnector.configSchema.safeParse({
        blockOnFlag: true
      });
      expect(result.success).toBe(true);
    });

    it('should accept empty config', () => {
      const result = langchainConnector.configSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should accept optional blockOnFlag', () => {
      const result = langchainConnector.configSchema.safeParse({
        blockOnFlag: undefined
      });
      expect(result.success).toBe(true);
    });
  });

  describe('Test Function', () => {
    it('should always succeed (framework connector)', async () => {
      const result = await langchainConnector.test({});
      expect(result.connection).toBe(true);
      expect(result.validation).toBe(true);
    });

    it('should succeed with any config', async () => {
      const result = await langchainConnector.test({
        blockOnFlag: true
      });
      expect(result.connection).toBe(true);
      expect(result.validation).toBe(true);
    });
  });

  describe('Code Snippet Generation', () => {
    it('should generate valid LangChain callback handler snippet', () => {
      const snippet = langchainConnector.generateSnippet({});
      expect(snippet).toContain('BaseCallbackHandler');
      expect(snippet).toContain('GuardrailCallbackHandler');
      expect(snippet).toContain('GuardrailEngine');
    });

    it('should include handleLLMStart method', () => {
      const snippet = langchainConnector.generateSnippet({});
      expect(snippet).toContain('handleLLMStart');
    });

    it('should show ChatOpenAI usage example', () => {
      const snippet = langchainConnector.generateSnippet({});
      expect(snippet).toContain('ChatOpenAI');
    });
  });
});
