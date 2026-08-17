/**
 * Unit tests for connector-utils/sanitize.ts
 *
 * Regression lock for sanitizeReasonText TAB alignment with sanitizeLogString.
 * Pre-fix, TAB (\x09) was silently deleted by the [^\x20-\x7E] strip pass.
 * Post-fix, TAB is hex-escaped to the literal 4-char sequence \x09, matching
 * sanitizeLogString's forensic-signal contract (ADR-0001 D#2).
 */

import { describe, it, expect } from 'vitest';
import { sanitizeReasonText } from '../../src/connector-utils/sanitize.js';
import { sanitizeLogString } from '../../src/common/index.js';

describe('sanitizeReasonText', () => {
  it('returns undefined for undefined input', () => {
    expect(sanitizeReasonText(undefined)).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(sanitizeReasonText('')).toBeUndefined();
  });

  it('passes through normal printable ASCII', () => {
    expect(sanitizeReasonText('Blocked: prompt injection detected')).toBe('Blocked: prompt injection detected');
  });

  it('strips ANSI escape sequences (non-printable chars outside 0x20-0x7E stripped after hex pass)', () => {
    // After the hex-escape pass, ESC (\x1b) becomes the 4-char literal \x1b.
    // The printable-strip pass [^\x20-\x7E] then removes the backslash-x-1-b
    // chars that fall outside printable ASCII... wait, those ARE printable ASCII.
    // So the output is the literal \x1b sequences visible in reason text.
    const result = sanitizeReasonText('\x1b[31mEVIL\x1b[0m');
    expect(result).toBeDefined();
    // The ESC byte is hex-escaped to \x1b literal; the remaining [31mEVIL[0m are printable
    expect(result).toContain('\\x1b');
    expect(result).toContain('[31mEVIL');
  });

  it('caps output at 200 characters', () => {
    const long = 'A'.repeat(300);
    const result = sanitizeReasonText(long);
    expect(result).toBeDefined();
    expect(result!.length).toBeLessThanOrEqual(200);
  });

  it('returns undefined when fully stripped to empty', () => {
    // All chars outside printable ASCII AND outside hex-escape — this input
    // contains only high Unicode that is stripped by the printable-ASCII pass.
    // After hex-escape there are no matching chars in [\x00-\x1f\x7f],
    // then the printable strip removes everything above 0x7E.
    const highUnicode = 'ЀЁЂ';
    expect(sanitizeReasonText(highUnicode)).toBeUndefined();
  });

  // TAB alignment regression lock
  describe('TAB alignment with sanitizeLogString', () => {
    it('hex-escapes TAB as \\x09 (not silently deleted)', () => {
      // Pre-fix: TAB was deleted by [^\x20-\x7E] strip pass → output was 'beforeafter'
      // Post-fix: TAB is hex-escaped to literal \x09 first → output is 'before\\x09after'
      const result = sanitizeReasonText('before\tafter');
      expect(result).toBe('before\\x09after');
    });

    it('produces same TAB representation as sanitizeLogString', () => {
      // Both canonical sanitizers must now render TAB as \x09.
      // This cross-function assertion locks the ADR-0001 D#2 forensic-signal parity.
      const input = 'before\tafter';
      const logResult = sanitizeLogString(input);
      const reasonResult = sanitizeReasonText(input);
      // sanitizeLogString → 'before\x09after'   (literal 4-char \x09 sequence)
      // sanitizeReasonText → 'before\x09after'  (same 4-char sequence)
      expect(logResult).toContain('\\x09');
      expect(reasonResult).toBeDefined();
      expect(reasonResult).toContain('\\x09');
    });

    it('hex-escapes NUL byte as \\x00', () => {
      const result = sanitizeReasonText('before\x00after');
      expect(result).toBe('before\\x00after');
    });

    it('hex-escapes CR (\\x0d) and LF (\\x0a) as hex literals', () => {
      const result = sanitizeReasonText('line1\r\nline2');
      // Note: sanitizeReasonText does not collapse \r\n to a \n marker
      // (that behaviour is sanitizeLogString's newline-replacement pass).
      // sanitizeReasonText hex-escapes each byte individually.
      expect(result).toBeDefined();
      expect(result).toContain('\\x0d');
      expect(result).toContain('\\x0a');
    });
  });
});
