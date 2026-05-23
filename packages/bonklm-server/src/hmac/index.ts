/**
 * HMAC-SHA256 auth module for the BonkLM guardrail server.
 *
 * Story 2.13 AC: `X-Bonklm-Signature` + `X-Bonklm-Timestamp` headers,
 * 5-minute replay window. Timing-safe comparison via
 * `crypto.timingSafeEqual`.
 *
 * Signature format: `sha256=<hex>` where `<hex>` is HMAC-SHA256 of
 * the concatenation `${timestamp}.${rawBody}` using the shared secret.
 *
 * @package @blackunicorn/bonklm-server/hmac
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/** Default replay window — 5 minutes per Story 2.13 AC. */
export const DEFAULT_REPLAY_WINDOW_MS = 5 * 60 * 1000;

/** Header names per Story 2.13 AC. */
export const HMAC_SIGNATURE_HEADER = 'x-bonklm-signature';
export const HMAC_TIMESTAMP_HEADER = 'x-bonklm-timestamp';

export interface HmacVerifyOptions {
  rawBody: string;
  signature: string | undefined;
  timestamp: string | undefined;
  secret: string;
  replayWindowMs?: number;
  nowMs?: () => number;
}

export type HmacVerifyResult =
  | { valid: true }
  | { valid: false; reason: HmacFailureReason };

export type HmacFailureReason =
  | 'missing_signature'
  | 'missing_timestamp'
  | 'malformed_timestamp'
  | 'malformed_signature'
  | 'replay_window_exceeded'
  | 'signature_mismatch';

/**
 * Verify an HMAC-SHA256 signature against a raw request body.
 * Timing-safe comparison + replay-window enforcement.
 */
export function verifyHmacSignature(
  options: HmacVerifyOptions
): HmacVerifyResult {
  const { rawBody, signature, timestamp, secret } = options;
  const replayWindowMs = options.replayWindowMs ?? DEFAULT_REPLAY_WINDOW_MS;
  const nowMs = options.nowMs ?? Date.now;

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

  const drift = Math.abs(nowMs() - tsNum);
  if (drift > replayWindowMs) {
    return { valid: false, reason: 'replay_window_exceeded' };
  }

  // Story 2.13 audit sec S3 closure: enforce EXACTLY 64 hex chars
  // (SHA-256 output length). The previous `[0-9a-f]+` permissive
  // form created a timing-oracle micro-leak: an attacker could
  // distinguish "wrong length" from "right length, wrong value" via
  // the early-return path in the length-mismatch branch below.
  // Restricting at the regex level eliminates that branch entirely.
  const sigMatch = /^sha256=([0-9a-f]{64})$/i.exec(signature);
  if (sigMatch === null) {
    return { valid: false, reason: 'malformed_signature' };
  }
  const providedHex = sigMatch[1].toLowerCase();

  const hmac = createHmac('sha256', secret);
  hmac.update(`${timestamp}.${rawBody}`);
  const expectedHex = hmac.digest('hex');

  const providedBuf = Buffer.from(providedHex, 'hex');
  const expectedBuf = Buffer.from(expectedHex, 'hex');
  if (providedBuf.length !== expectedBuf.length) {
    return { valid: false, reason: 'signature_mismatch' };
  }
  if (!timingSafeEqual(providedBuf, expectedBuf)) {
    return { valid: false, reason: 'signature_mismatch' };
  }

  return { valid: true };
}

/**
 * Construct a valid `X-Bonklm-Signature` value for a given body +
 * timestamp + secret. Useful for test harnesses + client SDKs.
 */
export function signHmac(
  rawBody: string,
  timestamp: string | number,
  secret: string
): string {
  const ts = String(timestamp);
  const hmac = createHmac('sha256', secret);
  hmac.update(`${ts}.${rawBody}`);
  return `sha256=${hmac.digest('hex')}`;
}
