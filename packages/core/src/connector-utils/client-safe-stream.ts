/**
 * Connector Utilities — Client-Safe Stream Gate
 * =============================================
 *
 * Bridges the `StreamValidator` validate-before-release
 * lifecycle (`processForClient` / `finalizeForClient`) to connectors that
 * forward **structured** chunks (provider response objects, SSE-framed bytes,
 * SDK event objects) rather than raw text.
 *
 * The core `StreamValidator.processForClient` releases a TEXT substring; a
 * structured-chunk connector cannot forward that substring in place of its
 * native chunk without corrupting the wire protocol (a Google response object,
 * a Vercel data-stream frame, a v5/v6 event). This gate holds the *native*
 * chunks in arrival order and releases the **original** chunks — never
 * re-framed text — once the release-gate has cleared their extracted text.
 *
 * Invariant that makes this sound: when `StreamValidator.processForClient`
 * signals a release it drains its ENTIRE pending buffer (`takePending()`), and
 * that buffer is exactly the concatenation of the chunk texts pushed since the
 * last release. So a non-empty `released` means *every currently-held chunk*
 * has been validated and cleared — the gate can forward all of them at once,
 * in order.
 *
 * Behaviour vs. the legacy trailing lifecycle: chunk order and structure are
 * identical; the ONLY change is *when* a chunk reaches the client — after its
 * text validates, not before. Under `minBufferBeforeRelease: Infinity`
 * (full-response mode) nothing is forwarded until `finish()`, which is the only
 * 100% leak-prevention setting (known-limitations §5).
 *
 * **NOT concurrent-safe** — it inherits the `StreamValidator` contract: callers
 * must serialise `push()` per instance (one in-flight call at a time). The
 * `for await (...)` consumption pattern standard for LLM streams satisfies this.
 *
 * @package @blackunicorn/bonklm/core
 */

import type { StreamValidator } from './stream-validator.js';

/**
 * Public, connector-facing options for opting a streaming connector into the
 * client-safe validate-before-release lifecycle. Connectors embed these fields
 * in their own option types so the surface is identical everywhere.
 *
 * The gate-tuning fields mirror the corresponding `StreamValidationOptions`
 * and are passed straight through to `StreamValidator.create` — the default
 * derivation (256 chars, or `Infinity` when `chainHasSecretOrPii`) happens
 * there.
 */
export interface ClientSafeStreamOptions {
  /**
   * Streaming release lifecycle.
   * - `'trailing'` (default): legacy behaviour — chunks are forwarded as they
   *   arrive and validated on a trailing schedule, so output can reach the
   *   client before validation completes (known-limitations §5/§9).
   * - `'gated'`: chunks are held until the release gate clears their text, then
   *   the ORIGINAL chunks are forwarded — no unvalidated output reaches the
   *   client. Adds latency (up to the release threshold) and delivers chunks in
   *   bursts at release boundaries.
   * @default 'trailing'
   */
  streamReleaseMode?: 'trailing' | 'gated';
  /**
   * `'gated'`-mode release threshold in characters. Lower = lower latency but a
   * larger partial-leak window; `Infinity` = full-response mode (the only 100%
   * leak-prevention setting). Ignored in `'trailing'` mode.
   * @default 256 (or `Infinity` when {@link chainHasSecretOrPii} is `true`)
   */
  minBufferBeforeRelease?: number;
  /**
   * Build-time hint that Secret and/or PII validators are wired in the chain.
   * In `'gated'` mode this flips the {@link minBufferBeforeRelease} default to
   * `Infinity` (full-response mode). No effect if `minBufferBeforeRelease` is
   * set explicitly, or in `'trailing'` mode.
   * @default false
   */
  chainHasSecretOrPii?: boolean;
  /**
   * `'gated'`-mode sentence-boundary release heuristic.
   * @default true
   */
  detectSentenceBoundary?: boolean;
  /**
   * `'gated'`-mode minimum buffer length before a sentence terminator can
   * trigger a release (filters abbreviation false-positives).
   * @default 32
   */
  minSentenceLength?: number;
}

/**
 * Outcome of a {@link ClientSafeStreamGate} step.
 */
export interface ClientSafeGateResult<TChunk> {
  /**
   * Native chunks cleared for forwarding this step, in arrival order.
   * Empty while the gate is still holding (or after a block).
   */
  released: TChunk[];
  /** `true` once validation has blocked the stream. */
  blocked: boolean;
  /** Block reason — present only when `blocked` is `true`. */
  reason?: string;
}

/** Normalise a thrown value to a block-reason string. */
function reasonFromError(err: unknown): string {
  return err instanceof Error ? err.message : 'stream_error';
}

