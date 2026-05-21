/**
 * Story 1.1b — StreamValidator release-gate integration
 * =====================================================
 * Adds `processForClient(chunk)` + `finalizeForClient()` methods that
 * gate chunks behind a per-cycle validate-before-release pattern. The
 * test fixtures match the Story 1.1b acceptance criteria verbatim:
 *
 *  - 100-char output with secret in chars 50-80 — NO client receives
 *    chars 50+. (Gate < 256 chars, never releases; finalize validates
 *    and blocks; full buffer dropped.)
 *  - 500-char output with secret in chars 300+ — chars 1-256 released
 *    after passing validation; chars 257-500 dropped at the next
 *    validation cycle which catches the secret.
 *  - `minBufferBeforeRelease: Infinity` (full-response mode) is the
 *    only 100% leak prevention.
 *  - `chainHasSecretOrPii: true` (build-time hint) defaults
 *    `minBufferBeforeRelease` to `Infinity` per R2-D1.
 */
import { describe, expect, it } from 'vitest';
import { StreamValidator, type StreamValidatorEngine } from '../../src/connector-utils/stream-validator.js';

function makeEngine(decide: (content: string) => { allowed: boolean; reason?: string }): StreamValidatorEngine {
  return { validate: (content: string) => decide(content) };
}

const SECRET_LITERAL = 'sk-proj-' + 'A'.repeat(50);
const containsSecret = (s: string): boolean => /sk-proj-[A-Za-z0-9_-]{40,}/.test(s);

describe('StreamValidator — processForClient (release gate)', () => {
  it('holds chunks until minCharsBeforeRelease is reached, releases on pass', async () => {
    const engine = makeEngine(() => ({ allowed: true }));
    const v = StreamValidator.create(engine, {
      minBufferBeforeRelease: 8,
      validationInterval: 1,
    });

    const r1 = await v.processForClient('hello ');
    expect(r1.released).toBe('');
    expect(r1.allowed).toBe(true);

    const r2 = await v.processForClient('world!');
    expect(r2.released).toBe('hello world!');
    expect(r2.allowed).toBe(true);
  });

  it('drops the buffer when validation blocks during the buffered period', async () => {
    const engine = makeEngine((content) => ({
      allowed: !containsSecret(content),
      reason: 'secret_in_stream',
    }));
    const v = StreamValidator.create(engine, {
      minBufferBeforeRelease: 16,
      validationInterval: 1,
    });

    const r = await v.processForClient(SECRET_LITERAL);
    expect(r.released).toBe('');
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('secret_in_stream');
    expect(v.blocked).toBe(true);

    const next = await v.processForClient('after-block');
    expect(next.released).toBe('');
    expect(next.allowed).toBe(false);
  });

  it('finalizeForClient releases the pending tail when validation passes', async () => {
    const engine = makeEngine(() => ({ allowed: true }));
    const v = StreamValidator.create(engine, {
      minBufferBeforeRelease: 1024,
      validationInterval: 1,
    });

    await v.processForClient('partial');
    const tail = await v.finalizeForClient();
    expect(tail.released).toBe('partial');
    expect(tail.allowed).toBe(true);
  });

  it('finalizeForClient drops the buffer when the tail fails validation', async () => {
    const engine = makeEngine((content) => ({
      allowed: !containsSecret(content),
      reason: 'secret_at_end',
    }));
    const v = StreamValidator.create(engine, {
      minBufferBeforeRelease: 1024,
      validationInterval: 1,
    });

    await v.processForClient('safe-prefix ');
    await v.processForClient(SECRET_LITERAL);
    const tail = await v.finalizeForClient();
    expect(tail.released).toBe('');
    expect(tail.allowed).toBe(false);
    expect(tail.reason).toBe('secret_at_end');
  });

  it('finalizeForClient is idempotent', async () => {
    const engine = makeEngine(() => ({ allowed: true }));
    const v = StreamValidator.create(engine, {
      minBufferBeforeRelease: 1024,
      validationInterval: 1,
    });
    await v.processForClient('content');
    const first = await v.finalizeForClient();
    expect(first.released).toBe('content');
    const second = await v.finalizeForClient();
    expect(second.released).toBe('');
    expect(second.allowed).toBe(true);
  });
});

