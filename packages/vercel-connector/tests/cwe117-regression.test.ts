/**
 * CWE-117 sanitization primitive contract — vercel-connector.
 *
 * `createGuardedAI` in `guarded-ai.ts` wraps every attacker-influenced
 * validator `reason` with the canonical `sanitizeMeta` primitive before it
 * crosses a caller-facing boundary. The wrapped boundaries (located by their
 * thrown-message / streamed-chunk strings, not line numbers):
 *   - the input-blocked dev-mode `Content blocked: …` throw (validateInput).
 *   - the non-streaming output-blocked dev-mode `Content blocked: …` throw
 *     (generateText).
 *   - the buffer-mode stream-blocked `Content filtered: …` field of the JSON
 *     error chunk encoded into the response stream (streamText) — bytes that
 *     flow directly to the HTTP client.
 *
 * The companion LOG path delegates to core `logValidationFailure`, which
 * sanitizes independently — so the THROW / streamed chunk is the connector's
 * own load-bearing sink.
 *
 * This contract-lock asserts the canonical primitive is reachable from the
 * import surface and behaves as expected on representative attacker inputs.
 * The END-TO-END proof that each guarded path actually applies `sanitizeMeta`
 * (and FAILS if a wrap is removed — the ADR-0001 non-vacuity standard) lives in
 * `guarded-ai.test.ts` › "vercel — CWE-117 reason sanitization is load-bearing
 * (ADR-0001)": those tests drive the guarded wrapper with control-char payloads
 * and assert the escaped form at the caught error message and the JSON-parsed
 * streamed chunk.
 *
 * History: introduced as a cross-connector CWE-117 sweep (primitive-isolation
 * asserts only) → boundary-driving tests added when the import-only contract was
 * found vacuous (ADR-0001 anti-pattern).
 */
import { describe, expect, it } from 'vitest';

import { sanitizeLogString, sanitizeMeta, serializeError } from '@blackunicorn/bonklm';

describe('vercel-connector — CWE-117 sanitization primitive contract', () => {
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
    const reason = 'matched ignore_previous\nINJECTED:fake_severity';
    expect(sanitizeMeta(reason)).toBe('matched ignore_previous\\nINJECTED:fake_severity');
  });

  it('sanitizes a streamed JSON-chunk error reason (client-output surface)', () => {
    // The stream-blocked chunk encodes a JSON object whose bytes are sent to the
    // HTTP client. Raw control chars in `error` would forge log lines or hijack
    // rendering if the client logs or displays the recovered field. The genuine
    // boundary is the value a downstream JSON parser RECOVERS — sanitizeMeta
    // ensures that recovered value is already the escaped form (`JSON.stringify`
    // alone would escape a raw control char too, so asserting on the raw chunk
    // text would be vacuous).
    const reason = 'stream blocked\nINJECTED:fake_chunk';
    const chunk = JSON.stringify({ type: 'error', error: `Content filtered: ${sanitizeMeta(reason)}` });
    const recovered = (JSON.parse(chunk) as { error: string }).error;
    expect(recovered).toBe('Content filtered: stream blocked\\nINJECTED:fake_chunk');
    expect(recovered).not.toContain('\n');
  });
});