/**
 * Drives validate-before-release for a structured-chunk stream.
 *
 * @typeParam TChunk - the connector's native chunk type (response object,
 * byte frame, event, …). Released chunks are the exact objects passed to
 * {@link ClientSafeStreamGate.push} — identity is preserved.
 *
 * @example
 * ```ts
 * const validator = StreamValidator.create(engine, { minBufferBeforeRelease: 256 });
 * const gate = new ClientSafeStreamGate(validator, (c: ResponseChunk) => responseToText(c));
 * for await (const chunk of upstream) {
 *   const r = await gate.push(chunk);
 *   if (r.blocked) throw new Error(r.reason);
 *   for (const out of r.released) yield out; // forward ORIGINAL chunks
 * }
 * const tail = await gate.finish();
 * if (tail.blocked) throw new Error(tail.reason);
 * for (const out of tail.released) yield out;
 * ```
 */
export class ClientSafeStreamGate<TChunk> {
  private held: TChunk[] = [];
  private finished = false;
  /**
   * Set when the validator throws OUTSIDE its own try/catch — the only such
   * path today is a `maxBufferSize` overflow in `processStreamChunk`, which
   * throws before `processForClient` can convert it to a release result. We
   * fail closed: drop the held buffer and report blocked so the gate's
   * `{ blocked: true }` contract holds regardless of how the validator signals.
   */
  private errored = false;

  /**
   * @param validator   a `StreamValidator` in the `gated` lifecycle — the gate
   *                     calls only `processForClient` / `finalizeForClient`, so
   *                     it never mixes lifecycles (the validator's mix-safety
   *                     guard stays intact).
   * @param extractText maps a native chunk to the text that should be validated
   *                     for it. MUST match the text the connector would have
   *                     validated under the legacy lifecycle so detection
   *                     semantics are unchanged. Return `''` for chunks that
   *                     carry no validatable text (e.g. function-call-only
   *                     frames) — they ride out in order with the next release.
   */
  constructor(
    private readonly validator: StreamValidator,
    private readonly extractText: (chunk: TChunk) => string
  ) {}

  /**
   * Feed one native chunk. Returns the chunks (if any) now cleared for
   * forwarding, in arrival order. Text-free chunks are held in order and ride
   * out with the next release / {@link finish} so ordering is never broken.
   *
   * On block, every held chunk is dropped (NEVER forwarded) and
   * `{ blocked: true }` is returned — the connector must surface the block to
   * its caller and stop forwarding.
   */
  async push(chunk: TChunk): Promise<ClientSafeGateResult<TChunk>> {
    if (this.blocked) {
      return { released: [], blocked: true, reason: 'stream_already_blocked' };
    }

    this.held.push(chunk);

    const text = this.extractText(chunk);
    if (text.length === 0) {
      // Nothing to validate for this chunk; it rides out with the next
      // release (or finish), preserving arrival order.
      return { released: [], blocked: false };
    }

    let result;
    try {
      result = await this.validator.processForClient(text);
    } catch (err) {
      // Fail closed: a throw here (e.g. maxBufferSize overflow from
      // processStreamChunk, which the validator throws before it can convert
      // to a release result) must NOT leak the held buffer.
      this.errored = true;
      this.held = [];
      return { released: [], blocked: true, reason: reasonFromError(err) };
    }
    if (!result.allowed) {
      this.held = [];
      return { released: [], blocked: true, reason: result.reason };
    }
    if (result.released.length > 0) {
      // The gate drained its whole buffer → every held chunk is cleared.
      return { released: this.drainHeld(), blocked: false };
    }
    return { released: [], blocked: false };
  }

  /**
   * Flush at end-of-stream. Validates the tail held in the release gate; on
   * pass, releases every still-held chunk (the text-bearing tail plus any
   * trailing text-free chunks), all covered by the final validation pass over
   * the full accumulator. On block, held chunks are dropped.
   *
   * Idempotent: subsequent calls return `{ released: [] }` with the recorded
   * block state.
   */
  async finish(): Promise<ClientSafeGateResult<TChunk>> {
    if (this.finished) {
      return {
        released: [],
        blocked: this.blocked,
        reason: this.blocked ? 'stream_already_blocked' : undefined
      };
    }
    this.finished = true;

    if (this.blocked) {
      this.held = [];
      return { released: [], blocked: true, reason: 'stream_already_blocked' };
    }

    let result;
    try {
      result = await this.validator.finalizeForClient();
    } catch (err) {
      this.errored = true;
      this.held = [];
      return { released: [], blocked: true, reason: reasonFromError(err) };
    }
    if (!result.allowed) {
      this.held = [];
      return { released: [], blocked: true, reason: result.reason };
    }
    // Clean finish: the final validation pass covered the full accumulator, so
    // anything still held (text-bearing tail + trailing text-free chunks) is
    // safe to forward, in order.
    return { released: this.drainHeld(), blocked: false };
  }

  /** `true` once the stream has been blocked (by validation or a fail-closed throw). */
  get blocked(): boolean {
    return this.validator.blocked || this.errored;
  }

  /** Number of chunks currently held back from the client. */
  get heldCount(): number {
    return this.held.length;
  }

  private drainHeld(): TChunk[] {
    const out = this.held;
    this.held = [];
    return out;
  }
}
