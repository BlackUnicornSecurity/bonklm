import { describe, it, expect } from 'vitest';
import { charClassRegex } from '../lib/char-class.js';

describe('charClassRegex', () => {
  it('builds an inclusive range class', () => {
    const re = charClassRegex([[0x41, 0x43]]); // A-C
    expect('B'.replace(re, '')).toBe('');
    expect('D'.replace(re, '')).toBe('D');
  });

  it('builds a single-code-point class', () => {
    const wordJoiner = String.fromCharCode(0x2060);
    const re = charClassRegex([[0x2060]]);
    expect(wordJoiner.replace(re, '')).toBe('');
    expect('x'.replace(re, '')).toBe('x');
  });

  it('mixes ranges and singletons', () => {
    const re = charClassRegex([
      [0x30, 0x39], // digits
      [0x2d], // hyphen
    ]);
    expect('1-2-3'.replace(re, '')).toBe('');
  });

  it('defaults to the global flag and accepts overrides', () => {
    expect(charClassRegex([[0x61, 0x7a]]).flags).toBe('g');
    expect(charClassRegex([[0x61, 0x7a]], 'gi').flags).toBe('gi');
  });
});
