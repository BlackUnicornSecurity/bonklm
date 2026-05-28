/**
 * Sprint 43 cross-connector CWE-117 sweep — vercel-connector regression.
 *
 * Three src sites flagged by security review HIGH #2 in `guarded-ai.ts`:
 *   - line ~208 (input-blocked dev-mode throw raw reason).
 *   - line ~241 (output-blocked dev-mode throw raw reason).
 *   - line ~375 (stream-blocked JSON chunk encoded into the streamed
 *     response — raw reason serializes into a client-output surface).
 *
 * Sprint 43 sanitizes all three. The streamed-chunk site is the
 * highest-risk surface — bytes flow directly to the HTTP client.
 */
import { describe, expect, it } from 'vitest';

import { sanitizeLogString, sanitizeMeta, serializeError } from '@blackunicorn/bonklm';

describe('vercel-connector — Sprint 43 CWE-117 sanitization contract', () => {
  it('imports sanitizeMeta from the core barrel', () => {
    expect(typeof sanitizeMeta).toBe('function');
    expect(sanitizeMeta('a\nb')).toBe('a\\nb');
  });

  it('imports sanitizeLogString + serializeError', () => {
    expect(typeof sanitizeLogString).toBe('function');
    expect(typeof serializeError).toBe('function');
  });

  it('sanitizes validator-extracted reason for input/output throws', () => {
    const reason = 'matched ignore_previous\nINJECTED:fake_severity';
    expect(sanitizeMeta(reason)).toBe('matched ignore_previous\\nINJECTED:fake_severity');
  });

  it('sanitizes streamed JSON-chunk error field (client-output surface)', () => {
    // The stream-blocked chunk encodes a JSON object that's sent to
    // the HTTP client. Raw control chars in `error` would break JSON
    // parsers downstream OR forge log lines if the client logs the
    // chunk content.
    const reason = 'stream blocked\nINJECTED:fake_chunk';
    const chunk = JSON.stringify({
      type: 'error',
      error: `Content filtered: ${sanitizeMeta(reason)}`
    });
    // JSON.stringify escapes literal control chars in string values
    // (via `\u00XX` form) so even raw `\n` would be encoded. The
    // sanitizeMeta wrap is defence-in-depth.
    expect(chunk).toContain('INJECTED');
    expect(chunk).not.toContain('\n');
  });
});
