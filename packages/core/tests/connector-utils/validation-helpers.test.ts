/**
 * Unit tests for connector-utils/validation-helpers.ts
 *
 * Covers the shared numeric predicates used across connector packages:
 * - `validatePositiveNumber` — finite-positive assertion.
 * - `normalizeLimit` — the vector-DB family limit clamp adopted by the
 *   qdrant/pinecone connectors (security regression).
 *
 * These are the non-vacuous regression lock (ADR-0001): removing the clamp
 * makes the zero/negative/over-large/fractional cases fail, and removing the
 * fallback makes the undefined/NaN/Infinity cases fail.
 */

import { describe, it, expect } from 'vitest';
import { normalizeLimit, validatePositiveNumber } from '../../src/connector-utils/validation-helpers.js';

describe('validatePositiveNumber', () => {
  it('accepts a finite positive number', () => {
    expect(() => validatePositiveNumber(5, 'timeout')).not.toThrow();
    expect(() => validatePositiveNumber(0.5, 'timeout')).not.toThrow();
  });

  const invalid: ReadonlyArray<{ label: string; value: number }> = [
    { label: 'zero', value: 0 },
    { label: 'a negative number', value: -1 },
    { label: 'NaN', value: NaN },
    { label: 'Infinity', value: Infinity },
    { label: '-Infinity', value: -Infinity }
  ];
  it.each(invalid)('throws a TypeError for $label', ({ value }) => {
    expect(() => validatePositiveNumber(value, 'timeout')).toThrow(TypeError);
  });

  it('throws for a non-number value', () => {
    expect(() => validatePositiveNumber('5' as unknown as number, 'timeout')).toThrow(TypeError);
  });

  it('includes the option name and received value in the message', () => {
    expect(() => validatePositiveNumber(-2, 'maxLimit')).toThrow('maxLimit must be a positive number. Received: -2');
  });
});

describe('normalizeLimit', () => {
  const cases: ReadonlyArray<{
    label: string;
    requested: number | undefined;
    max: number;
    fallback: number;
    expected: number;
  }> = [
    { label: 'passes through an in-range integer', requested: 5, max: 50, fallback: 10, expected: 5 },
    { label: 'floors a fractional value', requested: 2.7, max: 50, fallback: 10, expected: 2 },
    { label: 'clamps zero up to 1', requested: 0, max: 50, fallback: 10, expected: 1 },
    { label: 'clamps a negative value up to 1', requested: -5, max: 50, fallback: 10, expected: 1 },
    { label: 'clamps an over-large value down to max', requested: 100, max: 50, fallback: 10, expected: 50 },
    { label: 'uses fallback for undefined', requested: undefined, max: 50, fallback: 10, expected: 10 },
    { label: 'uses fallback for NaN', requested: NaN, max: 50, fallback: 10, expected: 10 },
    { label: 'uses fallback for Infinity', requested: Infinity, max: 50, fallback: 10, expected: 10 },
    { label: 'floors a fractional max', requested: 100, max: 50.9, fallback: 10, expected: 50 },
    { label: 'treats a sub-1 max as 1', requested: 5, max: 0, fallback: 10, expected: 1 },
    { label: 'treats a negative max as 1', requested: 5, max: -3, fallback: 10, expected: 1 },
    { label: 'clamps a sub-1 fallback up to 1', requested: undefined, max: 50, fallback: 0, expected: 1 },
    { label: 'clamps an over-large fallback down to max', requested: undefined, max: 5, fallback: 100, expected: 5 }
  ];
  it.each(cases)('$label', ({ requested, max, fallback, expected }) => {
    expect(normalizeLimit(requested, { max, fallback })).toBe(expected);
  });

  it('always returns an integer within [1, max]', () => {
    const inputs: ReadonlyArray<number | undefined> = [-10, 0, 1, 3.3, 49.9, 1000, NaN, Infinity, undefined];
    for (const requested of inputs) {
      const result = normalizeLimit(requested, { max: 50, fallback: 10 });
      expect(Number.isInteger(result)).toBe(true);
      expect(result).toBeGreaterThanOrEqual(1);
      expect(result).toBeLessThanOrEqual(50);
    }
  });
});
