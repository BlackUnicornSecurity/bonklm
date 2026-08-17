import { createResult, RiskLevel, Severity, type GuardrailResult } from '@blackunicorn/bonklm';
import { noOpValidator } from '@blackunicorn/bonklm/testing';
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import {
  compilePathMatcher,
  guardrailsPlugin,
  handleRequestError,
  rethrowUnsentRouteError,
  runRequestValidation,
  runResponseValidation,
  sessionFindings
} from '../src/plugin.js';

function result(findings: GuardrailResult['findings'] | undefined): GuardrailResult {
  return {
    allowed: true,
    blocked: false,
    findings,
    risk_level: RiskLevel.LOW,
    risk_score: 0,
    severity: Severity.INFO,
    timestamp: 123
  } as GuardrailResult;
}

describe('Fastify plugin internal security boundaries', () => {
  it('validates path patterns and matches only exact path segments', () => {
    expect(() => compilePathMatcher(null as never)).toThrow(/Invalid path pattern/);
    const matcher = compilePathMatcher('/api/health/');
    expect(matcher('' as never)).toBe(false);
    expect(matcher('/api/health')).toBe(true);
    expect(matcher('/api/health/ready')).toBe(true);
    expect(matcher('/api/health-assistant')).toBe(false);
    expect(compilePathMatcher('/')('/anything')).toBe(true);
  });

  it('assigns deterministic session weights and handles a missing finding list', () => {
    expect(sessionFindings(result(undefined))).toEqual([]);
    expect(
      sessionFindings(
        result([
          { category: 'critical', description: 'x', severity: Severity.CRITICAL },
          { category: 'blocked', description: 'x', severity: Severity.BLOCKED },
          { category: 'ordinary', description: 'x', severity: Severity.WARNING },
          { category: 'explicit', description: 'x', severity: Severity.INFO, weight: 7 }
        ])
      ).map(finding => finding.weight)
    ).toEqual([5, 3, 1, 7]);
  });

  it('does not rewrite a sent reply and skips already-validated or excluded work', async () => {
    await expect(
      handleRequestError(new Error('ignored'), {} as never, { sent: true } as never, {} as never)
    ).resolves.toBeUndefined();
    await expect(
      runRequestValidation(
        { _guardrailsValidated: true, routeOptions: { url: '/x' }, url: '/x' } as never,
        {} as never,
        { shouldProcessPaths: () => true } as never
      )
    ).resolves.toBeUndefined();
    await expect(
      runResponseValidation({ routeOptions: { url: '/x' }, url: '/x' } as never, { sent: false } as never, 'payload', {
        shouldProcessPaths: () => false
      } as never)
    ).resolves.toBe('payload');
  });

  it('rejects the unsafe empty validator fallback when validators are omitted', async () => {
    const app = Fastify({ logger: false });
    app.register(guardrailsPlugin, { validateRequest: false });
    await expect(app.ready()).rejects.toThrow(/Empty validator list is unsafe/);
  });

  it('leaves browser security header policy to the hosting framework', async () => {
    const app = Fastify({ logger: false });
    await app.register(guardrailsPlugin, { validators: [noOpValidator()] });
    app.get('/headers', async () => ({ ok: true }));
    const response = await app.inject({ method: 'GET', url: '/headers' });
    await app.close();

    expect(response.headers).not.toHaveProperty('content-security-policy');
    expect(response.headers).not.toHaveProperty('x-frame-options');
    expect(response.headers).not.toHaveProperty('x-content-type-options');
    expect(response.headers).not.toHaveProperty('x-xss-protection');
    expect(response.headers).not.toHaveProperty('referrer-policy');
    expect(response.headers).not.toHaveProperty('permissions-policy');
  });

  it('wires attack logging and contains a throwing custom block handler', async () => {
    const app = Fastify({ logger: false });
    const callback = vi.fn();
    const attackLogger = { getInterceptCallback: vi.fn(() => callback) };
    const logger = { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() };
    await app.register(guardrailsPlugin, {
      attackLogger: attackLogger as never,
      logger,
      onError: async () => Promise.reject(new Error('handler failed')),
      validators: [
        {
          name: 'block-all',
          validate: () => createResult(false, Severity.CRITICAL, [])
        }
      ]
    });
    app.post('/blocked', async () => ({ shouldNotRun: true }));
    const response = await app.inject({ method: 'POST', url: '/blocked', payload: { message: 'blocked' } });
    await app.close();
    expect(attackLogger.getInterceptCallback).toHaveBeenCalledOnce();
    expect(response.statusCode).toBe(400);
    expect(logger.error).toHaveBeenCalledWith(
      '[Guardrails] Custom error handler failed',
      expect.objectContaining({ error: expect.any(Object) })
    );
  });

  it('contains a no-op custom block handler before the protected route runs', async () => {
    const app = Fastify({ logger: false });
    const route = vi.fn(() => ({ shouldNotRun: true }));
    await app.register(guardrailsPlugin, {
      onError: async () => undefined,
      validators: [
        {
          name: 'block-all',
          validate: () => createResult(false, Severity.CRITICAL, [])
        }
      ]
    });
    app.post('/blocked', route);

    const response = await app.inject({ method: 'POST', url: '/blocked', payload: { message: 'blocked' } });
    await app.close();

    expect(route).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual(expect.objectContaining({ error: 'Request blocked' }));
  });

  it('uses a generic reason when a response validator omits one', async () => {
    const removeHeader = vi.fn();
    const reply = {
      getHeader: vi.fn(() => undefined),
      removeHeader,
      sent: false,
      status: vi.fn().mockReturnThis(),
      type: vi.fn().mockReturnThis()
    };
    const logger = { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() };
    const response = await runResponseValidation(
      { routeOptions: { url: '/output' }, url: '/output' } as never,
      reply as never,
      'blocked output',
      {
        logger,
        productionMode: false,
        responseExtractor: (value: unknown) => String(value),
        shouldProcessPaths: () => true,
        usesDefaultResponseExtractor: false,
        validateWithTimeout: async () => ({ ...result([]), allowed: false, blocked: true })
      } as never
    );

    expect(JSON.parse(String(response))).toEqual({
      error: 'Response filtered by guardrails',
      reason: 'Response blocked by security guardrails'
    });
    expect(logger.warn).toHaveBeenCalledWith(
      '[Guardrails] Response blocked',
      expect.objectContaining({ reason: 'Response blocked by security guardrails' })
    );
    expect(removeHeader).toHaveBeenCalled();
  });

  it('rethrows unsent route errors through Fastify error handling', async () => {
    const app = Fastify({ logger: false });
    await app.register(guardrailsPlugin, { validators: [noOpValidator()] });
    app.get('/boom', async () => Promise.reject(new Error('boom')));
    const response = await app.inject({ method: 'GET', url: '/boom' });
    await app.close();
    expect(response.statusCode).toBe(500);
  });

  it('rethrows only while a route reply remains unsent', () => {
    const error = new Error('route error');
    expect(() => rethrowUnsentRouteError({ sent: false } as never, error)).toThrow(error);
    expect(() => rethrowUnsentRouteError({ sent: true } as never, error)).not.toThrow();
  });

  it('does not rethrow a route error after the reply was sent', async () => {
    const app = Fastify({ logger: false });
    await app.register(guardrailsPlugin, { validators: [noOpValidator()] });
    app.get('/sent-then-error', async (_request, reply) => {
      await reply.send({ ok: true });
      throw new Error('after send');
    });
    const response = await app.inject({ method: 'GET', url: '/sent-then-error' });
    await app.close();
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });
});
