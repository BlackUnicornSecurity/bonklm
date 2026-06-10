import { describe, it, expect } from 'vitest';
import { sanitizeForLog } from '../lib/sanitize.js';

const cc = String.fromCharCode;

describe('sanitizeForLog', () => {
  it('returns empty string for null/undefined', () => {
    expect(sanitizeForLog(null)).toBe('');
    expect(sanitizeForLog(undefined)).toBe('');
  });

  it('replaces C0/C1/DEL control characters with spaces', () => {
    const dirty = `a${cc(0)}b${cc(10)}c${cc(9)}d${cc(0x7f)}e${cc(0x9b)}f`;
    const clean = sanitizeForLog(dirty);
    expect(clean).toBe('a b c d e f');
  });

  it('strips bidi overrides, isolates and line/paragraph separators', () => {
    const dirty = `x${cc(0x202e)}y${cc(0x2066)}${cc(0x2028)}${cc(0x2029)}z`;
    expect(sanitizeForLog(dirty)).toBe('xyz');
  });

  it('truncates beyond maxLength with a marker', () => {
    expect(sanitizeForLog('x'.repeat(50), 10)).toBe('xxxxxxxxxx...[truncated]');
  });

  it('does not truncate within maxLength', () => {
    expect(sanitizeForLog('short', 200)).toBe('short');
  });

  it('coerces non-string values', () => {
    expect(sanitizeForLog(123)).toBe('123');
  });
});
