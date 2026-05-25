/**
 * Direct unit tests for connector-utils logger helpers.
 *
 * Sprint 38 CWE-117 sweep: surface coverage for `logTimeout`'s
 * control-char sanitization of the `operation` arg (previously missed;
 * the sibling `logValidationFailure` already had a sanitizer applied
 * to its `reason` arg).
 *
 * Sprint 50 (ADR-0001 D#2 revision): `logTimeout` /
 * `logValidationFailure` / `sanitizeLogMetadata` migrated from the
 * deprecated `stripLogControlChars` (SPACE-replacement + 256-cap) to
 * the canonical `sanitizeLogString` (hex-escape + 500-cap + literal
 * `\n` markers). Expectations updated accordingly — a TAB-injection
 * attempt now surfaces as `\x09` rather than collapsing to SPACE.
 *
 * Test surface:
 *   - logTimeout: hex-escape sanitization on `operation`
 *   - logTimeout: meta `timeout` shape stable
 *   - logValidationFailure: hex-escape sanitization on `reason` +
 *     CRLF-injection regression lock
 *   - sanitizeLogMetadata: hex-escape on string meta values (Sprint
 *     50 migration regression lock)
 *   - stripLogControlChars: primitive behaviour preserved on the
 *     deprecated surface (still ships as @public through v1.x)
 */
import { describe, it, expect, vi } from 'vitest';

import {
  logTimeout,
  logValidationFailure,
  sanitizeLogMetadata,
  sanitizeMeta,
  stripLogControlChars,
} from '../../src/connector-utils/logger.js';

function makeSpyLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe('logTimeout — Sprint 38 CWE-117 sweep + Sprint 50 hex-escape migration', () => {
  it('hex-escapes newline-injection in operation before template interpolation', () => {
    const logger = makeSpyLogger();
    logTimeout(logger, 'query\nINJECTED log line', 30_000);

    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [message, meta] = logger.warn.mock.calls[0]!;
    // Sprint 50: `\n` collapses to literal `\n` marker (sanitizeLogString
    // newline-replacement pass), preserving the forensic signal a SOC
    // analyst needs to triage a CRLF-injection attempt.
    expect(message).toBe('Timeout: query\\nINJECTED log line');
    expect(meta).toEqual({ timeout: '30000ms' });
  });

  it('hex-escapes TAB in operation (TSV column-injection defence)', () => {
    const logger = makeSpyLogger();
    logTimeout(logger, 'op\twith\ttabs', 5000);

    // Sprint 50: TAB hex-escapes to `\x09` (was SPACE under
    // stripLogControlChars). The hex form is what makes the
    // TSV-column-injection attempt visible in the log line — the
    // legacy SPACE form rendered the attack indistinguishable from
    // legitimate space-padded input.
    expect(logger.warn).toHaveBeenCalledWith('Timeout: op\\x09with\\x09tabs', {
      timeout: '5000ms',
    });
  });

  it('hex-escapes NUL and DEL bytes from operation', () => {
    const logger = makeSpyLogger();
    logTimeout(logger, 'op\x00nul\x7fdel', 1000);

    // Sprint 50: NUL → `\x00`, DEL → `\x7f`.
    expect(logger.warn).toHaveBeenCalledWith('Timeout: op\\x00nul\\x7fdel', {
      timeout: '1000ms',
    });
  });

  it('passes a plain operation label through unchanged', () => {
    const logger = makeSpyLogger();
    logTimeout(logger, 'query validation', 30_000);

    expect(logger.warn).toHaveBeenCalledWith('Timeout: query validation', {
      timeout: '30000ms',
    });
  });
});

describe('logValidationFailure — Sprint 50 hex-escape migration', () => {
  it('hex-escapes CRLF-injection in reason meta', () => {
    const logger = makeSpyLogger();
    logValidationFailure(logger, 'blocked\nfake_audit_entry: bypass', {
      contentType: 'query',
    });

    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [message, meta] = logger.warn.mock.calls[0]!;
    expect(message).toBe('Validation blocked');
    // Sprint 50: `\n` collapses to literal `\n` marker (was SPACE).
    expect(meta.reason).toBe('blocked\\nfake_audit_entry: bypass');
    expect(meta.contentType).toBe('query');
  });

  it('hex-escapes TAB in reason (TSV column-injection)', () => {
    const logger = makeSpyLogger();
    logValidationFailure(logger, 'blocked\tphantom\tcolumn', undefined);

    const [, meta] = logger.warn.mock.calls[0]!;
    expect(meta.reason).toBe('blocked\\x09phantom\\x09column');
  });

  it('caps reason at sanitizeLogString limit + appends truncation marker', () => {
    const logger = makeSpyLogger();
    const long = 'x'.repeat(800);
    logValidationFailure(logger, long, undefined);

    const [, meta] = logger.warn.mock.calls[0]!;
    // sanitizeLogString cap is 500 chars + `…[truncated]` marker;
    // legacy stripLogControlChars capped at 256 with no marker.
    // Sprint 50 audit (code-review SHOULD-FIX 6): tightened from a
    // loose `> 256` check to the exact post-truncate shape so a
    // future regression that silently changes the cap to e.g. 300
    // would still fail this test.
    expect(meta.reason).toBe(`${'x'.repeat(500)}…[truncated]`);
    // 500 'x' chars + 1 `…` (U+2026, JS string length 1) +
    // 11 chars of `[truncated]` = 512.
    expect((meta.reason as string).length).toBe(512);
  });
});

