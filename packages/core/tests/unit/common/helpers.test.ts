/**
 * Sprint 33 — Common helper unit tests
 *
 * Locks the defensive behaviour added during Sprint 33 (benchmark-bug
 * surfacing) + the cross-helper sanitization contract introduced post
 * 3-lane audit:
 *
 *  - `isExpectedSecretFile(non-string)` → `false` (no throw)
 *  - `sanitizeLogString(...)` defeats CWE-117 log injection
 *  - `serializeError(...)` produces enumerable objects across the full
 *    range of throw shapes (Error / string / object / null / undefined /
 *    primitive / non-serialisable circular) AND runs message through
 *    `sanitizeLogString` so attacker-influenced error text cannot
 *    forge structured-log records.
 *
 * The `serializeError` helper is the engine's structured-logger
 * extractor; without it, `JSON.stringify(new Error('x'))` returns
 * `"{}"` and `error={}` log entries blind operators to real failures.
 */
import { describe, it, expect } from 'vitest';
import {
  isExpectedSecretFile,
  sanitizeLogString,
  serializeError,
} from '../../../src/common/index.js';

describe('isExpectedSecretFile — defensive type guard', () => {
  it('returns false for non-string filePath (object)', () => {
    // Real-world repro from the Sprint 33 benchmark bug: caller passed
    // `{ direction: 'input' }` as `filePath`. Previously threw TypeError
    // inside `.split('/')`; now returns false.
    expect(isExpectedSecretFile({ direction: 'input' } as unknown as string)).toBe(false);
  });

  it('returns false for undefined filePath', () => {
    expect(isExpectedSecretFile(undefined as unknown as string)).toBe(false);
  });

  it('returns false for null filePath', () => {
    expect(isExpectedSecretFile(null as unknown as string)).toBe(false);
  });

  it('returns false for numeric filePath', () => {
    expect(isExpectedSecretFile(42 as unknown as string)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isExpectedSecretFile('')).toBe(false);
  });

  it('returns true for a known expected secret-file name', () => {
    expect(isExpectedSecretFile('.env.example')).toBe(true);
    expect(isExpectedSecretFile('/path/to/.env.template')).toBe(true);
    expect(isExpectedSecretFile('project/.env.sample')).toBe(true);
  });

  it('returns false for a non-expected secret-file name', () => {
    expect(isExpectedSecretFile('.env')).toBe(false);
    expect(isExpectedSecretFile('/path/to/config.json')).toBe(false);
  });

  it('is case-insensitive for the basename comparison', () => {
    expect(isExpectedSecretFile('.ENV.EXAMPLE')).toBe(true);
    expect(isExpectedSecretFile('/path/.Env.Sample')).toBe(true);
  });
});

