/**
 * CWE-117 sanitization primitive contract — google-genai-connector.
 *
 * The four guarded entry points in `guarded-google-genai.ts`
 * (`wrapGenerateContent` / `wrapGenerateContentStream` / `wrapChat` /
 * `wrapLive`) wrap every attacker-influenced validator `reason` with the
 * canonical `sanitizeMeta` primitive before interpolating it into the
 * dev-mode `ConnectorValidationError` message they throw. The wrapped
 * boundaries (located by their thrown-message strings, not line numbers):
 *   - `Input blocked: …` / `Output blocked: …` — non-streaming and chat
 *     request/response validation.
 *   - `Stream blocked: …` / `Stream tail blocked: …` — per-chunk and
 *     end-of-stream text validation.
 *   - `Function call blocked: …` — accumulated function-call args, on the
 *     non-streaming, in-stream, and end-of-stream legs.
 *   - `Live message blocked: …` / `Live send blocked: …` / `Tool response
 *     blocked: …` — the Live API inbound/outbound and tool-response paths.
 *
 * The companion LOG path delegates to core `logValidationFailure`, which
 * sanitizes independently — so the THROW is the connector's own load-bearing
 * sink.
 *
 * This contract-lock asserts the canonical primitive is reachable from the
 * import surface and behaves as expected on representative attacker inputs.
 * The END-TO-END proof that each guarded path actually applies `sanitizeMeta`
 * (and FAILS if a wrap is removed — the ADR-0001 non-vacuity standard) lives
 * in `guarded-google-genai.test.ts` › "google-genai — CWE-117 reason
 * sanitization is load-bearing (ADR-0001)": those tests drive each entry
 * point with a control-char payload and assert the escaped form on the
 * thrown message.
 *
 * History: introduced as a cross-connector CWE-117 sweep (primitive-isolation
 * asserts only) → boundary-driving tests added when the import-only contract
 * was found vacuous (ADR-0001 anti-pattern).
 */
import { describe, expect, it } from 'vitest';

import { sanitizeLogString, sanitizeMeta, serializeError } from '@blackunicorn/bonklm';

describe('google-genai-connector — CWE-117 sanitization primitive contract', () => {
  it('imports sanitizeMeta from the core barrel', () => {
    expect(typeof sanitizeMeta).toBe('function');
    expect(sanitizeMeta('a\nb')).toBe('a\\nb');
  });

  it('imports sanitizeLogString from the core barrel', () => {
    expect(typeof sanitizeLogString).toBe('function');
  });

  it('imports serializeError from the core barrel', () => {
    expect(typeof serializeError).toBe('function');
  });

  it('sanitizes a validator-extracted reason for the blocked-throw paths', () => {
    const reason = 'matched gemini-pattern\nINJECTED:CRITICAL bypass';
    expect(sanitizeMeta(reason)).toBe('matched gemini-pattern\\nINJECTED:CRITICAL bypass');
  });

  it('sanitizes a function-call result reason (sister site shape)', () => {
    const reason = 'function call validation failed\nINJECTED:fake_tool';
    expect(sanitizeMeta(reason)).toBe('function call validation failed\\nINJECTED:fake_tool');
  });
});
