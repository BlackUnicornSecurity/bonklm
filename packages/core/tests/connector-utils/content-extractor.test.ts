/**
 * Content Extractor Tests
 * =======================
 * Unit + edge-case coverage for the provider-response content extractor.
 * Exercises every supported response shape (OpenAI / Anthropic / HuggingFace /
 * generic / nested / array), the bracket-notation path walker, and the
 * throw-on-missing / default-value branches.
 */

import { describe, it, expect } from 'vitest';
import {
  extractContentFromResponse,
  extractContentFirstSuccess,
  extractContentJoined
} from '../../src/connector-utils/content-extractor.js';

describe('extractContentFromResponse', () => {
  describe('primitive inputs', () => {
    it('returns a string response verbatim', () => {
      expect(extractContentFromResponse('hello world')).toBe('hello world');
    });

    it('returns the empty string verbatim (not the default)', () => {
      expect(extractContentFromResponse('', { defaultValue: 'fallback' })).toBe('');
    });

    it('returns defaultValue for a non-object (number)', () => {
      expect(extractContentFromResponse(42, { defaultValue: 'none' })).toBe('none');
    });

    it('returns defaultValue for null', () => {
      expect(extractContentFromResponse(null, { defaultValue: 'x' })).toBe('x');
    });

    it('returns the empty-string default when no default supplied', () => {
      expect(extractContentFromResponse(undefined)).toBe('');
    });

    it('throws on a non-object when throwOnMissing is set', () => {
      expect(() => extractContentFromResponse(42, { throwOnMissing: true })).toThrow(/non-object response/);
    });
  });

  describe('standard provider formats', () => {
    it('extracts the OpenAI chat shape (choices[0].message.content)', () => {
      expect(extractContentFromResponse({ choices: [{ message: { content: 'oai' } }] })).toBe('oai');
    });

    it('extracts the OpenAI completion shape (choices[0].text)', () => {
      expect(extractContentFromResponse({ choices: [{ text: 'completion' }] })).toBe('completion');
    });

    it('extracts the Anthropic shape (content[0].text)', () => {
      expect(extractContentFromResponse({ content: [{ text: 'claude' }] })).toBe('claude');
    });

    it('extracts message.content', () => {
      expect(extractContentFromResponse({ message: { content: 'msg' } })).toBe('msg');
    });

    it('extracts messages[0].content', () => {
      expect(extractContentFromResponse({ messages: [{ content: 'first' }] })).toBe('first');
    });

    it('extracts HuggingFace generated_text', () => {
      expect(extractContentFromResponse({ generated_text: 'hf' })).toBe('hf');
    });

    it.each([
      ['answer', { answer: 'a' }, 'a'],
      ['summary_text', { summary_text: 's' }, 's'],
      ['translation_text', { translation_text: 't' }, 't'],
      ['output_text', { output_text: 'ot' }, 'ot'],
      ['text', { text: 'plain' }, 'plain'],
      ['output', { output: 'out' }, 'out'],
      ['result', { result: 'res' }, 'res'],
      ['response', { response: 'rsp' }, 'rsp'],
      ['completion', { completion: 'cmp' }, 'cmp']
    ])('extracts the %s field', (_label, input, expected) => {
      expect(extractContentFromResponse(input)).toBe(expected);
    });

    it('extracts data[0].text and data[0].content', () => {
      expect(extractContentFromResponse({ data: [{ text: 'dt' }] })).toBe('dt');
      expect(extractContentFromResponse({ data: [{ content: 'dc' }] })).toBe('dc');
    });

    it('honours priority order — message.content wins over plain text', () => {
      expect(extractContentFromResponse({ message: { content: 'win' }, text: 'lose' })).toBe('win');
    });
  });

  describe('custom field priority', () => {
    it('checks custom fields before standard fields', () => {
      expect(extractContentFromResponse({ custom: 'C', text: 'standard' }, { fields: ['custom'] })).toBe('C');
    });

    it('falls through custom fields in order until a string is found', () => {
      expect(extractContentFromResponse({ a: { nested: 5 }, b: 'second' }, { fields: ['a.nested', 'b'] })).toBe(
        'second'
      );
    });

    it('falls back to standard fields when no custom field matches', () => {
      expect(extractContentFromResponse({ text: 'fallback' }, { fields: ['missing'] })).toBe('fallback');
    });
  });

  describe('array-of-content-items shape', () => {
    it('prefers the content[0].text standard field over the array-join', () => {
      // content[0].text resolves first in the priority list, so a content
      // array whose FIRST item has text returns just that item.
      expect(extractContentFromResponse({ content: [{ text: 'a' }, { text: 'b' }] })).toBe('a');
    });

    it('joins multiple text items when content[0].text does not resolve', () => {
      // First item lacks `text`, so the standard field misses and the
      // array-join branch fires across the remaining text items.
      expect(extractContentFromResponse({ content: [{}, { text: 'a' }, { text: 'b' }] })).toBe('a\nb');
    });

    it('skips non-object and text-less items in a content array', () => {
      // content[0].text matches the standard field first if first item has text,
      // so use a first item WITHOUT text to force the array-join branch.
      expect(extractContentFromResponse({ content: [{ id: 1 }, { text: 'kept' }, null, 'str'] })).toBe('kept');
    });

    it('falls through to default when content array has no usable text', () => {
      expect(extractContentFromResponse({ content: [{ id: 1 }, null] }, { defaultValue: 'def' })).toBe('def');
    });
  });

  describe('top-level array responses', () => {
    it('returns the first element when it is a string', () => {
      expect(extractContentFromResponse(['first', 'second'])).toBe('first');
    });

    it('recurses into the first element when it is an object', () => {
      expect(extractContentFromResponse([{ text: 'nested' }])).toBe('nested');
    });

    it('returns default for an empty array', () => {
      expect(extractContentFromResponse([], { defaultValue: 'empty' })).toBe('empty');
    });

    it('returns default when the first array element is an unusable primitive', () => {
      expect(extractContentFromResponse([42], { defaultValue: 'num' })).toBe('num');
    });
  });

  describe('missing content', () => {
    it('returns defaultValue when nothing matches', () => {
      expect(extractContentFromResponse({ foo: 'bar' }, { defaultValue: 'NONE' })).toBe('NONE');
    });

    it('throws when nothing matches and throwOnMissing is set', () => {
      expect(() => extractContentFromResponse({ foo: 'bar' }, { throwOnMissing: true })).toThrow(/No content found/);
    });
  });

  describe('nested path walker edge cases', () => {
    it('returns default when an array index is out of range', () => {
      expect(extractContentFromResponse({ choices: [] }, { defaultValue: 'oob' })).toBe('oob');
    });

    it('stops cleanly when a path segment hits a string mid-walk', () => {
      // message is a string, so message.content cannot resolve.
      expect(extractContentFromResponse({ message: 'astring' }, { defaultValue: 'stop' })).toBe('stop');
    });

    it('stops cleanly when a path segment hits null mid-walk', () => {
      expect(extractContentFromResponse({ message: null }, { defaultValue: 'nul' })).toBe('nul');
    });

    it('does not treat a non-string match as content', () => {
      // choices[0].message.content is a number, so it must not be returned.
      expect(
        extractContentFromResponse({ choices: [{ message: { content: 123 } }] }, { defaultValue: 'numguard' })
      ).toBe('numguard');
    });
  });
});

describe('extractContentFirstSuccess', () => {
  it('returns the first response that yields content', () => {
    expect(extractContentFirstSuccess([{ foo: 1 }, { text: 'got it' }, { text: 'later' }])).toBe('got it');
  });

  it('returns defaultValue when every candidate fails', () => {
    expect(extractContentFirstSuccess([{ foo: 1 }, 42, null], { defaultValue: 'all-failed' })).toBe('all-failed');
  });

  it('returns the empty string when every candidate fails and no default given', () => {
    expect(extractContentFirstSuccess([{ foo: 1 }])).toBe('');
  });
});

describe('extractContentJoined', () => {
  it('joins raw strings and extracted object content with the default separator', () => {
    expect(extractContentJoined(['raw', { text: 'obj' }])).toBe('raw\nobj');
  });

  it('uses a custom separator', () => {
    expect(extractContentJoined(['a', 'b'], ' | ')).toBe('a | b');
  });

  it('skips objects that extract to empty content', () => {
    expect(extractContentJoined(['kept', { foo: 'no-content' }, { text: 'also' }], '-')).toBe('kept-also');
  });

  it('returns the empty string for an empty input list', () => {
    expect(extractContentJoined([])).toBe('');
  });
});
