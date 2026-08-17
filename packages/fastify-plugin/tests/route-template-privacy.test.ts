import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Validator, ValidatorInput } from '@blackunicorn/bonklm';
import { guardrailsPlugin } from '../src/plugin.js';

const marker = 'BLOCK-ME';
const secretQuery = 'token=do-not-log-me';
const blocker: Validator = {
  name: 'MarkerBlocker',
  validate(input: string | ValidatorInput) {
    const text = typeof input === 'string' ? input : JSON.stringify(input);
    const blocked = text.includes(marker);
    return {
      allowed: !blocked,
      blocked,
      reason: blocked ? 'marker found' : undefined,
      severity: blocked ? 'critical' : 'info',
      risk_level: blocked ? 'HIGH' : 'LOW',
      risk_score: blocked ? 100 : 0,
      findings: [],
      timestamp: Date.now()
    };
  }
};

function spyLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function blockedPath(logger: ReturnType<typeof spyLogger>, message: string) {
  const call = logger.warn.mock.calls.find(entry => entry[0] === message);
  return (call?.[1] as { path?: string } | undefined)?.path;
}

describe('Fastify blocked-log route privacy', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => app?.close());

  it('logs the request route template without query values', async () => {
    const logger = spyLogger();
    app = Fastify({ logger: false });
    await app.register(guardrailsPlugin, { validators: [blocker], logger });
    app.post('/test/:id', async () => ({ ok: true }));

    await app.inject({ method: 'POST', url: `/test/123?${secretQuery}`, payload: { message: marker } });

    expect(blockedPath(logger, '[Guardrails] Request blocked')).toBe('/test/:id');
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('do-not-log-me');
  });

  it('logs the response route template without query values', async () => {
    const logger = spyLogger();
    app = Fastify({ logger: false });
    await app.register(guardrailsPlugin, { validators: [blocker], validateResponse: true, logger });
    app.post('/test/:id', async () => ({ text: marker }));

    await app.inject({ method: 'POST', url: `/test/123?${secretQuery}`, payload: { message: 'clean' } });

    expect(blockedPath(logger, '[Guardrails] Response blocked')).toBe('/test/:id');
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('do-not-log-me');
  });

  it('omits concrete path segments when an unmatched response has no route template', async () => {
    const logger = spyLogger();
    app = Fastify({ logger: false });
    await app.register(guardrailsPlugin, { validators: [blocker], validateResponse: true, logger });
    app.setNotFoundHandler(async () => ({ text: marker }));

    await app.inject({ method: 'GET', url: `/password-reset/path-secret?${secretQuery}` });

    expect(blockedPath(logger, '[Guardrails] Response blocked')).toBe('<route-unavailable>');
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('path-secret');
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('do-not-log-me');
  });

  it('keeps concrete Fastify 5 path filters compatible while logging the route template', async () => {
    const logger = spyLogger();
    app = Fastify({ logger: false });
    await app.register(guardrailsPlugin, { validators: [blocker], paths: ['/tenant/123'], logger });
    app.post('/tenant/:id', async () => ({ ok: true }));

    const response = await app.inject({
      method: 'POST',
      url: `/tenant/123?${secretQuery}`,
      payload: { message: marker }
    });

    expect(response.statusCode).toBe(400);
    expect(blockedPath(logger, '[Guardrails] Request blocked')).toBe('/tenant/:id');
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('do-not-log-me');
  });

  it('does not treat a sibling route as a descendant of an excluded path', async () => {
    app = Fastify({ logger: false });
    await app.register(guardrailsPlugin, { validators: [blocker], excludePaths: ['/api/health'] });
    app.post('/api/health-assistant', async () => ({ ok: true }));

    const response = await app.inject({
      method: 'POST',
      url: '/api/health-assistant',
      payload: { message: marker }
    });

    expect(response.statusCode).toBe(400);
  });

  it('validates the complete request body instead of only the first recognized field', async () => {
    app = Fastify({ logger: false });
    await app.register(guardrailsPlugin, { validators: [blocker] });
    app.post('/chat', async () => ({ ok: true }));

    const response = await app.inject({
      method: 'POST',
      url: '/chat',
      payload: { message: 'benign', prompt: marker }
    });

    expect(response.statusCode).toBe(400);
  });
});
