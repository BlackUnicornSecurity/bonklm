/** Fastify connector CWE-117 boundary regressions. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CATEGORY_REPEAT_THRESHOLD, clearAllSessions } from '@blackunicorn/bonklm';
import Fastify, { type FastifyInstance } from 'fastify';
import { guardrailsPlugin } from '../src/plugin.js';

describe('Fastify Guardrails Plugin — CWE-117 sanitization is load-bearing (ADR-0001)', () => {
  // ADR-0001 non-vacuity proof for every attacker-influenced `sanitizeMeta` sink in
  // `plugin.ts`. `cwe117-regression.test.ts` asserts the sanitizer PRIMITIVE in
  // isolation; these tests drive the REGISTERED plugin over real HTTP injection
  // with a validator / session-pattern whose `reason` or `category`
  // carries control characters, and assert the ESCAPED form at each sink — removing
  // the matching `sanitizeMeta(...)` wrap from src turns the corresponding test RED.
  // The engine returns the validator's RAW `reason` to the plugin (`aggregateResults`
  // does not pre-sanitize) and `SessionTracker` embeds the RAW `category` verbatim in
  // its escalation reason, so each per-sink wrap is the genuine CWE-117 boundary. The
  // plugin logs via `logger.warn` DIRECTLY (not core `logValidationFailure`, which
  // sanitizes independently) so the spy-logger meta assertions are non-vacuous. Sinks
  // are located by their plugin log-message / response-field strings, not line numbers:
  //   - dev error-handler response-body `reason`
  //   - '[Guardrails] Session escalated …' pre/post-validation log meta. The
  //     reason is sanitized and the private session identifier is omitted.
  //   - '[Guardrails] Request blocked' log meta (`reason` + route-template `path`)
  //   - '[Guardrails] Response blocked' log meta + the dev-mode filtered-response body
  //     `reason` (one shared `safeReason` sink) + route-template `path`
  const NL = String.fromCharCode(10); // LF
  const CR = String.fromCharCode(13); // CR
  const ESC = String.fromCharCode(27); // ESC
  const TAB = String.fromCharCode(9); // TAB
  const CRLF = `${CR}${NL}`; // CRLF (Windows line ending)
  // sanitizeLogString hex-escapes CR→\x0d and TAB→\x09 (and CRLF→\x0d\n) in its
  // control-char pass, which runs BEFORE the \n-collapse — so only LF maps to \n.
  // The shared RAW_REASON and connector-specific category/path
  // sinks all drive the full LF/CR/CRLF/TAB/ESC class; each ESCAPED_* form below
  // is derived from the real primitive (not hand-guessed).
  const RAW_REASON = `matched${NL}INJECTED${ESC}poison${CR}carriage${CRLF}windows${TAB}tab`;
  const SENSITIVE_SESSION_ID = 'synthetic-session-secret';
  const HOSTILE_CATEGORY = `cat${NL}INJECTED${ESC}poison${CR}carriage${CRLF}windows${TAB}tab`;
  // Embedded verbatim in the SessionTracker escalation reason; sanitizeMeta is
  // char-by-char, so the sanitized category appears as a contiguous substring.
  const ESCAPED_CATEGORY = 'cat\\nINJECTED\\x1bpoison\\x0dcarriage\\x0d\\nwindows\\x09tab';
  const POISON = 'POISONMARK';

  // Blocks only when the validated content contains the marker — lets a clean input
  // pass so the model RESPONSE reaches its own (output) sink. Carries a control-char
  // `reason` the plugin returns to the caller + logs.
  const markerBlock = (reason: string) => ({
    name: 'MarkerBlock',
    validate: (input: unknown) =>
      (typeof input === 'string' ? input : '').includes(POISON)
        ? {
            allowed: false,
            blocked: true,
            reason,
            severity: 'critical' as const,
            risk_level: 'HIGH' as const,
            risk_score: 30,
            findings: [],
            timestamp: Date.now()
          }
        : {
            allowed: true,
            blocked: false,
            severity: 'info' as const,
            risk_level: 'LOW' as const,
            risk_score: 0,
            findings: [],
            timestamp: Date.now()
          }
  });

  // Never blocks, but emits a finding under the given `category` every turn so
  // SessionTracker accumulates it toward the repeat-escalation threshold. The
  // escalation reason embeds the raw `category` verbatim.
  const categoryFinding = (category: string) => ({
    name: 'CategoryFinding',
    validate: () => ({
      allowed: true,
      blocked: false,
      severity: 'critical' as const,
      risk_level: 'HIGH' as const,
      risk_score: 100,
      findings: [{ category, severity: 'critical' as const, description: 'hostile pattern', weight: 1 }],
      timestamp: Date.now()
    })
  });

  const createSpyLogger = () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });

  const findWarnMeta = (
    logger: ReturnType<typeof createSpyLogger>,
    message: string
  ): Record<string, unknown> | undefined =>
    logger.warn.mock.calls.find(call => call[0] === message)?.[1] as Record<string, unknown> | undefined;

  let app: FastifyInstance;

  beforeEach(() => {
    clearAllSessions();
  });

  afterEach(async () => {
    await app?.close();
    clearAllSessions();
  });

  it('escapes a control-char reason in the dev error-handler response body', async () => {
    app = Fastify({ logger: false });
    await app.register(guardrailsPlugin, {
      validators: [markerBlock(RAW_REASON) as never],
      productionMode: false,
      logger: createSpyLogger()
    });
    app.post('/test', async () => ({ ok: true }));

    const res = await app.inject({ method: 'POST', url: '/test', payload: { message: `hi ${POISON}` } });

    expect(res.statusCode).toBe(400);
    const body = res.json() as { reason?: string };
    expect(body.reason).toContain('INJECTED');
    expect(body.reason).not.toContain(NL);
    expect(body.reason).not.toContain(CR);
    expect(body.reason).not.toContain(ESC);
    expect(body.reason).not.toContain(TAB);
  });

  it('escapes a control-char reason in the request-blocked log meta', async () => {
    const logger = createSpyLogger();
    app = Fastify({ logger: false });
    await app.register(guardrailsPlugin, {
      validators: [markerBlock(RAW_REASON) as never],
      productionMode: false,
      logger
    });
    app.post('/test', async () => ({ ok: true }));

    await app.inject({ method: 'POST', url: '/test', payload: { message: `hi ${POISON}` } });

    const meta = findWarnMeta(logger, '[Guardrails] Request blocked');
    // Guard: a future rename of the log message must fail loudly here, not make the
    // escaped-form assertions below pass vacuously on an undefined meta.
    expect(meta).toBeDefined();
    expect(meta?.reason).toContain('INJECTED');
    expect(meta?.reason).not.toContain(NL);
    expect(meta?.reason).not.toContain(CR);
    expect(meta?.reason).not.toContain(ESC);
    expect(meta?.reason).not.toContain(TAB);
  });

  it('escapes a control-char reason in the filtered-response body and response-blocked log meta', async () => {
    const logger = createSpyLogger();
    app = Fastify({ logger: false });
    await app.register(guardrailsPlugin, {
      validators: [markerBlock(RAW_REASON) as never],
      validateResponse: true,
      productionMode: false,
      logger
    });
    // Input passes (no marker); the model RESPONSE trips the output block, so the
    // shared `safeReason` lands in BOTH the filtered-response body returned to the
    // caller AND the response-blocked log meta.
    app.post('/test', async () => ({ text: `response ${POISON}` }));

    const res = await app.inject({ method: 'POST', url: '/test', payload: { message: 'clean prompt' } });

    const body = res.json() as { reason?: string };
    expect(body.reason).toContain('INJECTED');
    expect(body.reason).not.toContain(NL);
    expect(body.reason).not.toContain(CR);
    expect(body.reason).not.toContain(ESC);
    expect(body.reason).not.toContain(TAB);
    const meta = findWarnMeta(logger, '[Guardrails] Response blocked');
    expect(meta).toBeDefined();
    expect(meta?.reason).toContain('INJECTED');
    expect(meta?.reason).not.toContain(NL);
    expect(meta?.reason).not.toContain(CR);
    expect(meta?.reason).not.toContain(ESC);
    expect(meta?.reason).not.toContain(TAB);
  });

  it('escapes a hostile-category escalation reason in the post-validation log meta', async () => {
    const logger = createSpyLogger();
    app = Fastify({ logger: false });
    await app.register(guardrailsPlugin, {
      validators: [categoryFinding(HOSTILE_CATEGORY) as never],
      enableSessionTracking: true,
      sessionIdExtractor: () => 'static-session',
      productionMode: false,
      logger
    });
    app.post('/test', async () => ({ ok: true }));

    // Findings accumulate by category; the THRESHOLD-th turn fires the
    // post-validation escalation (drive the loop from the exported constant so a
    // future threshold change self-heals).
    for (let i = 0; i < CATEGORY_REPEAT_THRESHOLD; i++) {
      await app.inject({ method: 'POST', url: '/test', payload: { message: `turn ${i}` } });
    }

    const meta = findWarnMeta(logger, '[Guardrails] Session escalated after validation');
    expect(meta).toBeDefined();
    expect(meta?.reason).toContain(ESCAPED_CATEGORY);
    expect(meta?.reason).not.toContain(NL);
    expect(meta?.reason).not.toContain(CR);
    expect(meta?.reason).not.toContain(ESC);
    expect(meta?.reason).not.toContain(TAB);
  });

  it('omits the session ID from the post-validation escalation log meta', async () => {
    const logger = createSpyLogger();
    app = Fastify({ logger: false });
    await app.register(guardrailsPlugin, {
      validators: [categoryFinding('benign-category') as never],
      enableSessionTracking: true,
      sessionIdExtractor: () => SENSITIVE_SESSION_ID,
      productionMode: false,
      logger
    });
    app.post('/test', async () => ({ ok: true }));

    for (let i = 0; i < CATEGORY_REPEAT_THRESHOLD; i++) {
      await app.inject({ method: 'POST', url: '/test', payload: { message: `turn ${i}` } });
    }

    const meta = findWarnMeta(logger, '[Guardrails] Session escalated after validation');
    expect(meta).toBeDefined();
    expect(meta).not.toHaveProperty('sessionId');
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(SENSITIVE_SESSION_ID);
  });

  it('escapes a hostile-category escalation reason in the pre-validation log meta', async () => {
    const logger = createSpyLogger();
    app = Fastify({ logger: false });
    await app.register(guardrailsPlugin, {
      validators: [categoryFinding(HOSTILE_CATEGORY) as never],
      enableSessionTracking: true,
      sessionIdExtractor: () => 'static-session',
      productionMode: false,
      logger
    });
    app.post('/test', async () => ({ ok: true }));

    // Loop one past the threshold: the first THRESHOLD turns escalate the session
    // (post-validation), then the next turn's start-of-request `isSessionEscalated`
    // check fires the pre-validation block whose `reason` carries the raw category.
    for (let i = 0; i <= CATEGORY_REPEAT_THRESHOLD; i++) {
      await app.inject({ method: 'POST', url: '/test', payload: { message: `turn ${i}` } });
    }

    const meta = findWarnMeta(logger, '[Guardrails] Session escalated, blocking request');
    expect(meta).toBeDefined();
    expect(meta?.reason).toContain(ESCAPED_CATEGORY);
    expect(meta?.reason).not.toContain(NL);
    expect(meta?.reason).not.toContain(CR);
    expect(meta?.reason).not.toContain(ESC);
    expect(meta?.reason).not.toContain(TAB);
  });

  it('omits the session ID from the pre-validation escalation log meta', async () => {
    const logger = createSpyLogger();
    app = Fastify({ logger: false });
    await app.register(guardrailsPlugin, {
      validators: [categoryFinding('benign-category') as never],
      enableSessionTracking: true,
      sessionIdExtractor: () => SENSITIVE_SESSION_ID,
      productionMode: false,
      logger
    });
    app.post('/test', async () => ({ ok: true }));

    for (let i = 0; i <= CATEGORY_REPEAT_THRESHOLD; i++) {
      await app.inject({ method: 'POST', url: '/test', payload: { message: `turn ${i}` } });
    }

    const meta = findWarnMeta(logger, '[Guardrails] Session escalated, blocking request');
    expect(meta).toBeDefined();
    expect(meta).not.toHaveProperty('sessionId');
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(SENSITIVE_SESSION_ID);
  });
});
