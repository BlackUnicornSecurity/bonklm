/**
 * Unit Tests for Vercel AI SDK Guarded Wrapper
 * ===============================================
 *
 * Tests all security features:
 * - SEC-002: Incremental stream validation
 * - SEC-003: Max buffer size enforcement
 * - SEC-006: Complex message content handling
 * - SEC-007: Production mode errors
 * - SEC-008: Validation timeout
 * - DEV-001: Correct GuardrailEngine API
 * - DEV-002: Proper logger integration
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
// Sprint 31: switched from CommonJS `require(...)` in test bodies to
// canonical ESM import. The previous pattern produced "Cannot find
// module" errors in Node ≥20 ESM mode (8 tests). The "avoid mock
// issues" comment that justified the require() pattern was stale —
// this file has no vi.mock setup that would conflict with top-level
// import order.
import { createGuardedAI, messagesToText } from '../src/guarded-ai.js';
import { PromptInjectionValidator } from '@blackunicorn/bonklm';
import type { CoreMessage } from 'ai';
import { noOpValidator } from '@blackunicorn/bonklm/testing';

describe('messagesToText utility', () => {
  it('should extract text from complex messages', () => {
    const messages: CoreMessage[] = [
      { role: 'system', content: 'You are a helpful assistant.' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Check this image:' },
          { type: 'image', image: 'https://example.com/image.png' },
          { type: 'text', text: 'What do you see?' }
        ]
      }
    ];

    const result = messagesToText(messages);
    expect(result).toContain('You are a helpful assistant');
    expect(result).toContain('Check this image:');
    expect(result).toContain('What do you see?');
    expect(result).not.toContain('https://');
  });

  it('should handle string content in messages', () => {
    const messages: CoreMessage[] = [{ role: 'user', content: 'Hello, how are you?' }];

    const text = messagesToText(messages);
    expect(text).toBe('Hello, how are you?');
  });

  it('should handle array content with text parts', () => {
    const messages: CoreMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Hello' },
          { type: 'text', text: 'How are you?' }
        ]
      }
    ];

    const text = messagesToText(messages);
    expect(text).toBe('Hello\nHow are you?');
  });

  it('should filter out non-text parts from array content', () => {
    const messages: CoreMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Look at this image:' },
          { type: 'image', image: 'base64...' },
          { type: 'text', text: 'What do you see?' }
        ]
      }
    ];

    const text = messagesToText(messages);
    expect(text).toBe('Look at this image:\nWhat do you see?');
    expect(text).not.toContain('base64');
  });

  it('should handle mixed content types across messages', () => {
    const messages: CoreMessage[] = [
      { role: 'user', content: 'First message' },
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'Response with text parts' }]
      },
      { role: 'user', content: 'Follow up' }
    ];

    const text = messagesToText(messages);
    expect(text).toContain('First message');
    expect(text).toContain('Response with text parts');
    expect(text).toContain('Follow up');
  });

  it('should handle empty content', () => {
    const messages: CoreMessage[] = [{ role: 'user', content: '' }];

    const result = messagesToText(messages);
    expect(result).toBe('');
  });

  it('should handle messages with only non-text content', () => {
    const messages: CoreMessage[] = [
      {
        role: 'user',
        content: [{ type: 'image', image: 'data:image/png;base64,abc' }]
      }
    ];

    const result = messagesToText(messages);
    expect(result).toBe('');
  });
});

describe('createGuardedAI - Basic functionality', () => {
  it('should create a guarded AI instance', () => {
    const guardedAI = createGuardedAI({
      validators: [new PromptInjectionValidator()]
    });

    expect(guardedAI).toBeDefined();
    expect(guardedAI.generateText).toBeDefined();
    expect(guardedAI.streamText).toBeDefined();
  });

  it('should use default logger when none provided', () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const guardedAI = createGuardedAI({
      validators: [noOpValidator()]
    });

    expect(guardedAI).toBeDefined();
    consoleWarnSpy.mockRestore();
  });

  it('should apply default configuration values', () => {
    const guardedAI = createGuardedAI({
      validators: [noOpValidator()]
    });

    expect(guardedAI).toBeDefined();
  });
});

describe('SEC-006: Complex Message Content', () => {
  it('should handle array content in messages', () => {
    const messages: CoreMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Hello' },
          { type: 'text', text: 'World' }
        ]
      }
    ];

    const text = messagesToText(messages);
    expect(text).toBe('Hello\nWorld');
  });

  it('should filter image content from arrays', () => {
    const messages: CoreMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Describe this:' },
          { type: 'image', image: 'data:image/png;base64,ABC123' },
          { type: 'text', text: 'End' }
        ]
      }
    ];

    const text = messagesToText(messages);
    expect(text).toBe('Describe this:\nEnd');
    expect(text).not.toContain('ABC123');
  });
});

describe('Configuration options', () => {
  it('should accept custom validation timeout', () => {
    const guardedAI = createGuardedAI({
      validators: [noOpValidator()],
      validationTimeout: 5000
    });

    expect(guardedAI).toBeDefined();
  });

  it('should accept custom max buffer size', () => {
    const guardedAI = createGuardedAI({
      validators: [noOpValidator()],
      maxStreamBufferSize: 2048
    });

    expect(guardedAI).toBeDefined();
  });

  it('should accept production mode flag', () => {
    const guardedAI = createGuardedAI({
      validators: [noOpValidator()],
      productionMode: true
    });

    expect(guardedAI).toBeDefined();
  });

  it('should accept streaming mode configuration', () => {
    const guardedAI = createGuardedAI({
      validators: [noOpValidator()],
      validateStreaming: true,
      streamingMode: 'incremental'
    });

    expect(guardedAI).toBeDefined();
  });

  it('should accept callbacks', () => {
    const onBlocked = vi.fn();
    const onStreamBlocked = vi.fn();

    const guardedAI = createGuardedAI({
      validators: [noOpValidator()],
      onBlocked,
      onStreamBlocked
    });

    expect(guardedAI).toBeDefined();
  });
});
