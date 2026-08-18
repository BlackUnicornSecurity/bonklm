import type { FastifyRequest } from 'fastify';
import { verifyPortkeyBearer } from './portkey.js';
import {
  HMAC_SIGNATURE_HEADER,
  HMAC_TIMESTAMP_HEADER,
  type HmacFailureReason,
  verifyHmacSignature
} from '../hmac/index.js';
import type { ClaimOutcome } from '../hmac/replay-cache.js';
import type { BonklmServerOptions } from '../types.js';

export type AuthError = Error & {
  code: 'hmac_auth_failed' | 'portkey_auth_failed';
  statusCode: number;
  hmacReason?: string;
  isAuthError: true;
};

type ParserDone = (error: Error | null, parsed?: unknown) => void;

type AuthenticatedRequest = FastifyRequest & {
  bonklmAuthVerified?: true;
  rawBody?: string;
};

export function requestHeader(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function hmacFailureStatus(reason: HmacFailureReason): number {
  // 408 distinguishes clock-skew window failures so unauthenticated
  // probers can classify their own timestamps; every other failure is
  // a uniform 401. Capacity exhaustion is a server-side fail-closed
  // condition, not an auth failure of the caller — 503.
  if (reason === 'replay_window_exceeded') return 408;
  if (reason === 'replay_cache_exhausted') return 503;
  return 401;
}

function authError(reason: HmacFailureReason, code: AuthError['code'] = 'hmac_auth_failed'): AuthError {
  return Object.assign(new Error(code), {
    code,
    statusCode: hmacFailureStatus(reason),
    hmacReason: reason,
    isAuthError: true as const
  });
}

function isJsonRequest(request: FastifyRequest): boolean {
  const contentType = requestHeader(request, 'content-type')?.split(';', 1)[0].trim().toLowerCase();
  return contentType === 'application/json' || /^application\/[^/]+\+json$/.test(contentType ?? '');
}

function requestAuthFailure(
  options: BonklmServerOptions,
  replayWindowMs: number | undefined,
  request: FastifyRequest,
  rawBody: string,
  replayCache?: { claim(signature: string): ClaimOutcome }
): AuthError | null {
  const pathname = request.url.split('?', 1)[0];
  if (pathname === '/portkey' && options.portkeyWebhookSecret !== undefined) {
    return verifyPortkeyBearer(requestHeader(request, 'authorization'), options.portkeyWebhookSecret)
      ? null
      : authError('signature_mismatch', 'portkey_auth_failed');
  }
  const result = verifyHmacSignature({
    rawBody,
    signature: requestHeader(request, HMAC_SIGNATURE_HEADER),
    timestamp: requestHeader(request, HMAC_TIMESTAMP_HEADER),
    secret: options.hmacSecret,
    replayWindowMs,
    ...(replayCache !== undefined ? { replayCache } : {})
  });
  return result.valid ? null : authError(result.reason);
}

export function ensureRequestAuthenticated(
  options: BonklmServerOptions,
  replayWindowMs: number | undefined,
  request: FastifyRequest,
  replayCache?: { claim(signature: string): ClaimOutcome }
): void {
  if (request.method !== 'POST') return;
  const authenticated = request as AuthenticatedRequest;
  if (authenticated.bonklmAuthVerified) return;
  const failure = requestAuthFailure(options, replayWindowMs, request, authenticated.rawBody ?? '', replayCache);
  if (failure !== null) throw failure;
  authenticated.bonklmAuthVerified = true;
}

export function authenticatedBodyParser(
  options: BonklmServerOptions,
  replayWindowMs: number | undefined,
  replayCache?: { claim(signature: string): ClaimOutcome }
) {
  return (request: FastifyRequest, body: unknown, done: ParserDone): void => {
    if (typeof body !== 'string') return done(new Error('expected string body'));
    const authenticated = request as AuthenticatedRequest;
    authenticated.rawBody = body;
    const failure = requestAuthFailure(options, replayWindowMs, request, body, replayCache);
    if (failure !== null) return done(failure);
    authenticated.bonklmAuthVerified = true;
    if (!isJsonRequest(request)) {
      return done(Object.assign(new Error('unsupported_media_type'), { statusCode: 415 }));
    }
    try {
      done(null, body.length > 0 ? JSON.parse(body) : {});
    } catch (error) {
      done(error as Error);
    }
  };
}
