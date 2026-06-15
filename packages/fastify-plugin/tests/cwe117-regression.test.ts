/**
 * CWE-117 sanitization primitive contract — fastify-plugin.
 *
 * `guardrailsPlugin` in `plugin.ts` wraps every attacker-influenced log-meta
 * value and caller-facing HTTP-response field with the canonical `sanitizeMeta`
 * primitive (and routes thrown/caught errors through `serializeError`). The
 * wrapped boundaries, located by their plugin log-message / response-field
 * strings (not line numbers):
 *   - the dev error-handler response-body `reason` returned to the HTTP caller.
 *   - the '[Guardrails] Request blocked' / '[Guardrails] Response blocked' log
 *     meta `reason` (validator output) + `path` (request.url, caller-supplied).
 *   - the '[Guardrails] Session escalated …' pre/post-validation log meta
 *     `reason` (SessionTracker embeds the validator `category` verbatim) +
 *     `sessionId` (the `sessionIdExtractor` may read attacker-controlled
 *     headers/cookies) + the escalation response body.
 *   - the validation-error log `error` field, via `serializeError`.
 *
 * This contract-lock asserts the canonical primitives are reachable from the
 * import surface and behave as expected on representative attacker inputs. The
 * END-TO-END proof that each guarded path actually applies `sanitizeMeta` (and
 * FAILS if a wrap is removed — the ADR-0001 non-vacuity standard) lives in
 * `plugin.test.ts` › "Fastify Guardrails Plugin — CWE-117 sanitization is
 * load-bearing (ADR-0001)": those tests drive the registered plugin over HTTP
 * injection with control-char payloads and assert the escaped form at each sink.
 *
 * History: introduced as a cross-connector CWE-117 sweep (primitive-isolation
 * asserts only) → boundary-driving tests added when the import-only contract was
 * found vacuous (ADR-0001 anti-pattern).
 */
import { describe, expect, it } from 'vitest';

import { sanitizeLogString, sanitizeMeta, serializeError } from '@blackunicorn/bonklm';

describe('fastify-plugin — CWE-117 sanitization primitive contract', () => {
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

  it('sanitizes a validator-extracted reason for the error-handler body and blocked-log meta', () => {
    const reason = 'matched ignore_previous\nINJECTED:CRITICAL bypass';
    expect(sanitizeMeta(reason)).toBe('matched ignore_previous\\nINJECTED:CRITICAL bypass');
  });

  it('sanitizes a caller-supplied request.url path field for the blocked-log meta', () => {
    // request.url is whatever the HTTP client (or an upstream proxy) forwarded. A
    // hostile request-target with control chars in the path component would inject
    // into log aggregators that key off the `path` field.
    const path = '/api/chat\nINJECTED:fake_audit=PASS';
    expect(sanitizeMeta(path)).toBe('/api/chat\\nINJECTED:fake_audit=PASS');
  });

  it('sanitizes a caller-supplied sessionId field for the escalation-log meta', () => {
    // `defaultSessionIdExtractor` (and any custom `sessionIdExtractor`) can read
    // attacker-controllable request headers/cookies, so the sessionId carried into
    // the session-escalation log meta is an attacker-influenceable surface.
    const hostileSessionId = 'session-abc\nINJECTED:fake_admin=true';
    expect(sanitizeMeta(hostileSessionId)).toBe('session-abc\\nINJECTED:fake_admin=true');
  });

  it('serializeError replaces a raw error.message in the validation-error log', () => {
    // The fastify validation-error log routes caught errors through
    // `serializeError`, which sanitizes the message via `sanitizeLogString`
    // internally (handles non-Error throws + non-enumerable Error fields).
    const out = serializeError(new Error('validator boom\nINJECTED:CRITICAL fake_error_code'));
    expect(out.message).toBe('validator boom\\nINJECTED:CRITICAL fake_error_code');
    expect(out.name).toBe('Error');
  });
});
