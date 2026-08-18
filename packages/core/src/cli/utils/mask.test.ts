/**
 * Tests for mask utility
 */

import { describe, it, expect } from 'vitest';
import { maskKey, maskKeyWithCustomLength, maskAllButLast, isMasked } from './mask.js';

describe('maskKey', () => {
  it('should return "***" for empty strings', () => {
    expect(maskKey('')).toBe('***');
  });

  it('should return "***" for values shorter than or equal to 8 characters', () => {
    expect(maskKey('short')).toBe('***');
    expect(maskKey('12345678')).toBe('***');
    expect(maskKey('ab')).toBe('***');
  });

  it('should show first 2 and last 4 characters for longer values', () => {
    const result = maskKey('sk-1234567890abcdef');

    // Check structure rather than exact padding length (which is random)
    expect(result).toContain('sk');
    expect(result).toContain('cdef');
    expect(result).toMatch(/^sk\*+cdef$/);
  });

  it('should handle values exactly 9 characters long', () => {
    const result = maskKey('123456789');

    expect(result).toContain('12');
    expect(result).toContain('6789');
    expect(result).toMatch(/^12\*+6789$/);
  });

  it('should produce varying output lengths due to random padding', () => {
    const value = 'sk-abcdefghijklmnopqrstuvwxyz1234567890';
    const results = new Set();

    // Get multiple results
    for (let i = 0; i < 100; i++) {
      results.add(maskKey(value));
    }

    // Due to random padding, we should get different lengths
    // With 10 possible padding lengths, getting 100 samples should give variety
    // We check for at least 5 different outputs (highly probable)
    expect(results.size).toBeGreaterThanOrEqual(5);
  });

  it('should always include first 2 characters in output', () => {
    const value = 'sk-1234567890abcdef';
    const result = maskKey(value);
    expect(result).toContain('sk');
  });

  it('should always include last 4 characters in output', () => {
    const value = 'sk-1234567890abcdef';
    const result = maskKey(value);
    expect(result).toContain('cdef');
  });

  it('should have padding length between 10 and 19 characters', () => {
    const value = 'sk-1234567890abcdef';
    const result = maskKey(value);

    // Extract padding length
    const prefix = 'sk';
    const suffix = 'cdef';
    const padding = result.slice(prefix.length, result.length - suffix.length);

    expect(padding.length).toBeGreaterThanOrEqual(10);
    expect(padding.length).toBeLessThanOrEqual(19);
    expect(padding).toMatch(/^\*+$/);
  });

  it('should handle unicode characters', () => {
    const value = '🔑-very-long-api-key-with-unicode-🔑';
    const result = maskKey(value);

    // Should return masked value, not throw
    expect(result).toBeTruthy();
    expect(result).toContain('🔑');
    // Emoji counts as 1 char, so first 2 chars = '🔑' (indices 0-1)
    // Last 4 chars are 'e-🔑'
    expect(result).toMatch(/^🔑\*+e-🔑$/);
  });

  it('should handle unicode surrogate pairs correctly', () => {
    // Test with characters that use surrogate pairs
    const value = 'sk-😀👍🎉-abcdef12345678';
    const result = maskKey(value);

    expect(result).toBeTruthy();
    expect(result).toContain('sk');
    expect(result).toContain('5678');
    // Should have asterisks in the middle
    expect(result).toMatch(/\*+/);
  });

  it('should handle special characters', () => {
    const value = 'sk.ant-api03_1234567890abcdef';
    const result = maskKey(value);

    expect(result).toContain('sk');
    expect(result).toContain('def');
  });

  it('should handle API keys with common formats', () => {
    // OpenAI format
    const openaiKey = 'sk-proj-abcdefghijklmnopqrstuvwxyz1234567890';
    const openaiResult = maskKey(openaiKey);
    expect(openaiResult).toMatch(/^sk\*+\d+$/);

    // Anthropic format
    const anthropicKey = 'sk-ant-api03-1234567890abcdef';
    const anthropicResult = maskKey(anthropicKey);
    expect(anthropicResult).toMatch(/^sk\*+cdef$/);
  });
});

describe('maskKeyWithCustomLength', () => {
  it('should return "***" when value is too short', () => {
    expect(maskKeyWithCustomLength('short', 3, 3)).toBe('***');
  });

  it('should use custom visible prefix length', () => {
    const result = maskKeyWithCustomLength('sk-1234567890abcdef', 3, 4);

    expect(result).toContain('sk-');
    expect(result).toContain('cdef');
    expect(result).toMatch(/^sk-\*+cdef$/);
  });

  it('should use custom suffix length', () => {
    const result = maskKeyWithCustomLength('sk-1234567890abcdef', 2, 6);

    expect(result).toContain('sk');
    expect(result).toContain('abcdef');
    expect(result).toMatch(/^sk\*+abcdef$/);
  });

  it('should handle edge case where visible + suffix equals length', () => {
    // 10 chars total, 5 visible + 5 suffix = 10 (not >, so returns ***)
    expect(maskKeyWithCustomLength('1234567890', 5, 5)).toBe('***');
  });

  it('should work with minimum valid length', () => {
    const result = maskKeyWithCustomLength('1234567890', 5, 4);

    expect(result).toContain('12345');
    expect(result).toContain('7890');
    expect(result).toContain('*');
  });
});

