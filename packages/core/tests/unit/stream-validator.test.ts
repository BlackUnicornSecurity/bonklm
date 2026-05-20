/**
 * StreamValidator lifecycle class tests.
 */

import { describe, expect, it } from 'vitest';
import {
  hasUnvalidatedTail,
  shouldValidateStream,
  StreamValidator,
  type StreamValidatorEngine,
} from '../../src/connector-utils/stream-validator';

function makeEngine(decide: (content: string) => { allowed: boolean; reason?: string }): StreamValidatorEngine {
  return {
    validate(content: string) {
      return decide(content);
    },
  };
}

describe('StreamValidator lifecycle', () => {
  it('process() validates at interval boundary and finalize() handles the tail', async () => {
    const calls: string[] = [];
    const engine = makeEngine((content) => {
      calls.push(content);
      return { allowed: true };
    });

    const v = StreamValidator.create(engine, { validationInterval: 3 });

    expect(await v.process('a')).toBeNull();
    expect(await v.process('b')).toBeNull();
    const r1 = await v.process('c'); // boundary
    expect(r1).toEqual({ allowed: true, accumulated: 'abc' });

    expect(await v.process('d')).toBeNull();
    const tail = await v.finalize(); // 'abcd' is one chunk past boundary
    expect(tail?.allowed).toBe(true);
    expect(tail?.accumulated).toBe('abcd');

    expect(calls).toEqual(['abc', 'abcd']);
  });

  it('finalize() returns null when stream ended on an interval boundary', async () => {
    const engine = makeEngine(() => ({ allowed: true }));
    const v = StreamValidator.create(engine, { validationInterval: 2 });
    await v.process('a');
    await v.process('b'); // boundary — validated
    expect(await v.finalize()).toBeNull(); // no tail
  });

  it('finalize() is idempotent', async () => {
    const engine = makeEngine(() => ({ allowed: true }));
    const v = StreamValidator.create(engine, { validationInterval: 10 });
    await v.process('hello');
    const first = await v.finalize();
    expect(first?.allowed).toBe(true);
    expect(await v.finalize()).toBeNull(); // second call no-op
  });

  it('marks stream blocked when engine rejects on a boundary', async () => {
    const engine = makeEngine((content) => ({
      allowed: !content.includes('STOP'),
      reason: 'blocked_word',
    }));
    const v = StreamValidator.create(engine, { validationInterval: 2 });
    await v.process('safe'); // chunk 1, no boundary
    const blocked = await v.process('STOP_here'); // chunk 2 = boundary
    expect(blocked?.allowed).toBe(false);
    expect(v.blocked).toBe(true);
    expect(v.accumulated).toBe(''); // markStreamBlocked clears accumulator
    // Subsequent process() calls are no-ops
    expect(await v.process('more')).toBeNull();
    expect(await v.finalize()).toBeNull();
  });

  it('finalize() blocks when the tail contains a violation', async () => {
    const engine = makeEngine((content) => ({
      allowed: !content.includes('STOP'),
      reason: 'blocked_word',
    }));
    const v = StreamValidator.create(engine, { validationInterval: 10 });
    await v.process('safe-prefix');
    await v.process('STOP-after-the-interval'); // never hits boundary at interval=10
    const tail = await v.finalize();
    expect(tail?.allowed).toBe(false);
    expect(tail?.reason).toBe('blocked_word');
  });

  it('Symbol.asyncDispose finalises the validator', async () => {
    const calls: string[] = [];
    const engine = makeEngine((content) => {
      calls.push(content);
      return { allowed: true };
    });

    // Defensive: Symbol.asyncDispose must be defined (Node 20+) and the class
    // must carry a function under that key. Silent degradation here (a method
    // keyed by `undefined` if the symbol isn't present) would defeat the
    // `await using` contract for explicit-resource-management consumers.
    expect(typeof Symbol.asyncDispose).toBe('symbol');
    expect(typeof StreamValidator.prototype[Symbol.asyncDispose]).toBe('function');

    // Exercise the dispose hook directly. `await using` syntax requires
    // `target: ESNext` in tsconfig; calling the symbol method is equivalent
    // for the underlying behaviour.
    const v = StreamValidator.create(engine, { validationInterval: 100 });
    await v.process('only one chunk');
    await v[Symbol.asyncDispose]();
    expect(calls).toEqual(['only one chunk']);
  });

  it('treats interval=0 safely (falls back to default, no NaN)', async () => {
    const engine = makeEngine(() => ({ allowed: true }));
    const v = StreamValidator.create(engine, { validationInterval: 0 });
    // No throw, no NaN-driven loop
    expect(await v.process('hi')).toBeNull();
  });

  it('treats Infinity interval safely (falls back to default)', async () => {
    const engine = makeEngine(() => ({ allowed: true }));
    const v = StreamValidator.create(engine, { validationInterval: Infinity });
    expect(await v.process('hi')).toBeNull();
  });

  it('fails closed when engine.validate() throws (must NOT leave unvalidated content)', async () => {
    let called = 0;
    const engine: StreamValidatorEngine = {
      validate() {
        called++;
        throw new Error('moderation backend down');
      },
    };
    const v = StreamValidator.create(engine, { validationInterval: 2 });
    await v.process('safe-prefix');
    // Second chunk hits interval boundary, engine throws.
    await expect(v.process('STOP-payload')).rejects.toThrow('moderation backend down');
    // Stream MUST be marked blocked so subsequent process() calls are no-ops
    // and accumulated content doesn't leak through as `allowed: true`.
    expect(v.blocked).toBe(true);
    expect(v.accumulated).toBe('');
    expect(await v.process('more')).toBeNull();
    expect(called).toBe(1);
  });
});

describe('stream-validator interval=0 functional helpers', () => {
  it('shouldValidateStream does not produce NaN with interval=0', () => {
    const state = { accumulated: 'abc', chunkCount: 3, blocked: false, byteSize: 3 };
    expect(shouldValidateStream(state, 0)).toBe(false); // default-clamped, 3 % 10 !== 0
  });

  it('hasUnvalidatedTail does not produce NaN with interval=0', () => {
    const state = { accumulated: 'abc', chunkCount: 3, blocked: false, byteSize: 3 };
    expect(hasUnvalidatedTail(state, 0)).toBe(true); // default-clamped, 3 % 10 !== 0
  });
});
