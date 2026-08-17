import { describe, expect, it } from 'vitest';
import { DEFAULT_REPLAY_WINDOW_MS, MAX_FUTURE_SKEW_MS, signHmac, verifyHmacSignature } from '../src/hmac/index.js';

const SECRET = 's'.repeat(64);
const BODY = '{"message":"hello"}';
const NOW = 1_800_000_000_000;

function verifyAt(timestamp: number, signature = signHmac(BODY, timestamp, SECRET)) {
  return verifyHmacSignature({
    rawBody: BODY,
    signature,
    timestamp: String(timestamp),
    secret: SECRET,
    nowMs: () => NOW
  });
}

describe('frozen HMAC replay contract', () => {
  it('accepts the exact past replay and future skew boundaries', () => {
    expect(verifyAt(NOW - DEFAULT_REPLAY_WINDOW_MS)).toEqual({ valid: true });
    expect(verifyAt(NOW + MAX_FUTURE_SKEW_MS)).toEqual({ valid: true });
  });

  it('rejects timestamps beyond either one-sided boundary', () => {
    expect(verifyAt(NOW - DEFAULT_REPLAY_WINDOW_MS - 1)).toEqual({
      valid: false,
      reason: 'replay_window_exceeded'
    });
    expect(verifyAt(NOW + MAX_FUTURE_SKEW_MS + 1)).toEqual({
      valid: false,
      reason: 'replay_window_exceeded'
    });
  });

  it('rejects uppercase signature hex as malformed', () => {
    const timestamp = NOW;
    expect(verifyAt(timestamp, signHmac(BODY, timestamp, SECRET).toUpperCase())).toEqual({
      valid: false,
      reason: 'malformed_signature'
    });
  });
});
