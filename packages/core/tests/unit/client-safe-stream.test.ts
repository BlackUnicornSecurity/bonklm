/**
 * D-058 (EPIC 1.1.3-B) — ClientSafeStreamGate
 * ===========================================
 * Validate-before-release gate for STRUCTURED-chunk connectors. Drives
 * `StreamValidator.processForClient` / `finalizeForClient` while preserving
 * native chunk identity + arrival order.
 *
 * Non-vacuity (ADR-0001): the headline tests assert that chunks preceding a
 * blocked window are NEVER forwarded. A trailing (forward-then-validate)
 * implementation would forward them before the block fires — so these tests
 * fail the instant the gate is bypassed.
 */
import { describe, expect, it } from 'vitest';
import { ClientSafeStreamGate } from '../../src/connector-utils/client-safe-stream.js';
import { StreamValidator, type StreamValidatorEngine } from '../../src/connector-utils/stream-validator.js';

interface Chunk {
  seq: number;
  text: string;
}

function makeEngine(decide: (content: string) => { allowed: boolean; reason?: string }): StreamValidatorEngine {
  return { validate: (content: string) => decide(content) };
}

const SECRET_LITERAL = 'sk-proj-' + 'A'.repeat(50);
const containsSecret = (s: string): boolean => /sk-proj-[A-Za-z0-9_-]{40,}/.test(s);

const allowAll = makeEngine(() => ({ allowed: true }));
const blockSecret = makeEngine(content => ({ allowed: !containsSecret(content), reason: 'secret_in_stream' }));

const text = (c: Chunk): string => c.text;
const seqs = (chunks: Chunk[]): number[] => chunks.map(c => c.seq);

describe('ClientSafeStreamGate — hold + release of structured chunks', () => {
  it('holds chunks until the gate releases, then forwards ALL held chunks in order', async () => {
    const v = StreamValidator.create(allowAll, { minBufferBeforeRelease: 8, validationInterval: 1 });
    const gate = new ClientSafeStreamGate<Chunk>(v, text);

    const r1 = await gate.push({ seq: 1, text: 'hello ' }); // 6 chars < 8 → held
    expect(r1.released).toEqual([]);
    expect(r1.blocked).toBe(false);
    expect(gate.heldCount).toBe(1);

    const r2 = await gate.push({ seq: 2, text: 'world!' }); // total 12 ≥ 8 → release
    expect(seqs(r2.released)).toEqual([1, 2]);
    expect(r2.blocked).toBe(false);
    expect(gate.heldCount).toBe(0);
  });

  it('forwards the ORIGINAL chunk objects (identity preserved, not re-framed text)', async () => {
    const v = StreamValidator.create(allowAll, { minBufferBeforeRelease: 0, validationInterval: 1 });
    const gate = new ClientSafeStreamGate<Chunk>(v, text);

    const c1: Chunk = { seq: 1, text: 'a' };
    const out = await gate.push(c1); // minBuffer 0 → release on every push
    expect(out.released).toHaveLength(1);
    expect(out.released[0]).toBe(c1); // same reference
  });

  it('holds text-free chunks in order; they ride out with the next release', async () => {
    const v = StreamValidator.create(allowAll, { minBufferBeforeRelease: 8, validationInterval: 1 });
    const gate = new ClientSafeStreamGate<Chunk>(v, text);

    await gate.push({ seq: 1, text: 'hello ' }); // held (6 < 8)
    const rEmpty = await gate.push({ seq: 2, text: '' }); // text-free → held, no validation
    expect(rEmpty.released).toEqual([]);
    expect(gate.heldCount).toBe(2);

    const r = await gate.push({ seq: 3, text: 'world!' }); // total 12 ≥ 8 → release
    expect(seqs(r.released)).toEqual([1, 2, 3]); // text-free chunk rides between, order intact
  });

  it('releases trailing text-free chunks at finish even when nothing is pending', async () => {
    const v = StreamValidator.create(allowAll, { minBufferBeforeRelease: 0, validationInterval: 1 });
    const gate = new ClientSafeStreamGate<Chunk>(v, text);

    await gate.push({ seq: 1, text: 'x' }); // released immediately (minBuffer 0)
    const r2 = await gate.push({ seq: 2, text: '' }); // text-free, held
    expect(r2.released).toEqual([]);

    const tail = await gate.finish();
    expect(seqs(tail.released)).toEqual([2]);
    expect(tail.blocked).toBe(false);
  });

  it('an all-text-free stream releases every chunk in order at finish', async () => {
    const v = StreamValidator.create(allowAll, { minBufferBeforeRelease: 8, validationInterval: 1 });
    const gate = new ClientSafeStreamGate<Chunk>(v, text);

    await gate.push({ seq: 1, text: '' });
    await gate.push({ seq: 2, text: '' });
    expect(gate.heldCount).toBe(2);

    const tail = await gate.finish();
    expect(seqs(tail.released)).toEqual([1, 2]);
  });

  it('finish releases the pending tail in order on a clean stream', async () => {
    const v = StreamValidator.create(allowAll, { minBufferBeforeRelease: 1024, validationInterval: 1 });
    const gate = new ClientSafeStreamGate<Chunk>(v, text);

    await gate.push({ seq: 1, text: 'partial ' });
    await gate.push({ seq: 2, text: 'tail' });
    expect(gate.heldCount).toBe(2);

    const tail = await gate.finish();
    expect(seqs(tail.released)).toEqual([1, 2]);
    expect(tail.blocked).toBe(false);
  });
});

