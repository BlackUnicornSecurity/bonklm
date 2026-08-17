import { createResult, Severity, type Validator } from '@blackunicorn/bonklm';
import Fastify5 from 'fastify5';
import Fastify5Min from 'fastify5min';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import guardrailsPlugin from '../src/plugin.js';

const packageJson = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')) as {
  dependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

it('supports only the patched Fastify 5 line', () => {
  expect(packageJson.peerDependencies.fastify).toBe('^5.8.5');
  expect(packageJson.dependencies['fastify-plugin']).toBe('^6.0.0');
  expect(packageJson.devDependencies).not.toHaveProperty('fastify4');
});

it('refuses registration when a forced install provides Fastify 4', async () => {
  const app = Fastify5Min({ logger: false });
  Object.defineProperty(app, 'version', { configurable: true, value: '4.29.1' });

  app.register(guardrailsPlugin, {
    validators: [blockingValidator],
    productionMode: true
  });
  await expect(app.ready()).rejects.toThrow(/expected '>=5\.8\.5 <6' fastify version, '4\.29\.1' is installed/);
  await app.close();
});

const versions = [
  ['Fastify 5 minimum', Fastify5Min, '5.8.5'],
  ['Fastify 5', Fastify5, '5.12.0']
] as const;

const blockingValidator: Validator = {
  name: 'CompatibilityBlocker',
  validate: () =>
    createResult(false, Severity.CRITICAL, [
      { category: 'compatibility_test', description: 'blocked by compatibility test', severity: Severity.CRITICAL }
    ])
};

describe.each(versions)('%s compatibility', (_label, createFastify, expectedVersion) => {
  it('registers the plugin and validates an injected request', async () => {
    const app = createFastify({ logger: false });

    await app.register(guardrailsPlugin, {
      validators: [blockingValidator],
      paths: ['/compat/:id'],
      productionMode: true
    });
    app.post('/compat/:id', async () => ({ compatible: true }));

    const response = await app.inject({ method: 'POST', url: '/compat/123', payload: { message: 'hello' } });
    expect(app.version).toBe(expectedVersion);
    await app.close();

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'Request blocked' });
  });

  it('applies response validation to a parameterized path', async () => {
    const app = createFastify({ logger: false });

    await app.register(guardrailsPlugin, {
      validators: [blockingValidator],
      paths: ['/compat/:id'],
      validateRequest: false,
      validateResponse: true,
      productionMode: true
    });
    app.get('/compat/:id', async () => ({ compatible: true }));

    const response = await app.inject({ method: 'GET', url: '/compat/123' });
    await app.close();

    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({ error: 'Response filtered' });
  });

  it('matches included descendants without matching sibling prefixes', async () => {
    const app = createFastify({ logger: false });

    await app.register(guardrailsPlugin, {
      validators: [blockingValidator],
      paths: ['/compat'],
      productionMode: true
    });
    app.post('/compat/:id', async () => ({ compatible: true }));
    app.post('/compat-tools', async () => ({ compatible: true }));

    const descendant = await app.inject({ method: 'POST', url: '/compat/123', payload: { message: 'hello' } });
    const sibling = await app.inject({ method: 'POST', url: '/compat-tools', payload: { message: 'hello' } });
    await app.close();

    expect(descendant.statusCode).toBe(400);
    expect(sibling.statusCode).toBe(200);
  });

  it('excludes descendants without excluding sibling prefixes', async () => {
    const app = createFastify({ logger: false });

    await app.register(guardrailsPlugin, {
      validators: [blockingValidator],
      excludePaths: ['/health'],
      productionMode: true
    });
    app.post('/health/:check', async () => ({ healthy: true }));
    app.post('/health-assistant', async () => ({ healthy: true }));

    const descendant = await app.inject({ method: 'POST', url: '/health/live', payload: { message: 'hello' } });
    const sibling = await app.inject({ method: 'POST', url: '/health-assistant', payload: { message: 'hello' } });
    await app.close();

    expect(descendant.statusCode).toBe(200);
    expect(sibling.statusCode).toBe(400);
  });
});
