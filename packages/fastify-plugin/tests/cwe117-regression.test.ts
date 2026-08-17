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
 *     meta `reason` (validator output) + sanitized route-template `path`.
 *   - the '[Guardrails] Session escalated …' pre/post-validation log meta
 *     `reason` (SessionTracker embeds the validator `category` verbatim) and
 *     the escalation response body. Session identifiers are omitted from logs.
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

  it('sanitizes a route-template path field for the blocked-log meta', () => {
    const routeTemplate = '/api/:tenant\nINJECTED:fake_audit=PASS';
    expect(sanitizeMeta(routeTemplate)).toBe('/api/:tenant\\nINJECTED:fake_audit=PASS');
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
