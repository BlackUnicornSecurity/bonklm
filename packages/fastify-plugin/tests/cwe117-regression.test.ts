/**
 * Sprint 43 cross-connector CWE-117 sweep — fastify-plugin regression.
 *
 * Six src sites in `plugin.ts` carry attacker-influenced template-
 * literal log calls + raw error.message + HTTP response body raw
 * `reason` fields:
 *   - line ~83 (dev-mode `DEVELOPMENT_ERROR_HANDLER` body — raw `reason`).
 *   - line ~444 (`logger.warn('[Guardrails] Request blocked', { reason, path })`)
 *     — both fields wrap: `reason` is validator output, `path` is
 *     request.url (caller-supplied).
 *   - line ~463 (`logger.error('[Guardrails] Validation error', { error: error.message })`)
 *     — bare `error.message`; switch to canonical `serializeError`.
 *   - line ~518 (response-leg sister of request-blocked — same shape).
 *   - line ~534 (response body raw `reason` in dev-mode return).
 *   - line ~540 (response-leg sister of validation-error log — same shape).
 *
 * Sprint 43 wraps each accordingly. Path-sanitization is a NEW
 * surface for fastify — request.url is caller-supplied and was raw
 * in both request + response leg log meta.
 *
 * Sprint 42 architect LOW deferral → Sprint 43 closure.
 */
import { describe, expect, it } from 'vitest';

import { sanitizeLogString, sanitizeMeta, serializeError } from '@blackunicorn/bonklm';

describe('fastify-plugin — Sprint 43 CWE-117 sanitization contract', () => {
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

  it('sanitizes a validator-extracted reason for the dev error-handler body', () => {
    const reason = 'matched ignore_previous\nINJECTED:CRITICAL bypass';
    expect(sanitizeMeta(reason)).toBe(
      'matched ignore_previous\\nINJECTED:CRITICAL bypass'
    );
  });

  it('sanitizes a caller-supplied request.url path field', () => {
    // request.url is whatever the HTTP client sent. A hostile client
    // can craft a URL with control chars in the path component to
    // inject into log aggregators that key off `path` field.
    const path = '/api/chat\nINJECTED:fake_audit=PASS';
    expect(sanitizeMeta(path)).toBe('/api/chat\\nINJECTED:fake_audit=PASS');
  });

  it('sanitizes a caller-supplied sessionId field (Sprint 44 architect HIGH #6)', () => {
    // Sprint 44 closure: `defaultSessionIdExtractor` reads from
    // `req.session.id`, `req.sessionID`, `req.sessionId`, OR the
    // `x-session-id` request header. The header path is squarely
    // attacker-controllable. Pre-Sprint-44, both session-escalated
    // log sites (lines ~388, ~430) embedded sessionId raw in meta.
    const hostileSessionId = 'session-abc\nINJECTED:fake_admin=true';
    expect(sanitizeMeta(hostileSessionId)).toBe(
      'session-abc\\nINJECTED:fake_admin=true'
    );
  });

  it('serializeError replaces raw error.message in validation-error log', () => {
    // Pre-Sprint-43 the fastify validation-error log called
    // `error instanceof Error ? error.message : String(error)` —
    // raw message reached the log. Canonical pattern is
    // `serializeError` which sanitizes via sanitizeLogString
    // internally.
    const out = serializeError(new Error('validator boom\nINJECTED:CRITICAL fake_error_code'));
    expect(out.message).toBe(
      'validator boom\\nINJECTED:CRITICAL fake_error_code'
    );
    expect(out.name).toBe('Error');
  });
});