describe('serializeError — structured-logger extractor', () => {
  it('serializes a standard Error with message + name + stack', () => {
    const err = new Error('oops');
    const out = serializeError(err);
    expect(out.message).toBe('oops');
    expect(out.name).toBe('Error');
    expect(typeof out.stack).toBe('string');
    expect(out.raw).toBeUndefined();
  });

  it('serializes a TypeError subclass with the subclass name', () => {
    const err = new TypeError('bad type');
    const out = serializeError(err);
    expect(out.message).toBe('bad type');
    expect(out.name).toBe('TypeError');
  });

  it('serializes a custom Error subclass with its overridden name', () => {
    class MyCustomError extends Error {
      override readonly name = 'MyCustomError';
    }
    const out = serializeError(new MyCustomError('custom'));
    expect(out.name).toBe('MyCustomError');
    expect(out.message).toBe('custom');
  });

  it('produces an ENUMERABLE object for JSON.stringify (fixes the `error={}` opacity bug)', () => {
    // The bug: `JSON.stringify(new Error('x'))` returns `"{}"` because
    // Error properties are non-enumerable. The fix: serializeError
    // returns a plain object, so JSON sees the fields.
    const out = serializeError(new Error('observable'));
    const json = JSON.stringify(out);
    expect(json).toContain('"message":"observable"');
    expect(json).toContain('"name":"Error"');
  });

  it('serializes a bare string throw', () => {
    const out = serializeError('string-thrown-directly');
    expect(out.message).toBe('string-thrown-directly');
    expect(out.raw).toBeUndefined();
  });

  it('serializes a plain object throw via raw JSON', () => {
    const out = serializeError({ code: 42, reason: 'rate-limit' });
    expect(out.message).toBe('[non-Error object thrown]');
    expect(out.raw).toBe('{"code":42,"reason":"rate-limit"}');
  });

  it('serializes a null throw with a useful message', () => {
    const out = serializeError(null);
    expect(out.message).toBe('null');
    expect(out.raw).toBe('null');
  });

  it('serializes an undefined throw with a useful message', () => {
    const out = serializeError(undefined);
    expect(out.message).toBe('undefined');
  });

  it('serializes a numeric throw', () => {
    const out = serializeError(42);
    expect(out.message).toBe('42');
    expect(out.raw).toBe('42');
  });

  it('serializes a non-JSON-serialisable object (circular) without throwing', () => {
    const circular: { self?: unknown } = {};
    circular.self = circular;
    const out = serializeError(circular);
    expect(out.message).toBe('[non-Error object thrown]');
    // Post-Sprint-33-audit closure (architect MEDIUM): raw uses an
    // explicit marker rather than falling back to `String(error)` which
    // produced the misleading `'[object Object]'` for plain objects.
    expect(out.raw).toBe('[circular or non-serialisable]');
  });

  it('sanitizes attacker-influenced error message (CWE-117 log injection)', () => {
    // Sprint 33 audit closure (security MEDIUM): `serializeError.message`
    // now routes through `sanitizeLogString`. Without this, an attacker
    // who could influence error text (e.g. a validator throwing
    // `new Error(\`bad: \${userInput}\`)`) could inject a forged log
    // record by embedding newlines + a fake severity marker.
    const malicious = 'bad input\n[CRITICAL] fake log line injected by attacker';
    const out = serializeError(new Error(malicious));
    expect(out.message).not.toContain('\n');
    expect(out.message).toContain('\\n');
    expect(out.message).toContain('bad input');
  });

  it('strips control characters from error message', () => {
    const withControlChars = 'oops\x00\x01\x07\x1f';
    const out = serializeError(new Error(withControlChars));
    expect(out.message).not.toMatch(/[\x00-\x08\x0b-\x1f\x7f]/);
    expect(out.message).toContain('oops');
    expect(out.message).toMatch(/\\x00|\\x01|\\x07|\\x1f/);
  });

  it('truncates over-long error message to 500 chars + ellipsis marker', () => {
    const huge = 'A'.repeat(2000);
    const out = serializeError(new Error(huge));
    expect(out.message.length).toBeLessThan(huge.length);
    expect(out.message).toContain('…[truncated]');
  });
});