describe('StreamValidator — release gate AC fixtures (Story 1.1b)', () => {
  it('AC-1: 100-char stream with secret in chars 50-80 — NO client receives any chars', async () => {
    const engine = makeEngine((content) => ({
      allowed: !containsSecret(content),
      reason: 'leak_blocked',
    }));
    const v = StreamValidator.create(engine, {
      minBufferBeforeRelease: 256,
      validationInterval: 1,
    });

    const released: string[] = [];
    const chunks = [
      'A'.repeat(40),                                  // chars 1-40
      'B'.repeat(10) + SECRET_LITERAL.slice(0, 25),    // chars 41-75
      SECRET_LITERAL.slice(25, 60) + 'C'.repeat(5),    // chars 76-115 (still under 256)
    ];

    for (const c of chunks) {
      const r = await v.processForClient(c);
      if (r.released) released.push(r.released);
      if (!r.allowed) break;
    }
    const tail = await v.finalizeForClient();
    if (tail.released) released.push(tail.released);

    const concatenated = released.join('');
    // Buffer never crossed 256 mid-stream → no in-stream release.
    // Finalize validates the full 115-char buffer, catches secret, drops.
    expect(concatenated).toBe('');
    expect(containsSecret(concatenated)).toBe(false);
  });

  it('AC-2: 500-char stream with secret at chars 300+ — chars 1-256 released; chars 257-500 not sent', async () => {
    const engine = makeEngine((content) => ({
      allowed: !containsSecret(content),
      reason: 'leak_blocked',
    }));
    const v = StreamValidator.create(engine, {
      minBufferBeforeRelease: 256,
      validationInterval: 1,
    });

    const released: string[] = [];
    // Stream 5 chunks of 100 chars; place secret starting at char 300.
    const chunks = [
      'A'.repeat(100),                                 // 1-100
      'B'.repeat(100),                                 // 101-200
      'C'.repeat(99) + 'D',                            // 201-300
      SECRET_LITERAL.slice(0, 100),                    // 301-400 (secret region)
      'E'.repeat(100),                                 // 401-500
    ];

    for (const c of chunks) {
      const r = await v.processForClient(c);
      if (r.released) released.push(r.released);
      if (!r.allowed) break;
    }
    const tail = await v.finalizeForClient();
    if (tail.released) released.push(tail.released);

    const concatenated = released.join('');
    expect(concatenated.length).toBeGreaterThanOrEqual(256);
    expect(concatenated.length).toBeLessThan(500);
    expect(containsSecret(concatenated)).toBe(false);
  });

  it('AC-3: minBufferBeforeRelease=Infinity never releases until finalize (full-response mode)', async () => {
    const engine = makeEngine(() => ({ allowed: true }));
    const v = StreamValidator.create(engine, {
      minBufferBeforeRelease: Infinity,
      validationInterval: 1,
    });
    for (let i = 0; i < 50; i++) {
      const r = await v.processForClient('chunk');
      expect(r.released).toBe('');
    }
    const final = await v.finalizeForClient();
    expect(final.allowed).toBe(true);
    expect(final.released.length).toBe(50 * 5);
  });

  it('AC-3b: full-response mode blocks the entire response when validator catches', async () => {
    const engine = makeEngine((content) => ({
      allowed: !containsSecret(content),
      reason: 'full_response_blocked',
    }));
    const v = StreamValidator.create(engine, {
      minBufferBeforeRelease: Infinity,
      validationInterval: 1,
    });
    await v.processForClient('benign prefix ');
    await v.processForClient(SECRET_LITERAL);
    const final = await v.finalizeForClient();
    expect(final.released).toBe('');
    expect(final.allowed).toBe(false);
  });

  it('R2-D1: chainHasSecretOrPii=true forces minBufferBeforeRelease default to Infinity', async () => {
    const engine = makeEngine(() => ({ allowed: true }));
    const v = StreamValidator.create(engine, {
      chainHasSecretOrPii: true,
      validationInterval: 1,
    });
    // No explicit minBufferBeforeRelease — default flips to Infinity.
    for (let i = 0; i < 20; i++) {
      const r = await v.processForClient('chunk');
      expect(r.released).toBe('');
    }
    const final = await v.finalizeForClient();
    expect(final.released.length).toBe(20 * 5);
  });

  it('R2-D1: explicit minBufferBeforeRelease overrides chainHasSecretOrPii hint', async () => {
    const engine = makeEngine(() => ({ allowed: true }));
    const v = StreamValidator.create(engine, {
      chainHasSecretOrPii: true,
      minBufferBeforeRelease: 0,
      validationInterval: 1,
    });
    const r = await v.processForClient('immediate');
    expect(r.released).toBe('immediate');
  });

  it('R2-D1: no hint, no explicit setting → default 256 chars', async () => {
    const engine = makeEngine(() => ({ allowed: true }));
    const v = StreamValidator.create(engine, { validationInterval: 1 });

    // 5 × 60 = 300 chars: crosses the default 256 threshold on the 5th push.
    let totalReleased = 0;
    for (let i = 0; i < 5; i++) {
      const r = await v.processForClient('A'.repeat(60));
      totalReleased += r.released.length;
    }
    expect(totalReleased).toBeGreaterThanOrEqual(256);
  });
});