describe('sanitizeLogMetadata — Sprint 50 hex-escape migration', () => {
  it('hex-escapes control chars in string meta values (CWE-117 layer)', () => {
    const out = sanitizeLogMetadata({
      toolName: 'shell\nINJECTED',
      model: 'gpt-4',
    });
    expect(out.toolName).toBe('shell\\nINJECTED');
    // Plain printable strings pass through untouched.
    expect(out.model).toBe('gpt-4');
  });

  it('hex-escapes TAB in meta values (TSV-column-injection defence)', () => {
    const out = sanitizeLogMetadata({ name: 'a\tb\tc' });
    expect(out.name).toBe('a\\x09b\\x09c');
  });

  it('still redacts sensitive keys before hex-escape sanitisation runs', () => {
    // Redaction precedes the per-value sanitize loop — a hostile API
    // key with embedded control chars should still mask, not surface
    // partial hex-escaped fragments.
    const out = sanitizeLogMetadata({
      apiKey: 'sk-abcd\nefgh1234',
      query: 'normal text',
    });
    expect(out.apiKey).toBe('sk-a****1234');
    expect(out.query).toBe('normal text');
  });
});

describe('stripLogControlChars — primitive', () => {
  it('replaces every control char in 0x00-0x1F with space', () => {
    expect(stripLogControlChars('a\x00b\x09c\x0ad\x1fe')).toBe('a b c d e');
  });

  it('replaces DEL (0x7F) with space', () => {
    expect(stripLogControlChars('a\x7fb')).toBe('a b');
  });

  it('caps output at 256 chars', () => {
    const long = 'x'.repeat(1000);
    expect(stripLogControlChars(long)).toHaveLength(256);
  });

  it('returns empty string unchanged', () => {
    expect(stripLogControlChars('')).toBe('');
  });

  it('preserves printable ASCII', () => {
    expect(stripLogControlChars('Hello, World!')).toBe('Hello, World!');
  });
});

// Sprint 41 code-reviewer HIGH closure: direct unit tests for
// `sanitizeMeta` — the helper was introduced + immediately re-exported
// through 3 barrel layers without dedicated tests. The retrofit call
// sites in connectors exercise the helper indirectly but do not cover
// the nullish branches or edge inputs. Direct tests lock the contract.
describe('sanitizeMeta — Sprint 41 helper', () => {
  it('returns empty string for null input', () => {
    expect(sanitizeMeta(null)).toBe('');
  });

  it('returns empty string for undefined input', () => {
    expect(sanitizeMeta(undefined)).toBe('');
  });

  it('passes a plain string through sanitizeLogString', () => {
    expect(sanitizeMeta('hello world')).toBe('hello world');
  });

  it('escapes control chars in string input (CWE-117 layer)', () => {
    expect(sanitizeMeta('attack\nINJECTED')).toBe('attack\\nINJECTED');
  });

  it('escapes TAB in string input', () => {
    expect(sanitizeMeta('a\tb')).toBe('a\\x09b');
  });

  it('stringifies numbers safely', () => {
    expect(sanitizeMeta(42)).toBe('42');
    expect(sanitizeMeta(0)).toBe('0');
    expect(sanitizeMeta(-1.5)).toBe('-1.5');
  });

  it('stringifies boolean safely', () => {
    expect(sanitizeMeta(true)).toBe('true');
    expect(sanitizeMeta(false)).toBe('false');
  });

  it('stringifies NaN safely (does NOT short-circuit to empty)', () => {
    // NaN is a number — `sanitizeMeta` MUST treat it as `'NaN'`,
    // NOT as nullish. The nullish guard is strictly === null /
    // === undefined per the contract.
    expect(sanitizeMeta(NaN)).toBe('NaN');
  });

  it('stringifies empty string as empty', () => {
    expect(sanitizeMeta('')).toBe('');
  });

  it('coerces an object via its toString and sanitizes the result', () => {
    // Demonstrates the Symbol/object-toString safety note in the
    // JSDoc: `String()` is shape-coercion only; CWE-117 defence
    // comes from the sanitize step.
    const hostile = { toString: () => 'normal\nINJECTED:fake' };
    expect(sanitizeMeta(hostile)).toBe('normal\\nINJECTED:fake');
  });

  it('coerces a Symbol via its description and sanitizes', () => {
    // `String(Symbol('inject\nfake'))` returns `'Symbol(inject\nfake)'`
    // with the embedded `\n` intact. sanitizeLogString catches it.
    const sym = Symbol('inject\nfake');
    const out = sanitizeMeta(sym);
    expect(out).toContain('Symbol(inject\\nfake)');
    expect(out).not.toContain('\n'); // no literal newline survived
  });

  it('stringifies BigInt safely', () => {
    expect(sanitizeMeta(123n)).toBe('123');
  });

  // Sprint 43 security MEDIUM #5 closure: hostile `toString()` that
  // throws must not propagate out of sanitizeMeta. Pre-Sprint-43 the
  // throw would crash the calling logger.warn invocation. Now wrapped
  // in try/catch — fail-closed to '[unstringifiable]' marker.
  it('fail-closes on a toString() that throws (Sprint 43 hardening)', () => {
    const hostile = {
      toString: () => {
        throw new Error('hostile-toString boom');
      },
    };
    expect(sanitizeMeta(hostile)).toBe('[unstringifiable]');
  });

  it('fail-closes on a Symbol.toPrimitive that throws', () => {
    const hostile = {
      [Symbol.toPrimitive]: () => {
        throw new Error('toPrimitive boom');
      },
    };
    expect(sanitizeMeta(hostile)).toBe('[unstringifiable]');
  });
});
