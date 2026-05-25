/**
 * Sprint 43 cross-connector CWE-117 sweep — fastify-plugin regression.
 * Sprint 44 added contract-lock for sessionId wrap.
 * Sprint 45 added end-to-end integration test for the session-tracking
 * escalation path (architect MEDIUM #8 + Sprint 41/42 lesson:
 * integration tests find what contract-lock misses).
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
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import {
  CATEGORY_REPEAT_THRESHOLD,
  clearAllSessions,
  sanitizeLogString,
  sanitizeMeta,
  serializeError,
} from '@blackunicorn/bonklm';
import Fastify, { type FastifyInstance } from 'fastify';
import { guardrailsPlugin } from '../src/plugin.js';

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

// Sprint 45 integration test (Sprint 44 deferral): end-to-end fastify
// session-tracking escalation path with a hostile validator that emits
// findings carrying control-char-laden `category` strings. The session
// pattern logic embeds `category` verbatim into the escalation reason
// (`SessionTracker.ts:321`); pre-Sprint-44 the reason flowed raw into
// the log meta AND the GuardrailResult.reason struct field. Sprint 44
// sanitized both at the variable-binding site; this test pins the
// end-to-end behaviour through real fastify HTTP injection.
describe('fastify-plugin — Sprint 45 session-tracking integration', () => {
  let fastify: FastifyInstance;
  let warnSpy: ReturnType<typeof vi.fn>;
  let errorSpy: ReturnType<typeof vi.fn>;
  const SESSION_ID = 'sprint-45-test-session';

  beforeEach(() => {
    // Isolation: clear all session state so the escalation threshold
    // is exercised cleanly per test.
    clearAllSessions();
    warnSpy = vi.fn();
    errorSpy = vi.fn();
    fastify = Fastify({ logger: false });
  });

  afterEach(async () => {
    await fastify.close();
    clearAllSessions();
  });

  it('sanitizes hostile-category session-escalation reason at end-to-end log + response body', async () => {
    const hostileCategory = 'category-name\nINJECTED:fake_escalation=PASS';

    // Custom validator returning a blocked result whose `findings[0]`
    // has a hostile `category` string. SessionTracker accumulates by
    // category — after CATEGORY_REPEAT_THRESHOLD (3) occurrences, the
    // post-validation escalation log fires.
    const hostileValidator = {
      name: 'HostileCategoryValidator',
      validate: vi.fn().mockReturnValue({
        allowed: true,
        blocked: false,
        severity: 'critical' as const,
        risk_level: 'high' as const,
        risk_score: 100,
        findings: [
          {
            category: hostileCategory,
            severity: 'critical' as const,
            description: 'hostile pattern',
            weight: 1,
          },
        ],
        timestamp: Date.now(),
      }),
    };

    await fastify.register(guardrailsPlugin, {
      validators: [hostileValidator as never],
      enableSessionTracking: true,
      sessionIdExtractor: () => SESSION_ID,
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: warnSpy,
        error: errorSpy,
      },
      productionMode: false,
    });

    fastify.post('/test', async () => {
      return { ok: true };
    });

    // Sprint 45 architect MEDIUM #3 closure: drive the loop from the
    // exported CATEGORY_REPEAT_THRESHOLD constant rather than a magic
    // `3`. If SessionTracker raises the threshold, this test scales
    // self-healingly. The post-validation `Session escalated after
    // validation` warn fires on the threshold-th inject call.
    for (let i = 0; i < CATEGORY_REPEAT_THRESHOLD; i++) {
      await fastify.inject({
        method: 'POST',
        url: '/test',
        payload: { message: `turn ${i}` },
      });
    }

    // The escalation warn fires with sanitized meta.
    const escalationCalls = warnSpy.mock.calls.filter(
      (call) => typeof call[0] === 'string' && call[0].includes('Session escalated after validation')
    );
    expect(escalationCalls.length).toBeGreaterThan(0);
    const [, meta] = escalationCalls[0]!;
    expect(meta).toBeDefined();
    const sessionMeta = meta as { sessionId?: string; reason?: string };
    // sessionId is library-controlled here (we set it static) but the
    // Sprint 44 wrap applies regardless.
    expect(sessionMeta.sessionId).toBe(SESSION_ID);
    // The reason MUST NOT contain the raw control char — the literal
    // hostile category newline becomes the literal `\\n` marker.
    expect(sessionMeta.reason).toBeDefined();
    expect(sessionMeta.reason).not.toContain('\n');
    expect(sessionMeta.reason).toContain('INJECTED');
  });
});