describe('maskAllButLast', () => {
  it('should return "***" for empty strings', () => {
    expect(maskAllButLast('')).toBe('***');
  });

  it('should return "***" when value length is less than or equal to visible chars', () => {
    expect(maskAllButLast('abc', 4)).toBe('***');
    expect(maskAllButLast('abcd', 4)).toBe('***');
  });

  it('should show only last N characters with default of 4', () => {
    // 19 chars - 4 suffix = 15 asterisks
    expect(maskAllButLast('sk-1234567890abcdef')).toBe('***************cdef');
  });

  it('should show custom number of characters', () => {
    // 19 chars - 6 suffix = 13 asterisks
    expect(maskAllButLast('sk-1234567890abcdef', 6)).toBe('*************abcdef');
    // 19 chars - 2 suffix = 17 asterisks
    expect(maskAllButLast('sk-1234567890abcdef', 2)).toBe('*****************ef');
  });

  it('should work with single visible character', () => {
    expect(maskAllButLast('sk-1234', 1)).toBe('******4');
  });

  it('should handle exactly length+1 value', () => {
    expect(maskAllButLast('abcde', 4)).toBe('*bcde');
  });

  it('should produce consistent output for same input', () => {
    const input = 'sk-1234567890abcdef';
    const result1 = maskAllButLast(input);
    const result2 = maskAllButLast(input);

    expect(result1).toBe(result2);
  });
});

describe('isMasked', () => {
  it('should return true for "***"', () => {
    expect(isMasked('***')).toBe(true);
  });

  it('should return true for values starting with 3+ asterisks and ending with ***', () => {
    expect(isMasked('***********abc***')).toBe(true);
    expect(isMasked('***abc***')).toBe(true);
  });

  it('should return true for pattern: 2 chars + 10+ asterisks + 4 chars', () => {
    expect(isMasked('sk************1234')).toBe(true);
    expect(isMasked('ab**************5678')).toBe(true);
  });

  it('should return false for regular API keys', () => {
    expect(isMasked('sk-1234567890abcdef')).toBe(false);
    expect(isMasked('sk-ant-api03_1234567890abcdef')).toBe(false);
  });

  it('should return false for values with insufficient asterisks', () => {
    expect(isMasked('sk**1234')).toBe(false);
    expect(isMasked('s********123')).toBe(false); // suffix only 3 chars
  });

  it('should return false for empty string', () => {
    expect(isMasked('')).toBe(false);
  });

  it('should return false for non-masking patterns', () => {
    expect(isMasked('regular-text')).toBe(false);
    expect(isMasked('test***value')).toBe(false);
  });

  it('should identify maskKey output as masked', () => {
    const masked = maskKey('sk-1234567890abcdef');
    expect(isMasked(masked)).toBe(true);
  });

  it('should identify maskAllButLast output as masked', () => {
    const masked = maskAllButLast('sk-1234567890abcdef');
    expect(isMasked(masked)).toBe(true);
  });
});

describe('timing attack resistance', () => {
  it('should produce variable length outputs', () => {
    const value = 'sk-1234567890abcdef';
    const lengths = new Set<number>();

    // Collect unique lengths directly
    for (let i = 0; i < 50; i++) {
      lengths.add(maskKey(value).length);
    }

    // Should have multiple different lengths due to random padding
    expect(lengths.size).toBeGreaterThan(1);
  });

  it('should mask short values consistently to prevent length leakage', () => {
    // All short values should return the same output
    expect(maskKey('')).toBe(maskKey('ab'));
    expect(maskKey('short')).toBe(maskKey('12345678'));
  });

  it('should use at least 10 characters of padding for long values', () => {
    const value = 'sk-1234567890abcdef';
    const result = maskKey(value);

    // Minimum length is 2 (prefix) + 10 (padding) + 4 (suffix) = 16
    expect(result.length).toBeGreaterThanOrEqual(16);
  });
});

describe('edge cases', () => {
  it('should handle very long values', () => {
    const longValue = 'sk-' + 'a'.repeat(1000) + '-1234';
    const result = maskKey(longValue);

    expect(result).toContain('sk');
    expect(result).toContain('1234');
    expect(result).toContain('*');
  });

  it('should handle newlines in input', () => {
    const valueWithNewline = 'sk-1234\n5678\nabcd';
    const result = maskKey(valueWithNewline);

    expect(result).toBeTruthy();
    expect(result).toContain('sk');
  });

  it('should handle tab characters in input', () => {
    const valueWithTab = 'sk-1234\t5678\tabcd';
    const result = maskKey(valueWithTab);

    expect(result).toBeTruthy();
    expect(result).toContain('sk');
  });

  it('should handle mixed case values', () => {
    const mixedCase = 'Sk-AbC-1234567890-XyZ';
    const result = maskKey(mixedCase);

    expect(result).toContain('Sk');
    expect(result).toContain('XyZ');
  });

  it('should handle numeric strings', () => {
    const numeric = '12345678901234567890';
    const result = maskKey(numeric);

    expect(result).toContain('12');
    expect(result).toContain('7890');
  });
});

describe('security properties', () => {
  it('should never reveal more than 6 characters of original value in maskKey', () => {
    const values = ['sk-1234567890abcdef', 'a'.repeat(100), 'sk-ant-api03-1234567890abcdef'];

    for (const value of values) {
      if (value.length > 8) {
        const result = maskKey(value);
        // Count non-asterisk characters
        const visibleChars = result.replace(/\*/g, '').length;
        expect(visibleChars).toBeLessThanOrEqual(6); // 2 prefix + 4 suffix
      }
    }
  });

  it('should handle values exactly at the boundary (8 chars)', () => {
    // Exactly 8 characters should return *** (not partial)
    expect(maskKey('12345678')).toBe('***');
  });

  it('should handle values just above the boundary (9 chars)', () => {
    // 9 characters should show partial
    const result = maskKey('123456789');
    expect(result).not.toBe('***');
    expect(result).toContain('12');
    expect(result).toContain('6789');
  });
});
