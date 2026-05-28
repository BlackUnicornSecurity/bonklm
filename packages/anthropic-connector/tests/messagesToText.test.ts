/**
 * Unit Tests for messagesToText Utility
 * ====================================
 *
 * Tests the SEC-006: Complex message content handling feature.
 * This utility is critical for preventing validation bypass when
 * messages contain structured data, images, or other complex content.
 */

import { describe, it, expect } from 'vitest';
import { messagesToText } from '../src/guarded-anthropic';
import type { MessageParam } from '@anthropic-ai/sdk';

describe('messagesToText Utility', () => {
  describe('String Content', () => {
    it('should extract text from simple string messages', () => {
      const messages: MessageParam[] = [{ role: 'user', content: 'Hello world' }];

      const result = messagesToText(messages);
      expect(result).toBe('Hello world');
    });

    it('should join multiple string messages with newlines', () => {
      const messages: MessageParam[] = [
        { role: 'user', content: 'First message' },
        { role: 'assistant', content: 'Second message' },
        { role: 'user', content: 'Third message' }
      ];

      const result = messagesToText(messages);
      expect(result).toBe('First message\nSecond message\nThird message');
    });

    it('should handle empty string content', () => {
      const messages: MessageParam[] = [{ role: 'user', content: '' }];

      const result = messagesToText(messages);
      expect(result).toBe('');
    });

    it('should handle special characters in string content', () => {
      const messages: MessageParam[] = [{ role: 'user', content: 'Hello\nWorld\t!@#$%^&*()' }];

      const result = messagesToText(messages);
      expect(result).toBe('Hello\nWorld\t!@#$%^&*()');
    });
  });

  describe('Array Content', () => {
    it('should extract text from text blocks in array content', () => {
      const messages: MessageParam[] = [
        {
          role: 'user',
          content: [{ type: 'text', text: 'Hello from array' }]
        }
      ];

      const result = messagesToText(messages);
      expect(result).toBe('Hello from array');
    });

    it('should join multiple text blocks with newlines', () => {
      const messages: MessageParam[] = [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'First block' },
            { type: 'text', text: 'Second block' },
            { type: 'text', text: 'Third block' }
          ]
        }
      ];

      const result = messagesToText(messages);
      expect(result).toBe('First block\nSecond block\nThird block');
    });

    it('should filter out non-text blocks (images)', () => {
      const messages: MessageParam[] = [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Text content' },
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: 'iVBORw0KGgoAAAANS...'
              }
            },
            { type: 'text', text: 'More text' }
          ]
        }
      ];

      const result = messagesToText(messages);
      expect(result).toBe('Text content\nMore text');
    });

    it('should handle empty arrays', () => {
      const messages: MessageParam[] = [
        {
          role: 'user',
          content: []
        }
      ];

      const result = messagesToText(messages);
      expect(result).toBe('');
    });

    it('should handle arrays with only images', () => {
      const messages: MessageParam[] = [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/jpeg',
                data: 'abc123'
              }
            },
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: 'def456'
              }
            }
          ]
        }
      ];

      const result = messagesToText(messages);
      expect(result).toBe('');
    });

    it('should handle missing text property in text blocks', () => {
      const messages: MessageParam[] = [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Valid text' },
            { type: 'text' } as any, // Missing text property
            { type: 'text', text: 'More valid text' }
          ]
        }
      ];

      const result = messagesToText(messages);
      expect(result).toBe('Valid text\n\nMore valid text');
    });
  });

  describe('Mixed Content Types', () => {
    it('should handle mix of string and array content messages', () => {
      const messages: MessageParam[] = [
        { role: 'user', content: 'String message' },
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'Array message' }]
        },
        { role: 'user', content: 'Another string' }
      ];

      const result = messagesToText(messages);
      expect(result).toBe('String message\nArray message\nAnother string');
    });

    it('should filter out empty messages from result', () => {
      const messages: MessageParam[] = [
        { role: 'user', content: 'Valid message 1' },
        { role: 'user', content: '' },
        { role: 'user', content: 'Valid message 2' },
        {
          role: 'user',
          content: []
        },
        { role: 'user', content: 'Valid message 3' }
      ];

      const result = messagesToText(messages);
      expect(result).toBe('Valid message 1\nValid message 2\nValid message 3');
    });
  });

  describe('Null and Undefined Handling', () => {
    it('should handle null content', () => {
      const messages: MessageParam[] = [{ role: 'user', content: null as any }];

      const result = messagesToText(messages);
      expect(result).toBe('');
    });

    it('should handle undefined content', () => {
      const messages: MessageParam[] = [{ role: 'user', content: undefined as any }];

      const result = messagesToText(messages);
      expect(result).toBe('');
    });

    it('should handle mixed null/undefined with valid content', () => {
      const messages: MessageParam[] = [
        { role: 'user', content: 'Valid message' },
        { role: 'user', content: null as any },
        { role: 'user', content: undefined as any },
        { role: 'user', content: 'Another valid message' }
      ];

      const result = messagesToText(messages);
      expect(result).toBe('Valid message\nAnother valid message');
    });
  });

  describe('Edge Cases', () => {
    it('should handle very long text content', () => {
      const longText = 'A'.repeat(10000);
      const messages: MessageParam[] = [{ role: 'user', content: longText }];

      const result = messagesToText(messages);
      expect(result).toBe(longText);
      expect(result.length).toBe(10000);
    });

    it('should handle Unicode characters', () => {
      const messages: MessageParam[] = [{ role: 'user', content: 'Hello 世界 🌍 Привет مرحبا' }];

      const result = messagesToText(messages);
      expect(result).toBe('Hello 世界 🌍 Привет مرحبا');
    });

    it('should handle emoji in array content', () => {
      const messages: MessageParam[] = [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Hello 👋' },
            { type: 'text', text: 'World 🌍' }
          ]
        }
      ];

      const result = messagesToText(messages);
      expect(result).toBe('Hello 👋\nWorld 🌍');
    });

    it('should handle newlines and tabs within content', () => {
      const messages: MessageParam[] = [{ role: 'user', content: 'Line 1\nLine 2\tTabbed' }];

      const result = messagesToText(messages);
      expect(result).toBe('Line 1\nLine 2\tTabbed');
    });

    it('should convert non-string, non-array content to string', () => {
      const messages: MessageParam[] = [{ role: 'user', content: 12345 as any }];

      const result = messagesToText(messages);
      expect(result).toBe('12345');
    });

    it('should handle boolean content', () => {
      const messages: MessageParam[] = [{ role: 'user', content: true as any }];

      const result = messagesToText(messages);
      expect(result).toBe('true');
    });

    it('should handle object content (convert to string)', () => {
      const messages: MessageParam[] = [{ role: 'user', content: { key: 'value' } as any }];

      const result = messagesToText(messages);
      expect(result).toBe('[object Object]');
    });

    it('should handle empty messages array', () => {
      const messages: MessageParam[] = [];

      const result = messagesToText(messages);
      expect(result).toBe('');
    });

    it('should handle messages with only null/undefined content', () => {
      const messages: MessageParam[] = [
        { role: 'user', content: null as any },
        { role: 'user', content: undefined as any },
        { role: 'assistant', content: null as any }
      ];

      const result = messagesToText(messages);
      expect(result).toBe('');
    });
  });

  describe('Security Considerations', () => {
    it('should not leak image data in extracted text', () => {
      const messages: MessageParam[] = [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Check out this image:' },
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: 'BASE64_ENCODED_DATA_HERE'
              }
            }
          ]
        }
      ];

      const result = messagesToText(messages);
      expect(result).not.toContain('BASE64_ENCODED_DATA_HERE');
      // Note: 'image' is part of the word "Check out this image:" which is valid text
      expect(result).toBe('Check out this image:');
    });

    it('should handle injection attempt in content', () => {
      const messages: MessageParam[] = [{ role: 'user', content: '<script>alert("xss")</script>' }];

      const result = messagesToText(messages);
      expect(result).toContain('<script>alert("xss")</script>');
      // Note: The validator is responsible for detecting injection, not this utility
    });

    it('should handle multiple user roles (conversation history)', () => {
      const messages: MessageParam[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
        { role: 'user', content: 'How are you?' },
        { role: 'assistant', content: 'I am doing well!' },
        { role: 'user', content: 'What can you do?' }
      ];

      const result = messagesToText(messages);
      expect(result).toBe('Hello\nHi there!\nHow are you?\nI am doing well!\nWhat can you do?');
    });
  });
});
