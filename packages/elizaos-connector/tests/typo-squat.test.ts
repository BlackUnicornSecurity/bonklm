/**
 * Story 2.1b-connectors — Levenshtein typo-squat detection tests.
 */
import { describe, expect, it } from 'vitest';
import {
  levenshteinDistance,
  detectTypoSquat,
  detectTypoSquatBatch,
} from '../src/typo-squat.js';

describe('levenshteinDistance', () => {
  it('returns 0 on identical strings', () => {
    expect(levenshteinDistance('abc', 'abc')).toBe(0);
  });

  it('returns the length of the non-empty when one is empty', () => {
    expect(levenshteinDistance('', 'abc')).toBe(3);
    expect(levenshteinDistance('abc', '')).toBe(3);
  });

  it('handles single-character substitution', () => {
    expect(levenshteinDistance('abc', 'abd')).toBe(1);
  });

  it('handles single-character insertion', () => {
    expect(levenshteinDistance('abc', 'abcd')).toBe(1);
  });

  it('handles single-character deletion', () => {
    expect(levenshteinDistance('abcd', 'abc')).toBe(1);
  });

  it('handles two edits', () => {
    expect(levenshteinDistance('cat', 'dog')).toBe(3);
    expect(levenshteinDistance('flaw', 'lawn')).toBe(2);
  });
});

describe('detectTypoSquat', () => {
  const allowlist = ['@elizaos/plugin-solana', '@elizaos/plugin-evm'];

  it('returns exactMatch=true on an exact-match plugin name', () => {
    const result = detectTypoSquat('@elizaos/plugin-solana', allowlist);
    expect(result.exactMatch).toBe(true);
    expect(result.nearestTypoSquat).toBeUndefined();
  });

  it('flags distance-1 typo-squat (capital-I-for-l)', () => {
    const result = detectTypoSquat('@elizaos/plugin-soIana', allowlist);
    expect(result.exactMatch).toBe(false);
    expect(result.nearestTypoSquat).toEqual({
      target: '@elizaos/plugin-solana',
      distance: 1,
    });
  });

  it('flags distance-1 typo-squat (trailing duplicate)', () => {
    const result = detectTypoSquat('@elizaos/plugin-solanaa', allowlist);
    expect(result.exactMatch).toBe(false);
    expect(result.nearestTypoSquat?.distance).toBe(1);
  });

  it('flags distance-2 typo-squat', () => {
    // Two character swaps from 'solana' — solanaXX vs solanaXY.
    const result = detectTypoSquat('@elizaos/plugin-solanXY', allowlist);
    expect(result.exactMatch).toBe(false);
    expect(result.nearestTypoSquat?.distance).toBe(2);
  });

  it('does NOT flag distance-3 (unknown plugin, not a typo-squat)', () => {
    const result = detectTypoSquat('@elizaos/plugin-XXXXna', allowlist);
    expect(result.exactMatch).toBe(false);
    expect(result.nearestTypoSquat).toBeUndefined();
  });

  it('picks the CLOSEST allowlist entry when multiple are within distance ≤ 2', () => {
    // 'eva' is dist-1 from 'evm' AND dist-2 from 'solana' (well,
    // longer prefixes). Build a controlled case:
    const list = ['@x/aaa', '@x/aab'];
    const result = detectTypoSquat('@x/aac', list);
    // Both 'aaa' and 'aab' are dist-1 from 'aac'. Pick first-seen.
    expect(result.nearestTypoSquat?.distance).toBe(1);
  });

  it('handles Cyrillic homoglyph typo-squat', () => {
    // U+0430 Cyrillic small letter A (visually identical to Latin 'a')
    const result = detectTypoSquat('@elizaos/plugin-solаna', allowlist);
    expect(result.exactMatch).toBe(false);
    expect(result.nearestTypoSquat?.distance).toBe(1);
  });
});

describe('detectTypoSquatBatch', () => {
  const allowlist = ['@elizaos/plugin-solana', '@elizaos/plugin-evm'];

  it('returns only the typo-squat candidates (filters exact + unknown-distant)', () => {
    const results = detectTypoSquatBatch(
      [
        '@elizaos/plugin-solana', // exact — filtered
        '@elizaos/plugin-soIana', // typo-squat — kept
        '@unknown/plugin-foobar', // unknown-distant — filtered
        '@elizaos/plugin-evm', // exact — filtered
      ],
      allowlist
    );
    expect(results.length).toBe(1);
    expect(results[0].pluginName).toBe('@elizaos/plugin-soIana');
  });
});
