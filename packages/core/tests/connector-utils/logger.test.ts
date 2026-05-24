/**
 * Direct unit tests for connector-utils logger helpers.
 *
 * Sprint 38 CWE-117 sweep: surface coverage for `logTimeout`'s
 * control-char sanitization of the `operation` arg (previously missed;
 * the sibling `logValidationFailure` already had `stripLogControlChars`
 * applied to its `reason` arg).
 *
 * NOTE: this file covers the connector-utils/logger.ts local sanitizer
 * `stripLogControlChars` — distinct from `common/index.ts`'s
 * `sanitizeLogString`. Both exist in production by Sprint 38 (Sprint
 * 39 will consolidate; see lessons-learned). `stripLogControlChars`
 * replaces with SPACE + 256-char cap; `sanitizeLogString` replaces
 * with `\xNN` hex escape + 500-char cap + explicit `\n` markers.
 *
 * Test surface:
 *   - logTimeout: control-char strip on `operation`
 *   - logTimeout: meta `timeout` shape stable
 *   - logValidationFailure: control-char strip on `reason` (regression
 *     lock on the existing audit-loop fix)
 *   - stripLogControlChars: 0x00-0x1F + DEL handling + length cap
 */
import { describe, it, expect, vi } from 'vitest';

import {
  logTimeout,
  logValidationFailure,
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

describe('logTimeout — Sprint 38 CWE-117 sweep', () => {
  it('strips control chars from operation before template interpolation', () => {
    const logger = makeSpyLogger();
    logTimeout(logger, 'query\nINJECTED log line', 30_000);

    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [message, meta] = logger.warn.mock.calls[0]!;
    expect(message).toBe('Timeout: query INJECTED log line');
    expect(meta).toEqual({ timeout: '30000ms' });
  });

  it('strips TAB from operation (TSV column-injection defence)', () => {
    const logger = makeSpyLogger();
    logTimeout(logger, 'op\twith\ttabs', 5000);

    expect(logger.warn).toHaveBeenCalledWith('Timeout: op with tabs', {
      timeout: '5000ms',
    });
  });

  it('strips NUL and DEL bytes from operation', () => {
    const logger = makeSpyLogger();
    logTimeout(logger, 'op\x00nul\x7fdel', 1000);

    expect(logger.warn).toHaveBeenCalledWith('Timeout: op nul del', {
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

describe('logValidationFailure — regression lock on prior CWE-117 fix', () => {
  it('strips control chars from reason in meta', () => {
    const logger = makeSpyLogger();
    logValidationFailure(logger, 'blocked\nfake_audit_entry: bypass', {
      contentType: 'query',
    });

    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [message, meta] = logger.warn.mock.calls[0]!;
    expect(message).toBe('Validation blocked');
    expect(meta.reason).toBe('blocked fake_audit_entry: bypass');
    expect(meta.contentType).toBe('query');
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
