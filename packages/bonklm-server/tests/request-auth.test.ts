import type { FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';
import { authenticatedBodyParser, ensureRequestAuthenticated, requestHeader } from '../src/auth/request.js';
import { HMAC_SIGNATURE_HEADER, HMAC_TIMESTAMP_HEADER, signHmac } from '../src/hmac/index.js';

const SECRET = 's'.repeat(64);

function request(body: string, overrides: Record<string, unknown> = {}): FastifyRequest {
  const timestamp = Date.now();
  return {
    method: 'POST',
    url: '/litellm',
    headers: {
      'content-type': 'application/json',
      [HMAC_SIGNATURE_HEADER]: signHmac(body, timestamp, SECRET),
      [HMAC_TIMESTAMP_HEADER]: String(timestamp)
    },
    ...overrides
  } as FastifyRequest;
}

function parse(body: unknown, req: FastifyRequest): Promise<unknown> {
  return new Promise((resolve, reject) => {
    authenticatedBodyParser({ hmacSecret: SECRET }, undefined)(req, body, (error, value) => {
      if (error) reject(error);
      else resolve(value);
    });
  });
}

describe('server raw-body authentication boundary', () => {
  it('normalizes repeated and scalar request headers', () => {
    expect(requestHeader({ headers: { authorization: ['first', 'second'] } } as never, 'authorization')).toBe('first');
    expect(requestHeader({ headers: { authorization: 'Bearer token' } } as never, 'authorization')).toBe(
      'Bearer token'
    );
  });

  it('rejects parser inputs that are not strings', async () => {
    await expect(parse(Buffer.from('body'), request('body'))).rejects.toThrow(/expected string body/);
  });

  it('authenticates and parses empty and populated JSON bodies', async () => {
    await expect(parse('', request(''))).resolves.toEqual({});
    await expect(parse('{"ok":true}', request('{"ok":true}'))).resolves.toEqual({ ok: true });
  });

  it('rejects malformed JSON and unsupported media types after authentication', async () => {
    await expect(parse('{', request('{'))).rejects.toBeInstanceOf(SyntaxError);
    await expect(
      parse('plain', request('plain', { headers: { ...request('plain').headers, 'content-type': 'text/plain' } }))
    ).rejects.toMatchObject({ statusCode: 415 });
    const signedWithoutType = request('plain');
    delete signedWithoutType.headers['content-type'];
    await expect(parse('plain', signedWithoutType)).rejects.toMatchObject({ statusCode: 415 });
  });

  it('rejects invalid authentication and permits already verified or non-POST requests', async () => {
    await expect(parse('{}', request('{}', { headers: { 'content-type': 'application/json' } }))).rejects.toMatchObject(
      {
        code: 'hmac_auth_failed'
      }
    );
    expect(() =>
      ensureRequestAuthenticated({ hmacSecret: SECRET }, undefined, { method: 'GET', headers: {}, url: '/' } as never)
    ).not.toThrow();
    expect(() =>
      ensureRequestAuthenticated({ hmacSecret: SECRET }, undefined, {
        method: 'POST',
        headers: {},
        url: '/',
        bonklmAuthVerified: true
      } as never)
    ).not.toThrow();
  });
});
