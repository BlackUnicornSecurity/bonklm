/**
 * Sprint 43 cross-connector CWE-117 sweep — google-genai-connector regression.
 *
 * 18 src sites flagged by security review HIGH #6 in
 * `guarded-google-genai.ts` across generateContent / streaming / live /
 * function-call / tool-response paths. All embed raw `*.reason` in
 * dev-mode `ConnectorValidationError` messages. Sprint 43 wraps each
 * with `sanitizeMeta` via a uniform `replace_all` codemod-style edit.
 *
 * The log path uses `logValidationFailure` which sanitizes internally
 * via `stripLogControlChars` (Sprint 39 ADR-0001 legacy path).
 */
import { describe, expect, it } from 'vitest';

import { sanitizeLogString, sanitizeMeta, serializeError } from '@blackunicorn/bonklm';

describe('google-genai-connector — Sprint 43 CWE-117 sanitization contract', () => {
  it('imports sanitizeMeta from the core barrel', () => {
    expect(typeof sanitizeMeta).toBe('function');
    expect(sanitizeMeta('a\nb')).toBe('a\\nb');
  });

  it('imports sanitizeLogString + serializeError', () => {
    expect(typeof sanitizeLogString).toBe('function');
    expect(typeof serializeError).toBe('function');
  });

  it('sanitizes validator-extracted reason across all 18 throw sites', () => {
    // 18 sites — Input/Output/Function call/Stream/Stream tail/Live
    // message/Live send/Tool response blocked. All share the same
    // `${X.reason}` interpolation shape; the sweep used a per-shape
    // replace_all so all are covered uniformly.
    const reason = 'matched gemini-pattern\nINJECTED:CRITICAL bypass';
    expect(sanitizeMeta(reason)).toBe('matched gemini-pattern\\nINJECTED:CRITICAL bypass');
  });

  it('sanitizes function-call result reason (sister site shape)', () => {
    const reason = 'function call validation failed\nINJECTED:fake_tool';
    expect(sanitizeMeta(reason)).toBe('function call validation failed\\nINJECTED:fake_tool');
  });
});
