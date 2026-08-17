/**
 * Unit tests — `applyRedactionPasses` (shared credential-redaction engine)
 * =============================================================================
 * Locks the ordered-pass contract that both surface redactors now share:
 *   - common `redactSecrets`  (finding/telemetry egress, marker `[REDACTED]`)
 *   - cli    `redactCredentials` (error/CLI messages, marker `***REDACTED***`)
 *
 * The engine is intentionally behaviour-free on its own — it just applies each
 * `[pattern, replacement]` pass in order, threading the output of one into the
 * next. These tests pin: order sensitivity, the string vs function replacement
 * forms, capture-group preservation, and the no-op edges (empty input / empty
 * pass list). The two surface suites (`redact-credential-egress.test.ts`,
 * `cli/utils/error.test.ts`) remain the regression proof for each surface's
 * own shapes / markers / entropy predicate.
 */
import { describe, it, expect } from 'vitest';
import { applyRedactionPasses, type RedactionPass } from '../../../src/common/redaction.js';

describe('applyRedactionPasses — string replacement', () => {
  it('applies a single literal-marker pass', () => {
    const passes: RedactionPass[] = [[/secret/g, '[X]']];
    expect(applyRedactionPasses('a secret here', passes)).toBe('a [X] here');
  });

  it('replaces every match of a global pattern', () => {
    const passes: RedactionPass[] = [[/x/g, 'y']];
    expect(applyRedactionPasses('xxx', passes)).toBe('yyy');
  });
});

describe('applyRedactionPasses — function replacement', () => {
  it('supports a function replacer that inspects the match', () => {
    const passes: RedactionPass[] = [[/\d+/g, match => (match.length >= 3 ? '[NUM]' : match)]];
    expect(applyRedactionPasses('a 12 b 345 c', passes)).toBe('a 12 b [NUM] c');
  });

  it('preserves a capture group in the replacement (group-preserving mask)', () => {
    // Mirrors the URL-userinfo pass: keep group 1 (scheme), mask the userinfo.
    const passes: RedactionPass[] = [[/(\w+:\/\/)\S+@/g, (_m, scheme: string) => `${scheme}[REDACTED]@`]];
    expect(applyRedactionPasses('go https://user:pw@host/p', passes)).toBe('go https://[REDACTED]@host/p');
  });

  it('can do a partial replacement of a captured value within the match', () => {
    // Mirrors the api_key catch-all: replace only the captured value, keep the label.
    const passes: RedactionPass[] = [[/key=(\w+)/g, (m, value: string) => m.replace(value, 'X')]];
    expect(applyRedactionPasses('key=abc and key=def', passes)).toBe('key=X and key=X');
  });
});

describe('applyRedactionPasses — ordering', () => {
  it('threads each pass output into the next (later pass sees earlier result)', () => {
    const passes: RedactionPass[] = [
      [/a/g, 'b'],
      [/b/g, 'c']
    ];
    // First pass a->b makes the whole string 'b', second b->c makes it 'c'.
    expect(applyRedactionPasses('a', passes)).toBe('c');
  });

  it('honours a specific-before-generic order (JWT-before-base64 analogue)', () => {
    const specific = /TOKEN-[a-z]+/g;
    const generic = /[a-z]{4,}/g;
    // Markers are inert under re-scan (no 4+ lowercase run), mirroring the real
    // `[REDACTED]` / `***JWT_REDACTED***` markers — so the generic pass cannot
    // fragment what the specific pass already masked.
    const passes: RedactionPass[] = [
      [specific, '<w>'],
      [generic, '<f>']
    ];
    // Specific runs first and consumes the run as one <w>; generic finds nothing.
    expect(applyRedactionPasses('x TOKEN-abcdef y', passes)).toBe('x <w> y');
  });
});

describe('applyRedactionPasses — no-op edges', () => {
  it('returns the input unchanged when the pass list is empty', () => {
    expect(applyRedactionPasses('untouched', [])).toBe('untouched');
  });

  it('returns the empty string unchanged', () => {
    expect(applyRedactionPasses('', [[/x/g, 'y']])).toBe('');
  });

  it('does not mutate the caller-supplied input', () => {
    const input = 'secret';
    applyRedactionPasses(input, [[/secret/g, '[X]']]);
    expect(input).toBe('secret');
  });
});
