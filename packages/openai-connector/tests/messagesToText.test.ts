/**
 * Unit Tests for messagesToText Utility
 * =====================================
 *
 * Tests SEC-006: Complex message content handling.
 */

import { describe, it, expect } from 'vitest';
import { messagesToText } from '../src/guarded-openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

describe('messagesToText', () => {
  it('should extract text from string content messages', () => {
    const messages: ChatCompletionMessageParam[] = [
      { role: 'user', content: 'Hello world' },
      { role: 'assistant', content: 'Hi there!' },
    ];
    const text = messagesToText(messages);
    expect(text).toBe('Hello world\nHi there!');
  });

  it('should extract text from array content with text parts', () => {
    const messages: ChatCompletionMessageParam[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'What do you see' },
          { type: 'text', text: ' in this image?' },
        ],
      },
    ];
    const text = messagesToText(messages);
    expect(text).toBe('What do you see\n in this image?');
  });

  it('should filter out non-text content from array messages', () => {
    const messages: ChatCompletionMessageParam[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Look at this' },
          { type: 'image_url', image_url: { url: 'https://example.com/image.jpg' } },
          { type: 'text', text: ' image' },
        ],
      },
    ];
    const text = messagesToText(messages);
    expect(text).toBe('Look at this\n image');
    expect(text).not.toContain('https://');
  });

  it('should handle null content', () => {
    const messages: ChatCompletionMessageParam[] = [
      { role: 'assistant', content: null },
      { role: 'user', content: 'Hello' },
    ];
    const text = messagesToText(messages);
    expect(text).toBe('Hello');
  });

  it('should handle empty content arrays', () => {
    const messages: ChatCompletionMessageParam[] = [
      { role: 'user', content: [] },
    ];
    const text = messagesToText(messages);
    expect(text).toBe('');
  });

  it('should handle refusal content type', () => {
    const messages: ChatCompletionMessageParam[] = [
      {
        role: 'assistant',
        content: [
          { type: 'refusal', refusal: 'I cannot fulfill this request.' },
        ],
      },
    ];
    const text = messagesToText(messages);
    expect(text).toBe('I cannot fulfill this request.');
  });

  it('should handle mixed content types', () => {
    const messages: ChatCompletionMessageParam[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Check this' },
          { type: 'image_url', image_url: { url: 'https://example.com/img.jpg' } },
          { type: 'input_audio', input_audio: { data: 'base64data', format: 'wav' } },
          { type: 'text', text: ' and listen' },
        ],
      },
    ];
    const text = messagesToText(messages);
    expect(text).toBe('Check this\n and listen');
  });

  it('should filter out file content from array messages', () => {
    const messages: ChatCompletionMessageParam[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Analyze this file' },
          { type: 'file', file: { file_id: 'file-abc123' } },
        ],
      },
    ];
    const text = messagesToText(messages);
    expect(text).toBe('Analyze this file');
  });

  it('should handle mixed text and refusal', () => {
    const messages: ChatCompletionMessageParam[] = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'I can help with' },
          { type: 'refusal', refusal: ' but not that' },
        ],
      },
    ];
    const text = messagesToText(messages);
    expect(text).toBe('I can help with\n but not that');
  });

  it('should handle system messages with string content', () => {
    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Hello' },
    ];
    const text = messagesToText(messages);
    expect(text).toBe('You are a helpful assistant.\nHello');
  });

  it('should handle developer messages with array content', () => {
    const messages: ChatCompletionMessageParam[] = [
      {
        role: 'developer',
        content: [
          { type: 'text', text: 'Special instructions' },
          { type: 'text', text: ' for the model' },
        ],
      },
    ];
    const text = messagesToText(messages);
    expect(text).toBe('Special instructions\n for the model');
  });

  it('should skip empty strings from filtered content', () => {
    const messages: ChatCompletionMessageParam[] = [
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: 'https://example.com/image.jpg' } },
          { type: 'image_url', image_url: { url: 'https://example.com/image2.jpg' } },
        ],
      },
      { role: 'user', content: 'Now text' },
    ];
    const text = messagesToText(messages);
    expect(text).toBe('Now text');
  });

  it('should handle complex multimodal messages', () => {
    const messages: ChatCompletionMessageParam[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'What is in these images?' },
          {
            type: 'image_url',
            image_url: {
              url: 'https://example.com/image1.jpg',
              detail: 'high',
            },
          },
          {
            type: 'image_url',
            image_url: {
              url: 'https://example.com/image2.jpg',
              detail: 'low',
            },
          },
          { type: 'text', text: 'Describe both.' },
        ],
      },
    ];
    const text = messagesToText(messages);
    expect(text).toBe('What is in these images?\nDescribe both.');
  });

  it('should handle messages without content field (tool calls)', () => {
    const messages: ChatCompletionMessageParam[] = [
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_123',
            type: 'function',
            function: {
              name: 'get_weather',
              arguments: '{}',
            },
          },
        ],
      },
      { role: 'user', content: 'Hello' },
    ];
    const text = messagesToText(messages);
    expect(text).toBe('Hello');
  });

  it('should convert undefined content to empty string', () => {
    const messages = [
      { role: 'user', content: 'Hello' },
      // @ts-expect-error - testing undefined case
      { role: 'assistant', content: undefined },
    ] as ChatCompletionMessageParam[];
    const text = messagesToText(messages);
    expect(text).toBe('Hello');
  });
});