describe('StreamValidator — release gate + existing API coexistence', () => {
  it('process() (legacy API) still works unchanged when release gate is configured', async () => {
    const engine = makeEngine(() => ({ allowed: true }));
    const v = StreamValidator.create(engine, {
      minBufferBeforeRelease: 16,
      validationInterval: 2,
    });
    await v.process('a');
    const result = await v.process('b'); // boundary
    expect(result?.allowed).toBe(true);
    expect(result?.accumulated).toBe('ab');
  });

  it('process() then processForClient() throws (mode mismatch)', async () => {
    const engine = makeEngine(() => ({ allowed: true }));
    const v = StreamValidator.create(engine, { validationInterval: 1 });
    await v.process('a');
    await expect(v.processForClient('b')).rejects.toThrow(/Pick one lifecycle/);
  });

  it('processForClient() then process() throws (mode mismatch)', async () => {
    const engine = makeEngine(() => ({ allowed: true }));
    const v = StreamValidator.create(engine, { validationInterval: 1 });
    await v.processForClient('a');
    await expect(v.process('b')).rejects.toThrow(/Pick one lifecycle/);
  });

  it('finalize() no-ops in gated mode (no double validation)', async () => {
    let calls = 0;
    const engine = makeEngine(() => {
      calls++;
      return { allowed: true };
    });
    const v = StreamValidator.create(engine, {
      minBufferBeforeRelease: 1024,
      validationInterval: 1,
    });
    await v.processForClient('content');
    // Manual finalize() in gated mode is a no-op — finalizeForClient is the right API.
    expect(await v.finalize()).toBeNull();
    expect(calls).toBe(0); // no validation fired via legacy path
    const tail = await v.finalizeForClient();
    expect(tail.released).toBe('content');
    expect(calls).toBe(1); // exactly one validation total
  });

  it('processForClient catches engine errors and returns release-result (no rethrow)', async () => {
    let calls = 0;
    const engine: StreamValidatorEngine = {
      validate(): { allowed: boolean } {
        calls++;
        throw new Error('upstream-timeout');
      },
    };
    const v = StreamValidator.create(engine, {
      minBufferBeforeRelease: 4,
      validationInterval: 1,
    });
    const r = await v.processForClient('hello');
    expect(r.allowed).toBe(false);
    expect(r.released).toBe('');
    expect(r.reason).toContain('engine_error');
    expect(r.reason).toContain('upstream-timeout');
    expect(v.blocked).toBe(true);
    expect(calls).toBe(1);
  });

  it('finalizeForClient catches engine errors and returns release-result', async () => {
    const engine: StreamValidatorEngine = {
      validate(): { allowed: boolean } {
        throw new Error('finalize-fail');
      },
    };
    const v = StreamValidator.create(engine, {
      minBufferBeforeRelease: 1024,
      validationInterval: 1,
    });
    await v.processForClient('partial');
    const tail = await v.finalizeForClient();
    expect(tail.allowed).toBe(false);
    expect(tail.released).toBe('');
    expect(tail.reason).toContain('engine_error');
  });

  it('finalizeForClient idempotent second-call surfaces stream_already_blocked reason', async () => {
    const engine = makeEngine((content) => ({
      allowed: !containsSecret(content),
      reason: 'leak',
    }));
    const v = StreamValidator.create(engine, {
      minBufferBeforeRelease: 1024,
      validationInterval: 1,
    });
    await v.processForClient(SECRET_LITERAL);
    const first = await v.finalizeForClient();
    expect(first.allowed).toBe(false);
    const second = await v.finalizeForClient();
    expect(second.allowed).toBe(false);
    expect(second.reason).toBe('stream_already_blocked');
  });

  it('BufferedReleaseGate constructor rejects NaN and negative thresholds', async () => {
    const { BufferedReleaseGate } = await import('../../src/connector-utils/buffered-release-gate.js');
    expect(() => new BufferedReleaseGate({ minCharsBeforeRelease: NaN })).toThrow(RangeError);
    expect(() => new BufferedReleaseGate({ minCharsBeforeRelease: -1 })).toThrow(RangeError);
    // Infinity and 0 are valid.
    expect(() => new BufferedReleaseGate({ minCharsBeforeRelease: Infinity })).not.toThrow();
    expect(() => new BufferedReleaseGate({ minCharsBeforeRelease: 0 })).not.toThrow();
  });
});
