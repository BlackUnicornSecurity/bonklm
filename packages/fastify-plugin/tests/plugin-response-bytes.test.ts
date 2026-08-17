import { createResult, Severity, type Validator } from '@blackunicorn/bonklm';
import Fastify from 'fastify';
import { Readable } from 'node:stream';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import guardrailsPlugin from '../src/plugin.js';

const byteBlockingValidator: Validator = {
  name: 'ByteResponseBlocker',
  validate: content =>
    createResult(!content.includes('ATTACK'), Severity.CRITICAL, [
      { category: 'response_bytes', description: 'blocked response bytes', severity: Severity.CRITICAL }
    ])
};

describe('Fastify response byte validation', () => {
  it.each([
    ['Buffer', (body: Buffer) => body],
    ['Uint8Array', (body: Buffer) => new Uint8Array(body)]
  ])('validates a raw %s request body as decoded text', async (_label, parse) => {
    const app = Fastify({ logger: false });
    app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_request, body, done) => {
      done(null, parse(body));
    });
    await app.register(guardrailsPlugin, {
      validators: [byteBlockingValidator],
      validateRequest: true,
      validateResponse: false,
      productionMode: true
    });
    app.post('/bytes', async request => ({ forwarded: Buffer.from(request.body as Uint8Array).toString('utf8') }));

    const response = await app.inject({
      method: 'POST',
      url: '/bytes',
      headers: { 'content-type': 'application/octet-stream' },
      payload: Buffer.from('ATTACK')
    });
    await app.close();

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual(expect.objectContaining({ error: 'Request blocked' }));
  });

  it('validates Buffer contents before returning them to the caller', async () => {
    const app = Fastify({ logger: false });
    await app.register(guardrailsPlugin, {
      validators: [byteBlockingValidator],
      validateRequest: false,
      validateResponse: true,
      productionMode: true
    });
    app.get('/bytes', async (_request, reply) => reply.type('text/plain').send(Buffer.from('ATTACK')));

    const response = await app.inject({ method: 'GET', url: '/bytes' });
    await app.close();

    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({ error: 'Response filtered' });
  });

  it('fails closed when the default extractor cannot inspect a stream', async () => {
    const app = Fastify({ logger: false });
    await app.register(guardrailsPlugin, {
      validators: [byteBlockingValidator],
      validateRequest: false,
      validateResponse: true,
      productionMode: true
    });
    app.get('/stream', async (_request, reply) => reply.type('text/plain').send(Readable.from('ATTACK')));

    const response = await app.inject({ method: 'GET', url: '/stream' });
    await app.close();

    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({ error: 'Validation error' });
  });

  it('fails closed when the default extractor receives a web ReadableStream', async () => {
    const app = Fastify({ logger: false });
    await app.register(guardrailsPlugin, {
      validators: [byteBlockingValidator],
      validateRequest: false,
      validateResponse: true,
      productionMode: true
    });
    app.get('/web-stream', async (_request, reply) =>
      reply.type('text/plain').send(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('ATTACK'));
            controller.close();
          }
        })
      )
    );

    const response = await app.inject({ method: 'GET', url: '/web-stream' });
    await app.close();

    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({ error: 'Validation error' });
  });

  it('fails closed when the default extractor receives a web Response', async () => {
    const app = Fastify({ logger: false });
    await app.register(guardrailsPlugin, {
      validators: [byteBlockingValidator],
      validateRequest: false,
      validateResponse: true,
      productionMode: true
    });
    app.get('/web-response', async (_request, reply) =>
      reply.send(new Response('ATTACK', { headers: { 'content-type': 'text/plain' } }))
    );

    const response = await app.inject({ method: 'GET', url: '/web-response' });
    await app.close();

    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({ error: 'Validation error' });
  });

  it('fails closed on an encoded response and clears stale representation headers', async () => {
    const app = Fastify({ logger: false });
    await app.register(guardrailsPlugin, {
      validators: [byteBlockingValidator],
      validateRequest: false,
      validateResponse: true,
      productionMode: true
    });
    app.get('/encoded', async (_request, reply) =>
      reply
        .status(206)
        .headers({
          'cache-control': 'public, max-age=3600',
          'content-encoding': 'gzip',
          'content-range': 'bytes 0-5/6',
          etag: '"unsafe"'
        })
        .type('text/plain')
        .send(gzipSync('ATTACK'))
    );

    const response = await app.inject({ method: 'GET', url: '/encoded' });
    await app.close();

    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({ error: 'Validation error' });
    expect(response.headers['content-type']).toMatch(/^application\/json/);
    expect(response.headers).not.toHaveProperty('content-encoding');
    expect(response.headers).not.toHaveProperty('content-range');
    expect(response.headers).not.toHaveProperty('cache-control');
    expect(response.headers).not.toHaveProperty('etag');
  });
});
