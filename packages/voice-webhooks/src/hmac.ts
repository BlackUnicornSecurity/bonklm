/**
 * Story 3.4 — Voice-webhooks HMAC primitives
 * ============================================
 *
 * Both Vapi (HTTP) and Retell (WebSocket) use HMAC-SHA256 over the
 * raw request body for authentication. Distinct header conventions
 * per vendor:
 *
 *   - Vapi: `X-Vapi-Signature: sha256=<hex>` + `X-Vapi-Timestamp`.
 *     Signature is `hmac(secret, timestamp + "." + rawBody)`.
 *   - Retell: `X-Retell-Signature: <hex>`. No timestamp; signature
 *     is `hmac(secret, rawBody)`. Replay-attack defence lives at
 *     the transport layer (WSS + per-connection auth token).
 *
 * Both use `crypto.timingSafeEqual` for comparison. 32-byte minimum
 * secret enforced at construction.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const MIN_SECRET_LENGTH = 32;
export const DEFAULT_VAPI_REPLAY_WINDOW_MS = 5 * 60 * 1000;

export type HmacFailureReason =
  | 'missing_signature'
  | 'missing_timestamp'
  | 'malformed_timestamp'
  | 'malformed_signature'
  | 'replay_window_exceeded'
  | 'signature_mismatch'
  | 'secret_too_short';

export type HmacVerifyResult = { valid: true } | { valid: false; reason: HmacFailureReason };

export interface VapiHmacOptions {
  rawBody: string;
  signature: string | undefined;
  timestamp: string | undefined;
  secret: string;
  replayWindowMs?: number;
  nowMs?: () => number;
}

export interface RetellHmacOptions {
  rawBody: string;
  signature: string | undefined;
  secret: string;
}

const SHA256_HEX_RE = /^[a-f0-9]{64}$/i;
const SHA256_PREFIXED_RE = /^sha256=([a-f0-9]{64})$/i;

export function verifyVapiHmac(options: VapiHmacOptions): HmacVerifyResult {
  const { rawBody, signature, timestamp, secret } = options;
  if (typeof secret !== 'string' || secret.length < MIN_SECRET_LENGTH) {
    return { valid: false, reason: 'secret_too_short' };
  }
  if (!signature) return { valid: false, reason: 'missing_signature' };
  if (!timestamp) return { valid: false, reason: 'missing_timestamp' };

  const m = SHA256_PREFIXED_RE.exec(signature);
  if (!m) return { valid: false, reason: 'malformed_signature' };
  const providedHex = m[1];

  const tsMs = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(tsMs) || tsMs <= 0 || String(tsMs) !== timestamp.trim()) {
    return { valid: false, reason: 'malformed_timestamp' };
  }
  const now = (options.nowMs ?? Date.now)();
  const window = options.replayWindowMs ?? DEFAULT_VAPI_REPLAY_WINDOW_MS;
  // Sprint 19 Story 3.4 audit closure (security C-3 + code-reviewer
  // CONCERN-1): one-sided replay window — reject future-dated
  // timestamps outright (small clock-skew tolerance) + the standard
  // past-only window. Previous `Math.abs` allowed pre-signed-future
  // captures to remain valid for ~2× the window.
  const CLOCK_SKEW_TOLERANCE_MS = 60_000; // 1 minute
  if (tsMs > now + CLOCK_SKEW_TOLERANCE_MS) {
    return { valid: false, reason: 'replay_window_exceeded' };
  }
  if (now - tsMs > window) {
    return { valid: false, reason: 'replay_window_exceeded' };
  }

  const expectedHex = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`, 'utf8').digest('hex');

  return timingSafeHexEqual(providedHex, expectedHex)
    ? { valid: true }
    : { valid: false, reason: 'signature_mismatch' };
}

export function verifyRetellHmac(options: RetellHmacOptions): HmacVerifyResult {
  const { rawBody, signature, secret } = options;
  if (typeof secret !== 'string' || secret.length < MIN_SECRET_LENGTH) {
    return { valid: false, reason: 'secret_too_short' };
  }
  if (!signature) return { valid: false, reason: 'missing_signature' };

  const m = SHA256_PREFIXED_RE.exec(signature);
  const providedHex = m ? m[1] : signature;
  if (!SHA256_HEX_RE.test(providedHex)) {
    return { valid: false, reason: 'malformed_signature' };
  }

  const expectedHex = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');

  return timingSafeHexEqual(providedHex, expectedHex)
    ? { valid: true }
    : { valid: false, reason: 'signature_mismatch' };
}

/**
 * Sprint 19 Story 3.4 audit closure (code-reviewer BLOCK-1): decode
 * once, assert exactly 32 bytes (SHA-256 output size), then call
 * timingSafeEqual. The previous double length-check was redundant +
 * structurally fragile — if a regex change ever permitted unequal-
 * length hex through, the buffer-decode early-return on
 * `aBuf.length !== bBuf.length` would silently bypass the
 * cryptographic comparison.
 */
const SHA256_BYTES = 32;
function timingSafeHexEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a.toLowerCase(), 'hex');
  const bBuf = Buffer.from(b.toLowerCase(), 'hex');
  if (aBuf.length !== SHA256_BYTES || bBuf.length !== SHA256_BYTES) return false;
  return timingSafeEqual(aBuf, bBuf);
}
