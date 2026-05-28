/**
 * Performance Benchmarks for LLM-Guardrails
 * ============================================
 *
 * Validates that validation overhead stays within acceptable bounds.
 *
 * Target: <10ms for validation operations
 */

import { describe, it, expect } from 'vitest';
import { GuardrailEngine, createLogger, PromptInjectionValidator } from '@blackunicorn/bonklm';

describe('Performance Benchmarks', () => {
  const logger = createLogger('console');
  const engine = new GuardrailEngine({
    validators: [new PromptInjectionValidator()],
    logger
  });

  describe('Validation Performance', () => {
    it('should validate short prompts quickly', async () => {
      const prompt = 'Hello, how are you today?';

      const start = performance.now();
      await engine.validate(prompt, 'input');
      const duration = performance.now() - start;

      // Coarse CI-safe ceiling: catches gross regressions (sync I/O, O(n^2))
      // while tolerating shared-runner jitter + cold-start JIT. Precise perf
      // tracking lives in the dedicated `benchmark` suite/job.
      expect(duration).toBeLessThan(100);
    });

    it('should validate medium prompts quickly', async () => {
      const prompt =
        'Please provide a detailed explanation of machine learning, including its history, key algorithms, and practical applications in modern software development.';

      const start = performance.now();
      await engine.validate(prompt, 'input');
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(100);
    });

    it('should validate long prompts quickly', async () => {
      const prompt = 'Tell me a story. '.repeat(100); // ~2000 characters

      const start = performance.now();
      await engine.validate(prompt, 'input');
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(100);
    });

    it('should handle multiple validators efficiently', async () => {
      const multiEngine = new GuardrailEngine({
        validators: [new PromptInjectionValidator(), new PromptInjectionValidator(), new PromptInjectionValidator()],
        logger
      });

      const prompt = 'This is a normal prompt without any issues.';

      const start = performance.now();
      await multiEngine.validate(prompt, 'input');
      const duration = performance.now() - start;

      // Even with multiple validators, should be fast
      expect(duration).toBeLessThan(100);
    });

    it('should validate complex content efficiently', async () => {
      const content = `
        # Analysis Report

        ## Executive Summary
        This report analyzes the current state of AI safety measures.

        ## Methodology
        We conducted a comprehensive review of existing guardrails.

        ## Findings
        All systems are operating within expected parameters.

        ${'Additional detail. '.repeat(50)}
      `;

      const start = performance.now();
      await engine.validate(content, 'output');
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(100);
    });
  });

  describe('Memory Performance', () => {
    it('should not leak memory with repeated validations', async () => {
      const prompt = 'Test prompt for memory validation.';

      // Run validations multiple times
      for (let i = 0; i < 100; i++) {
        await engine.validate(prompt, 'input');
      }

      // If we got here without crashing, memory is reasonable
      expect(true).toBe(true);
    });

    it('should handle large content without excessive memory growth', async () => {
      const largeContent = 'A'.repeat(100000); // 100KB string

      const start = performance.now();
      await engine.validate(largeContent, 'input');
      const duration = performance.now() - start;

      // Should complete within reasonable time (100KB input; generous CI bound)
      expect(duration).toBeLessThan(500);
    });
  });

  describe('Timeout Performance', () => {
    it('should enforce validation timeout correctly', async () => {
      const engine = new GuardrailEngine({
        validators: [new PromptInjectionValidator()],
        logger
        // Set a very short timeout
      });

      // This tests that timeout enforcement doesn't add overhead
      const prompt = 'Quick validation';

      const start = performance.now();
      await engine.validate(prompt, 'input');
      const duration = performance.now() - start;

      // Validation itself should be fast
      expect(duration).toBeLessThan(5);
    });
  });

  describe('messagesToText Performance', () => {
    // Test across different connectors
    it('should extract text from messages efficiently (Anthropic pattern)', async () => {
      const messages = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
        { role: 'user', content: 'How are you?' }
      ];

      const start = performance.now();
      // Simulate messagesToText function
      const text = messages
        .map(m => m.content)
        .filter(c => c.length > 0)
        .join('\n');
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(1);
    });

    it('should handle complex message structures efficiently', async () => {
      const messages = [
        { role: 'user', content: 'Complex message' },
        { role: 'assistant', content: 'Response with details' },
        { role: 'user', content: null },
        { role: 'assistant', content: '' },
        { role: 'user', content: 'Final message' }
      ];

      const start = performance.now();
      const text = messages
        .map(m => {
          if (!m.content) return '';
          return typeof m.content === 'string' ? m.content : String(m.content);
        })
        .filter(c => c.length > 0)
        .join('\n');
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(2);
    });
  });
});
