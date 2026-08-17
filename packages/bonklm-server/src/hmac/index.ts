/**
 * HMAC-SHA256 auth module for the BonkLM guardrail server.
 *
 * `X-Bonklm-Signature` + `X-Bonklm-Timestamp` headers,
 * 5-minute replay window. Timing-safe comparison via
 * `crypto.timingSafeEqual`.
 *
 * Signature format: `sha256=<hex>` where `<hex>` is HMAC-SHA256 of
 * the concatenation `${timestamp}.${rawBody}` using the shared secret.
 *
 * @package @blackunicorn/bonklm-server/hmac
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ClaimOutcome } from './replay-cache.js';
import { MAX_FUTURE_SKEW_MS } from './replay-cache.js';

export { DEFAULT_REPLAY_CACHE_SIZE, MAX_FUTURE_SKEW_MS, MAX_REPLAY_CACHE_SIZE, ReplayCache } from './replay-cache.js';
export type { ClaimOutcome, ReplayCacheOptions } from './replay-cache.js';

/** Default replay window — 5 minutes. */
export const DEFAULT_REPLAY_WINDOW_MS = 5 * 60 * 1000;

/** Maximum configurable replay window — 24 hours. */
export const MAX_REPLAY_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Header names. */
export const HMAC_SIGNATURE_HEADER = 'x-bonklm-signature';
export const HMAC_TIMESTAMP_HEADER = 'x-bonklm-timestamp';

export interface HmacVerifyOptions {
  rawBody: string;
  signature: string | undefined;
  timestamp: string | undefined;
  secret: string;
  replayWindowMs?: number;
  nowMs?: () => number;
  /**
   * Seen-signature cache (structural). When supplied, a signature
   * that verifies correctly but was already accepted within the
   * window is rejected as a replay; `'full'` fails closed.
   */
  replayCache?: { claim(signature: string): ClaimOutcome };
}

export type HmacVerifyResult = { valid: true } | { valid: false; reason: HmacFailureReason; replayed?: boolean };

export type HmacFailureReason =
  | 'missing_signature'
  | 'missing_timestamp'
  | 'malformed_timestamp'
  | 'malformed_signature'
  | 'replay_window_exceeded'
  | 'signature_mismatch'
  | 'replay_detected'
  | 'replay_cache_exhausted';

export function assertValidReplayWindowMs(replayWindowMs: number): void {
  if (!Number.isSafeInteger(replayWindowMs) || replayWindowMs < 1 || replayWindowMs > MAX_REPLAY_WINDOW_MS) {
    throw new RangeError(`replayWindowMs must be an integer between 1 and ${MAX_REPLAY_WINDOW_MS}`);
  }
}

/**
 * Verify an HMAC-SHA256 signature against a raw request body.
 * Timing-safe comparison + replay-window enforcement.
 */
export function verifyHmacSignature(options: HmacVerifyOptions): HmacVerifyResult {
  const { rawBody, signature, timestamp, secret } = options;
  const replayWindowMs = options.replayWindowMs ?? DEFAULT_REPLAY_WINDOW_MS;
  const nowMs = options.nowMs ?? Date.now;
  assertValidReplayWindowMs(replayWindowMs);

  if (signature === undefined || signature === null || signature === '') {
    return { valid: false, reason: 'missing_signature' };
  }
  if (timestamp === undefined || timestamp === null || timestamp === '') {
    return { valid: false, reason: 'missing_timestamp' };
  }

  const tsNum = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(tsNum) || String(tsNum) !== timestamp.trim()) {
    return { valid: false, reason: 'malformed_timestamp' };
  }

  const age = nowMs() - tsNum;
  if (age > replayWindowMs || age < -MAX_FUTURE_SKEW_MS) {
    return { valid: false, reason: 'replay_window_exceeded' };
  }

  // Enforce the frozen lowercase SHA-256 wire format before decoding.
  const sigMatch = /^sha256=([0-9a-f]{64})$/.exec(signature);
  if (sigMatch === null) {
    return { valid: false, reason: 'malformed_signature' };
  }
  const providedHex = sigMatch[1];

  const hmac = createHmac('sha256', secret);
  hmac.update(`${timestamp}.${rawBody}`);
  const expectedHex = hmac.digest('hex');

  const providedBuf = Buffer.from(providedHex, 'hex');
  const expectedBuf = Buffer.from(expectedHex, 'hex');
  if (providedBuf.length !== expectedBuf.length) {
    return { valid: false, reason: 'signature_mismatch' };
  }
  if (timingSafeEqual(providedBuf, expectedBuf) === false) {
    return { valid: false, reason: 'signature_mismatch' };
  }

  if (options.replayCache !== undefined) {
    const outcome = options.replayCache.claim(signature);
    if (outcome === 'replay') {
      return { valid: false, reason: 'replay_detected', replayed: true };
    }
    if (outcome === 'full') {
      // Capacity reached after pruning: fail closed rather than
      // silently reopening the replay window via eviction. Visible and
      // alertable — size the cache to window × peak rps.
      return { valid: false, reason: 'replay_cache_exhausted' };
    }
  }

  return { valid: true };
}

/**
 * Construct a valid `X-Bonklm-Signature` value for a given body +
 * timestamp + secret. Useful for test harnesses + client SDKs.
 */
export function signHmac(rawBody: string, timestamp: string | number, secret: string): string {
  const ts = String(timestamp);
  const hmac = createHmac('sha256', secret);
  hmac.update(`${ts}.${rawBody}`);
  return `sha256=${hmac.digest('hex')}`;
}
