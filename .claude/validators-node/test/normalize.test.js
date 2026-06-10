import { describe, it, expect } from 'vitest';
import { normalizeText } from '../lib/normalize.js';

const cc = String.fromCharCode;

describe('normalizeText', () => {
  it('returns empty string for null/undefined', () => {
    expect(normalizeText(null)).toBe('');
    expect(normalizeText(undefined)).toBe('');
  });

  it('NFKC-folds fullwidth forms and lowercases', () => {
    // U+FF29 = fullwidth capital I
    expect(normalizeText(`${cc(0xff29)}GNORE`)).toBe('ignore');
  });

  it('strips zero-width characters', () => {
    expect(normalizeText(`ig${cc(0x200b)}no${cc(0x200d)}re`)).toBe('ignore');
  });

  it('collapses whitespace and trims', () => {
    expect(normalizeText('  a   b\n\tc ')).toBe('a b c');
  });

  it('coerces non-string values', () => {
    expect(normalizeText(42)).toBe('42');
  });
});