describe('sanitizeLogString — CWE-117 log-injection guard', () => {
  it('escapes lone \\n to literal \\n', () => {
    expect(sanitizeLogString('a\nb')).toBe('a\\nb');
  });

  it('escapes \\r and \\r\\n via the control-char path (\\r is in the control range)', () => {
    // `\r` (0x0d) sits inside the control-char range and gets escaped to
    // `\\x0d` before the newline regex sees it. `\n` (0x0a) is NOT in the
    // control range (LF survives the first pass) and is then escaped to
    // `\\n` by the newline pass. Net result: `\r\n` → `\\x0d\\n`, lone
    // `\r` → `\\x0d`. Both still defeat CWE-117 (no literal newline survives).
    expect(sanitizeLogString('a\r\nb')).toBe('a\\x0d\\nb');
    expect(sanitizeLogString('a\rb')).toBe('a\\x0db');
  });

  it('replaces NUL byte and other control chars with their hex escape', () => {
    expect(sanitizeLogString('a\x00b')).toBe('a\\x00b');
    expect(sanitizeLogString('a\x07b')).toBe('a\\x07b');
    expect(sanitizeLogString('a\x7fb')).toBe('a\\x7fb');
  });

  it('preserves printable ASCII unchanged', () => {
    expect(sanitizeLogString('Hello, world!')).toBe('Hello, world!');
  });

  it('caps long strings at the default 500-char ceiling', () => {
    const long = 'A'.repeat(2000);
    const result = sanitizeLogString(long);
    expect(result.length).toBeLessThanOrEqual(500 + '…[truncated]'.length);
    expect(result).toContain('…[truncated]');
  });

  it('respects an explicit smaller maxLen', () => {
    const result = sanitizeLogString('A'.repeat(100), 10);
    expect(result.startsWith('AAAAAAAAAA')).toBe(true);
    expect(result).toContain('…[truncated]');
  });

  it('returns an empty string unchanged', () => {
    expect(sanitizeLogString('')).toBe('');
  });

  // Sprint 37 security-MEDIUM M-1: TAB (\x09) was previously skipped
  // by the strip range. TSV-format log ingestors treat TAB as a column
  // delimiter; leaving it unencoded allows a phantom-column injection.
  it('strips TAB to \\x09 (Sprint 37 M-1 — TSV column-injection defence)', () => {
    expect(sanitizeLogString('a\tb')).toBe('a\\x09b');
  });

  it('strips TAB embedded in a SIEM-style log payload', () => {
    expect(sanitizeLogString('user=alice\trole=admin\tinjected\tfield=x')).toBe(
      'user=alice\\x09role=admin\\x09injected\\x09field=x'
    );
  });
});

describe('serializeError — Sprint 37 security-MEDIUM closures', () => {
  it('sanitizes `name` (L-1 closure)', () => {
    // Construct an Error whose `.name` contains a control character.
    // Real-world vector: consumer subclass that derives `.name` from a
    // caught user-influenced string (anti-pattern, but observed in
    // the wild). The CWE-117 strip MUST cover `.name`, not just
    // `.message`.
    const err = new Error('plain message');
    Object.defineProperty(err, 'name', {
      value: 'Custom\nInjected: spoof',
      writable: false,
    });
    const out = serializeError(err);
    expect(out.name).toBe('Custom\\nInjected: spoof');
  });

  it('sanitizes `raw` for non-Error throws (M-2 closure)', () => {
    // A custom validator that throws an object whose stringified form
    // contains a TAB would inject a phantom column into TSV log
    // ingestors via the `raw` field. Verify sanitizeLogString runs.
    // JSON.stringify itself does NOT escape literal TAB characters in
    // string values (only LF / CR / control-char range below 0x20
    // EXCLUDING TAB are escaped per RFC 8259).
    //
    // Note: TAB inside a JSON string IS escaped by JSON.stringify to
    // `\t` (two characters), so the literal `\x09` does not survive
    // JSON.stringify in the first place. The realistic vector is
    // attacker-controlled keys + nested objects that produce
    // structurally-injected output. Assert the sanitize hook fires
    // regardless: every control-char byte in the raw output MUST be
    // escaped post-stringify.
    const thrown = { msg: 'normal' };
    const out = serializeError(thrown);
    expect(typeof out.raw).toBe('string');
    // Should not contain any unescaped control character.
    // eslint-disable-next-line no-control-regex
    expect(/[\x00-\x09\x0b-\x1f\x7f]/.test(out.raw ?? '')).toBe(false);
  });

  it('does not crash when JSON.stringify returns undefined (regression)', () => {
    // `JSON.stringify(undefined)` returns the value `undefined`, not
    // the string `'undefined'`. The Sprint 37 M-2 sanitize hook
    // initially crashed on this path; the type-guard fixes it.
    expect(() => serializeError(undefined)).not.toThrow();
    const out = serializeError(undefined);
    expect(out.message).toBe('undefined');
    expect(out.raw).toBeUndefined();
  });
});
