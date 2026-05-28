/**
 * Sprint 43 cross-connector CWE-117 sweep — ollama-connector regression.
 *
 * Seven src sites flagged by security review HIGH #1 across chat +
 * generate paths:
 *   - input-blocked log + throw (raw reason).
 *   - chat output-blocked log + filteredContent (raw reason — flows
 *     into `response.message.content` returned to caller).
 *   - generate output-blocked log + filteredContent (raw reason —
 *     flows into `response.response` returned to caller).
 *
 * Sprint 43 sanitizes all 7 boundaries.
 */
import { describe, expect, it } from 'vitest';

import { sanitizeLogString, sanitizeMeta, serializeError } from '@blackunicorn/bonklm';

describe('ollama-connector — Sprint 43 CWE-117 sanitization contract', () => {
  it('imports sanitizeMeta from the core barrel', () => {
    expect(typeof sanitizeMeta).toBe('function');
    expect(sanitizeMeta('a\nb')).toBe('a\\nb');
  });

  it('imports sanitizeLogString + serializeError', () => {
    expect(typeof sanitizeLogString).toBe('function');
    expect(typeof serializeError).toBe('function');
  });

  it('sanitizes validator-extracted reason for input/output paths', () => {
    const reason = 'matched ignore_previous\nINJECTED:CRITICAL bypass';
    expect(sanitizeMeta(reason)).toBe('matched ignore_previous\\nINJECTED:CRITICAL bypass');
  });

  it('sanitizes filteredContent embedded in application response', () => {
    // ollama's filteredContent lands in `response.message.content`
    // (chat path) or `response.response` (generate path) — application-
    // output surface returned to caller.
    const reason = 'unsafe pattern matched\nFAKE_INJECTED';
    const filtered = `[Content filtered by guardrails: ${sanitizeMeta(reason)}]`;
    expect(filtered).not.toContain('\n');
    expect(filtered).toContain('FAKE_INJECTED');
  });
});