describe('ClientSafeStreamGate — validate-before-release (non-vacuity / leak prevention)', () => {
  it('NEVER forwards held chunks when a later chunk in the buffered window blocks', async () => {
    // minBuffer 64: chunk 1 (benign, < 64) is held; chunk 2 carries the secret
    // and trips validation. A trailing impl would already have forwarded
    // chunk 1 → this assertion fails if the gate is bypassed.
    const v = StreamValidator.create(blockSecret, { minBufferBeforeRelease: 64, validationInterval: 1 });
    const gate = new ClientSafeStreamGate<Chunk>(v, text);

    const forwarded: Chunk[] = [];

    const r1 = await gate.push({ seq: 1, text: 'totally benign preamble ' }); // 24 < 64 → held
    forwarded.push(...r1.released);
    expect(r1.released).toEqual([]);

    const r2 = await gate.push({ seq: 2, text: SECRET_LITERAL }); // pushes over 64 → validate → block
    forwarded.push(...r2.released);
    expect(r2.blocked).toBe(true);
    expect(r2.reason).toBe('secret_in_stream');
    expect(r2.released).toEqual([]);

    expect(forwarded).toEqual([]); // the benign preamble NEVER reached the client
    expect(gate.blocked).toBe(true);
    expect(gate.heldCount).toBe(0); // held buffer dropped on block
  });

  it('full-response mode (Infinity) forwards NOTHING until finish, drops all on tail block', async () => {
    const v = StreamValidator.create(blockSecret, { minBufferBeforeRelease: Infinity, validationInterval: 1 });
    const gate = new ClientSafeStreamGate<Chunk>(v, text);

    const forwarded: Chunk[] = [];
    const r1 = await gate.push({ seq: 1, text: 'safe lead-in ' });
    forwarded.push(...r1.released);
    const r2 = await gate.push({ seq: 2, text: SECRET_LITERAL });
    forwarded.push(...r2.released);

    expect(forwarded).toEqual([]); // nothing released mid-stream in full-response mode
    expect(r1.blocked).toBe(false);
    expect(r2.blocked).toBe(false); // Infinity gate never validates mid-stream

    const tail = await gate.finish(); // final pass over the full accumulator catches the secret
    expect(tail.blocked).toBe(true);
    expect(tail.reason).toBe('secret_in_stream');
    expect(tail.released).toEqual([]);
    expect(forwarded).toEqual([]); // still nothing forwarded — 100% leak prevention
  });

  it('full-response mode forwards the whole stream at finish when it validates clean', async () => {
    const v = StreamValidator.create(allowAll, { minBufferBeforeRelease: Infinity, validationInterval: 1 });
    const gate = new ClientSafeStreamGate<Chunk>(v, text);

    await gate.push({ seq: 1, text: 'safe ' });
    await gate.push({ seq: 2, text: 'response' });
    expect(gate.heldCount).toBe(2);

    const tail = await gate.finish();
    expect(seqs(tail.released)).toEqual([1, 2]);
    expect(tail.blocked).toBe(false);
  });
});

describe('ClientSafeStreamGate — block + finalize edge cases', () => {
  it('drops the held buffer and blocks when the tail fails at finish', async () => {
    const v = StreamValidator.create(blockSecret, { minBufferBeforeRelease: 1024, validationInterval: 1 });
    const gate = new ClientSafeStreamGate<Chunk>(v, text);

    await gate.push({ seq: 1, text: 'safe-prefix ' }); // held (< 1024)
    await gate.push({ seq: 2, text: SECRET_LITERAL }); // still held (< 1024)
    expect(gate.heldCount).toBe(2);

    const tail = await gate.finish();
    expect(tail.blocked).toBe(true);
    expect(tail.reason).toBe('secret_in_stream');
    expect(tail.released).toEqual([]);
  });

  it('returns blocked on push after a block, without forwarding', async () => {
    const v = StreamValidator.create(blockSecret, { minBufferBeforeRelease: 0, validationInterval: 1 });
    const gate = new ClientSafeStreamGate<Chunk>(v, text);

    const blockedR = await gate.push({ seq: 1, text: SECRET_LITERAL });
    expect(blockedR.blocked).toBe(true);

    const after = await gate.push({ seq: 2, text: 'after-block' });
    expect(after.blocked).toBe(true);
    expect(after.reason).toBe('stream_already_blocked');
    expect(after.released).toEqual([]);

    // finish() after an already-blocked stream reports blocked, releases nothing.
    const fin = await gate.finish();
    expect(fin.blocked).toBe(true);
    expect(fin.reason).toBe('stream_already_blocked');
    expect(fin.released).toEqual([]);

    // ...and remains idempotent once blocked + finished.
    const finAgain = await gate.finish();
    expect(finAgain.blocked).toBe(true);
    expect(finAgain.released).toEqual([]);
  });

  it('finish is idempotent', async () => {
    const v = StreamValidator.create(allowAll, { minBufferBeforeRelease: 1024, validationInterval: 1 });
    const gate = new ClientSafeStreamGate<Chunk>(v, text);

    await gate.push({ seq: 1, text: 'tail' });
    const first = await gate.finish();
    expect(seqs(first.released)).toEqual([1]);

    const second = await gate.finish();
    expect(second.released).toEqual([]);
    expect(second.blocked).toBe(false);
  });

  it('surfaces a block when the engine throws (fail-closed)', async () => {
    const throwingEngine: StreamValidatorEngine = {
      validate: () => {
        throw new Error('engine exploded');
      }
    };
    const v = StreamValidator.create(throwingEngine, { minBufferBeforeRelease: 0, validationInterval: 1 });
    const gate = new ClientSafeStreamGate<Chunk>(v, text);

    const r = await gate.push({ seq: 1, text: 'anything' });
    expect(r.blocked).toBe(true);
    expect(r.reason).toContain('engine_error');
    expect(r.released).toEqual([]);
    expect(gate.blocked).toBe(true);
  });

  it('fails closed (blocked, no release) when a chunk overflows maxBufferSize', async () => {
    // processForClient → processStreamChunk throws StreamValidationError on
    // overflow, OUTSIDE processForClient's own try/catch. The gate must convert
    // that throw into a fail-closed block, not let it escape or leak held chunks.
    const v = StreamValidator.create(allowAll, { minBufferBeforeRelease: Infinity, maxBufferSize: 16 });
    const gate = new ClientSafeStreamGate<Chunk>(v, text);

    await gate.push({ seq: 1, text: 'under-cap ' }); // 10 bytes ≤ 16 → held
    const overflow = await gate.push({ seq: 2, text: 'this chunk pushes well past the sixteen-byte cap' });
    expect(overflow.blocked).toBe(true);
    expect(overflow.released).toEqual([]);
    expect(gate.blocked).toBe(true);
    expect(gate.heldCount).toBe(0); // held buffer dropped, not leaked

    // No throw escapes; subsequent push is a clean blocked result.
    const after = await gate.push({ seq: 3, text: 'more' });
    expect(after.blocked).toBe(true);
    expect(after.released).toEqual([]);
  });
});
