/**
 * Connector Utilities - Stream Validator
 * ======================================
 *
 * Standard utilities for stream validation in connectors.
 * Provides shared streaming logic with buffer size protection.
 *
 * @package @blackunicorn/bonklm/core
 */

import type { Logger } from '../base/GenericLogger.js';
import { StreamValidationError } from './errors.js';
import { BufferedReleaseGate } from './buffered-release-gate.js';

/**
 * Default maximum buffer size for streaming (1MB).
 */
export const DEFAULT_MAX_BUFFER_SIZE = 1024 * 1024;

/**
 * Default validation interval (number of chunks between validations).
 */
export const DEFAULT_VALIDATION_INTERVAL = 10;

/**
 * Story 1.1b (R2-D1) — default `minBufferBeforeRelease` when neither
 * Secret nor PII validators are detected in the chain. 256 chars or
 * first sentence boundary (whichever fires first).
 */
export const DEFAULT_MIN_BUFFER_BEFORE_RELEASE = 256;

/**
 * Stream validation options.
 */
export interface StreamValidationOptions {
  /** Maximum buffer size in bytes (default: 1MB) */
  maxBufferSize?: number;
  /** Number of chunks between validations (default: 10) */
  validationInterval?: number;
  /** Logger for validation events */
  logger?: Logger;
  /** Callback when stream is blocked */
  onBlocked?: (accumulated: string, reason: string) => void;
  /**
   * Story 1.1b (R2-D1) — `processForClient` release-gate threshold.
   *
   * When undefined: defaults to `Infinity` if `chainHasSecretOrPii` is
   * `true`, else `256`. Pass `Infinity` for full-response mode (only
   * 100% leak-prevention setting); pass `0` to release on every push.
   */
  minBufferBeforeRelease?: number;
  /**
   * Story 1.1b (R2-D1, R2-3) — build-time hint from the middleware
   * layer indicating that Secret and/or PII validators are wired in
   * the chain. When `true`, flips the `minBufferBeforeRelease` default
   * to `Infinity`. Has no effect if `minBufferBeforeRelease` is set
   * explicitly.
   *
   * **Evaluated once at construction.** Dynamically-assembled chains
   * that change Secret/PII validator presence after the StreamValidator
   * is built must pass `minBufferBeforeRelease` explicitly rather than
   * relying on this hint.
   */
  chainHasSecretOrPii?: boolean;
  /**
   * Story 1.1b — sentence-boundary heuristic for the release gate.
   * @default true
   */
  detectSentenceBoundary?: boolean;
  /**
   * Story 1.1b — minimum buffer length before a sentence terminator
   * counts as a release point. Filters out abbreviation false-positives.
   * @default 32
   */
  minSentenceLength?: number;
}

/**
 * Stream validator state for tracking accumulated content.
 */
export interface StreamValidatorState {
  /** Accumulated text content */
  accumulated: string;
  /** Chunk count since last validation */
  chunkCount: number;
  /** Whether stream has been blocked */
  blocked: boolean;
  /** Current byte size of accumulated content */
  byteSize: number;
}

/**
 * Creates a new stream validator state.
 *
 * @returns Initial validator state
 *
 * @example
 * ```ts
 * const state = createStreamValidatorState();
 * // Use in streaming loop
 * ```
 */
export function createStreamValidatorState(): StreamValidatorState {
  return {
    accumulated: '',
    chunkCount: 0,
    blocked: false,
    byteSize: 0
  };
}

/**
 * Validates buffer size before accumulating a new chunk.
 * Throws StreamValidationError if the buffer would exceed the maximum size.
 *
 * This check MUST happen BEFORE adding the chunk to the accumulator.
 *
 * @param state - Current validator state
 * @param chunk - New chunk to be added
 * @param options - Validation options
 * @throws {StreamValidationError} If buffer size would be exceeded
 *
 * @example
 * ```ts
 * // BEFORE accumulating the chunk
 * validateBufferBeforeAccumulation(state, chunk, { maxBufferSize: 1024 * 1024 });
 * state.accumulated += chunk;
 * ```
 */
export function validateBufferBeforeAccumulation(
  state: StreamValidatorState,
  chunk: string,
  options: StreamValidationOptions = {}
): void {
  const maxBufferSize = options.maxBufferSize ?? DEFAULT_MAX_BUFFER_SIZE;

  // Calculate byte size of new chunk
  const chunkByteSize = getByteSize(chunk);

  // Check if adding this chunk would exceed the limit
  if (state.byteSize + chunkByteSize > maxBufferSize) {
    const reason = 'Buffer overflow prevented';
    const message = `Stream buffer exceeded maximum size of ${maxBufferSize} bytes`;

    options.logger?.warn('[Stream Validator] Buffer overflow prevented', {
      currentSize: state.byteSize,
      chunkSize: chunkByteSize,
      maxSize: maxBufferSize
    });

    options.onBlocked?.(state.accumulated, reason);

    throw new StreamValidationError(message, reason, true);
  }
}

/**
 * Updates validator state with a new chunk.
 * Call this AFTER validateBufferBeforeAccumulation.
 *
 * @param state - Current validator state
 * @param chunk - New chunk to add
 * @returns Updated chunk count
 *
 * @example
 * ```ts
 * validateBufferBeforeAccumulation(state, chunk);
 * const count = updateStreamValidatorState(state, chunk);
 * if (count % validationInterval === 0) {
 *   // Run validation
 * }
 * ```
 */
export function updateStreamValidatorState(state: StreamValidatorState, chunk: string): number {
  state.accumulated += chunk;
  state.byteSize += getByteSize(chunk);
  return ++state.chunkCount;
}

/**
 * Checks if validation should run based on chunk count.
 *
 * @param state - Current validator state
 * @param interval - Validation interval
 * @returns True if validation should run
 *
 * @example
 * ```ts
 * if (shouldValidateStream(state, 10)) {
 *   const result = await engine.validate(state.accumulated);
 *   if (!result.allowed) {
 *     // Handle blocked content
 *   }
 * }
 * ```
 */
export function shouldValidateStream(
  state: StreamValidatorState,
  interval: number = DEFAULT_VALIDATION_INTERVAL
): boolean {
  // Guard against `interval = 0` (would make `x % 0` produce NaN) AND
  // `Infinity` (would make `x % Infinity === x`, so the modulo never hits 0
  // and validation silently never runs).
  const safeInterval = Number.isFinite(interval) && interval >= 1 ? Math.floor(interval) : DEFAULT_VALIDATION_INTERVAL;
  return !state.blocked && state.chunkCount > 0 && state.chunkCount % safeInterval === 0;
}

/**
 * Returns true if the stream has accumulated content since the last scheduled
 * validation interval but has not yet been validated.
 *
 * Connectors MUST call this after the stream ends and run a final validation pass
 * if it returns true — otherwise the tail of the stream (chunks since the last
 * interval boundary) may bypass detection.
 *
 * @example
 * ```ts
 * for await (const chunk of stream) {
 *   processStreamChunk(state, chunk);
 *   if (shouldValidateStream(state, 10)) {
 *     const r = await engine.validate(state.accumulated);
 *     if (!r.allowed) { markStreamBlocked(state, r.reason); break; }
 *   }
 * }
 * if (hasUnvalidatedTail(state, 10)) {
 *   const r = await engine.validate(state.accumulated);
 *   if (!r.allowed) markStreamBlocked(state, r.reason);
 * }
 * ```
 */
export function hasUnvalidatedTail(
  state: StreamValidatorState,
  interval: number = DEFAULT_VALIDATION_INTERVAL
): boolean {
  // Same Infinity/0 guard as shouldValidateStream.
  const safeInterval = Number.isFinite(interval) && interval >= 1 ? Math.floor(interval) : DEFAULT_VALIDATION_INTERVAL;
  return !state.blocked && state.chunkCount > 0 && state.chunkCount % safeInterval !== 0;
}

/**
 * Marks the stream as blocked.
 * Use this when validation fails.
 *
 * @param state - Current validator state
 * @param reason - Reason for blocking
 *
 * @example
 * ```ts
 * if (!validationResult.allowed) {
 *   markStreamBlocked(state, validationResult.reason);
 *   throw new Error('Content blocked');
 * }
 * ```
 */
export function markStreamBlocked(state: StreamValidatorState, _reason: string): void {
  // Reason is accepted for API consistency and potential future logging
  state.blocked = true;
  state.accumulated = '';
  state.byteSize = 0;
  state.chunkCount = 0;
}

/**
 * Resets validator state for a new stream.
 *
 * @param state - Current validator state
 *
 * @example
 * ```ts
 * resetStreamValidatorState(state);
 * ```
 */
export function resetStreamValidatorState(state: StreamValidatorState): void {
  state.accumulated = '';
  state.blocked = false;
  state.byteSize = 0;
  state.chunkCount = 0;
}

/**
 * Gets the byte size of a string.
 * Handles UTF-16 encoding properly.
 *
 * @param str - String to measure
 * @returns Byte size
 *
 * @internal
 */
function getByteSize(str: string): number {
  // JavaScript uses UTF-16, so each character is 2 bytes
  // For accurate byte size in UTF-8, we need to count properly
  let size = str.length;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code > 0x7f && code <= 0x7ff) {
      size++;
    } else if (code > 0x7ff && code <= 0xffff) {
      size += 2;
    } else if (code >= 0x10000) {
      // Surrogate pair handling
      size += 3;
      i++; // Skip the next character (low surrogate)
    }
  }
  return size;
}

/**
 * Validates and processes a stream chunk with all safety checks.
 * This is a convenience function that combines all stream validation steps.
 *
 * @param state - Current validator state
 * @param chunk - New chunk to process
 * @param options - Validation options
 * @returns The accumulated content so far
 * @throws {StreamValidationError} If buffer size exceeded
 *
 * @example
 * ```ts
 * for await (const chunk of stream) {
 *   const accumulated = processStreamChunk(state, chunk, { maxBufferSize: 1024 * 1024 });
 *   if (shouldValidateStream(state, 10)) {
 *     // Run validation
 *   }
 * }
 * ```
 */
export function processStreamChunk(
  state: StreamValidatorState,
  chunk: string,
  options: StreamValidationOptions = {}
): string {
  validateBufferBeforeAccumulation(state, chunk, options);
  updateStreamValidatorState(state, chunk);
  return state.accumulated;
}

// ─────────────────────────────────────────────────────────────────────────────
// Lifecycle class — preferred high-level API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minimal engine contract for stream validation. Compatible with
 * `GuardrailEngine.validate()` and any function that returns a result with an
 * `allowed` boolean and an optional `reason`.
 */
export interface StreamValidatorEngine {
  validate(content: string): Promise<{ allowed: boolean; reason?: string }> | { allowed: boolean; reason?: string };
}

export interface StreamValidatorResult {
  allowed: boolean;
  reason?: string;
  accumulated: string;
}

/**
 * Story 1.1b — return shape for `processForClient` / `finalizeForClient`.
 * `released` is the substring the caller should forward to the client
 * (empty string when the gate is still holding content). `allowed`/
 * `reason` mirror the validator decision; on block the buffered content
 * is dropped and `released` is empty.
 */
export interface StreamValidatorReleaseResult {
  released: string;
  allowed: boolean;
  reason?: string;
}

/**
 * Enforced-lifecycle stream validator.
 *
 * **NOT concurrent-safe.** All methods mutate internal state; callers
 * must serialise per-instance (one in-flight `process` / `processForClient`
 * call at a time). Standard LLM-stream consumers process chunks
 * sequentially via `for await (...)`, which is the supported pattern.
 *
 * **NOT mix-safe.** The legacy `process()` / `finalize()` lifecycle and
 * the Story 1.1b `processForClient()` / `finalizeForClient()` lifecycle
 * are mutually exclusive on a given instance. Calling both throws.
 *
 * Wraps the functional `processStreamChunk` / `shouldValidateStream` /
 * `hasUnvalidatedTail` primitives in a class that makes the "validate the
 * tail after the stream ends" contract impossible to skip.
 *
 * Supports `Symbol.asyncDispose` (TC39 explicit-resource-management) so
 * `await using validator = StreamValidator.create(engine)` finalises on scope
 * exit even if an exception propagates.
 *
 * @example
 * ```ts
 * await using validator = StreamValidator.create(engine, { validationInterval: 10 });
 * for await (const chunk of llmStream) {
 *   const r = await validator.process(chunk);
 *   if (r && !r.allowed) {
 *     throw new Error(`Stream blocked: ${r.reason}`);
 *   }
 * }
 * // Symbol.asyncDispose runs validator.finalize() here automatically.
 * ```
 *
 * @example Manual lifecycle (no `await using`):
 * ```ts
 * const validator = StreamValidator.create(engine);
 * try {
 *   for await (const chunk of stream) {
 *     const r = await validator.process(chunk);
 *     if (r && !r.allowed) throw new Error(r.reason);
 *   }
 *   const tail = await validator.finalize();
 *   if (tail && !tail.allowed) throw new Error(tail.reason);
 * } finally {
 *   // finalize() is idempotent; safe to call from a finally if you skipped above.
 * }
 * ```
 */
/**
 * Internal lifecycle mode. Set on the first call to `process()` or
 * `processForClient()`. The two APIs MUST NOT be mixed on the same
 * instance — the gate buffer and the accumulator drift otherwise (one
 * gets fed only by `processForClient`, the other by both). Mixing
 * throws at the second-mode call site.
 */
type StreamValidatorMode = 'legacy' | 'gated';

export class StreamValidator {
  private readonly state: StreamValidatorState;
  private readonly engine: StreamValidatorEngine;
  private readonly options: StreamValidationOptions;
  private readonly interval: number;
  private readonly releaseGate: BufferedReleaseGate;
  private readonly minBufferBeforeRelease: number;
  private mode: StreamValidatorMode | null = null;
  private finalised = false;
  private finalisedForClient = false;

  private constructor(engine: StreamValidatorEngine, options: StreamValidationOptions) {
    // Symbol.asyncDispose is only present on Node >= 20.4.0. On earlier
    // 20.x releases the `await using` lifecycle silently no-ops, so we
    // fail loudly at construction time rather than ship a broken contract.
    if (typeof Symbol.asyncDispose !== 'symbol') {
      throw new Error(
        'StreamValidator requires Node >= 20.4 (Symbol.asyncDispose). ' +
          'Upgrade Node or use the lower-level processStreamChunk / hasUnvalidatedTail helpers.'
      );
    }
    this.engine = engine;
    this.options = options;
    this.interval =
      Number.isFinite(options.validationInterval) && (options.validationInterval ?? 0) >= 1
        ? Math.floor(options.validationInterval as number)
        : DEFAULT_VALIDATION_INTERVAL;
    this.state = createStreamValidatorState();

    // Story 1.1b (R2-D1) — release-gate default policy:
    //   1. Explicit `minBufferBeforeRelease` wins.
    //   2. `chainHasSecretOrPii: true` flips default to Infinity
    //      (full-response mode — the only 100% leak-prevention).
    //   3. Otherwise 256 chars or first sentence boundary.
    this.minBufferBeforeRelease =
      options.minBufferBeforeRelease ?? (options.chainHasSecretOrPii ? Infinity : DEFAULT_MIN_BUFFER_BEFORE_RELEASE);
    this.releaseGate = new BufferedReleaseGate({
      minCharsBeforeRelease: this.minBufferBeforeRelease,
      detectSentenceBoundary: options.detectSentenceBoundary,
      minSentenceLength: options.minSentenceLength
    });
  }

  static create(engine: StreamValidatorEngine, options: StreamValidationOptions = {}): StreamValidator {
    return new StreamValidator(engine, options);
  }

  /** Accumulated decoded content so far (empty after a block). */
  get accumulated(): string {
    return this.state.accumulated;
  }

  /** True after the stream has been marked blocked. Further calls are no-ops. */
  get blocked(): boolean {
    return this.state.blocked;
  }

  /**
   * Append a chunk and run a scheduled validation if the interval boundary is
   * reached. Returns the validation result on intervals, otherwise null.
   *
   * Throws `StreamValidationError` if the chunk would overflow the buffer.
   *
   * **NOT concurrent-safe**: callers must serialise calls per instance.
   * **NOT mix-safe** with {@link processForClient}: call only one of
   * `process` / `processForClient` on a given instance.
   */
  async process(chunk: string): Promise<StreamValidatorResult | null> {
    this.assertMode('legacy');
    if (this.state.blocked) return null;

    processStreamChunk(this.state, chunk, this.options);

    if (!shouldValidateStream(this.state, this.interval)) {
      return null;
    }
    return this.runValidation();
  }

  /**
   * Run a final validation on any chunks accumulated since the last interval
   * boundary. Idempotent: safe to call multiple times; subsequent calls return
   * null. Called automatically by `Symbol.asyncDispose` when used with
   * `await using`.
   *
   * No-op when the validator is in `'gated'` mode — the release-gate
   * lifecycle uses {@link finalizeForClient} instead, and double-firing
   * `runValidation` from both lifecycle paths would re-invoke the engine
   * and any `onBlocked` callback twice on the same content.
   */
  async finalize(): Promise<StreamValidatorResult | null> {
    if (this.mode === 'gated') {
      this.finalised = true;
      return null;
    }
    if (this.finalised || this.state.blocked) {
      this.finalised = true;
      return null;
    }
    this.finalised = true;
    if (!hasUnvalidatedTail(this.state, this.interval)) {
      return null;
    }
    return this.runValidation();
  }

  /**
   * Lifecycle-mode guard. Records the first-call mode and throws on a
   * subsequent attempt to use the OTHER API on the same instance.
   * Audit-loop architect #1 + BLOCK #5 (asyncDispose double-validation):
   * a sentinel here makes both `finalize` no-op in `gated` mode AND
   * surfaces accidental mixing instead of letting the gate / accumulator
   * drift silently.
   */
  private assertMode(target: StreamValidatorMode): void {
    if (this.mode === null) {
      this.mode = target;
      return;
    }
    if (this.mode !== target) {
      throw new Error(
        `StreamValidator: cannot call ${target === 'legacy' ? 'process()' : 'processForClient()'} after ${this.mode === 'legacy' ? 'process()' : 'processForClient()'} on the same instance. Pick one lifecycle per stream.`
      );
    }
  }

  private async runValidation(): Promise<StreamValidatorResult> {
    const accumulated = this.state.accumulated;
    try {
      const engineResult = await this.engine.validate(accumulated);
      if (!engineResult.allowed) {
        const reason = engineResult.reason ?? 'stream_blocked';
        this.options.onBlocked?.(accumulated, reason);
        markStreamBlocked(this.state, reason);
        return { allowed: false, reason, accumulated };
      }
      return { allowed: true, accumulated };
    } catch (err) {
      // Fail closed: if the engine throws (network error, timeout, etc.) we
      // MUST NOT leave unvalidated content in the buffer that a subsequent
      // call could mistake for validated. Mark the stream blocked and
      // re-throw so the connector surfaces the failure to the caller.
      const reason = err instanceof Error ? `engine_error: ${err.message}` : 'engine_error';
      this.options.onBlocked?.(accumulated, reason);
      markStreamBlocked(this.state, reason);
      throw err;
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // Story 1.1b — validate-before-release client gate
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Story 1.1b release-gate API. Append `chunk` to the accumulator and
   * the release-gate buffer; when the gate signals ready-to-release,
   * run validation against the full accumulator. On pass, drain the
   * gate and return the buffered content as `released`. On block, drop
   * the gate and return `{ released: '', allowed: false, reason }`.
   *
   * `processForClient` and the legacy `process()` SHOULD NOT be mixed
   * on the same validator instance. Pick one per stream.
   *
   * @example
   * ```ts
   * await using validator = StreamValidator.create(engine, {
   *   minBufferBeforeRelease: 256,
   *   chainHasSecretOrPii: middleware.hasSecretValidators,
   * });
   * for await (const chunk of llmStream) {
   *   const r = await validator.processForClient(chunk);
   *   if (!r.allowed) {
   *     sendErrorToClient(r.reason);
   *     break;
   *   }
   *   if (r.released) clientSocket.write(r.released);
   * }
   * const tail = await validator.finalizeForClient();
   * if (tail.allowed && tail.released) clientSocket.write(tail.released);
   * ```
   */
  async processForClient(chunk: string): Promise<StreamValidatorReleaseResult> {
    this.assertMode('gated');
    if (this.state.blocked) {
      return { released: '', allowed: false, reason: 'stream_already_blocked' };
    }

    processStreamChunk(this.state, chunk, this.options);
    this.releaseGate.push(chunk);

    if (!this.releaseGate.shouldRelease()) {
      return { released: '', allowed: true };
    }

    try {
      const validation = await this.runValidation();
      if (!validation.allowed) {
        this.releaseGate.drop();
        return { released: '', allowed: false, reason: validation.reason };
      }
      return {
        released: this.releaseGate.takePending(),
        allowed: true
      };
    } catch (err) {
      // Audit-loop reviewer HIGH-1: convert engine throws to the
      // documented release-result shape. `runValidation` already marked
      // the stream blocked + fired `onBlocked` before rethrowing.
      this.releaseGate.drop();
      const reason = err instanceof Error ? `engine_error: ${err.message}` : 'engine_error';
      return { released: '', allowed: false, reason };
    }
  }

  /**
   * Story 1.1b — final-flush release-gate API. Validate any content
   * still held in the release-gate buffer and either release or drop it.
   * Idempotent: subsequent calls return `{ released: '', allowed: true }`.
   *
   * MUST be called at end-of-stream to drain pending content under
   * `minBufferBeforeRelease: Infinity` (full-response mode); otherwise
   * the buffered response is silently dropped.
   */
  async finalizeForClient(): Promise<StreamValidatorReleaseResult> {
    if (this.finalisedForClient) {
      return {
        released: '',
        allowed: !this.state.blocked,
        reason: this.state.blocked ? 'stream_already_blocked' : undefined
      };
    }
    this.finalisedForClient = true;
    if (this.state.blocked) {
      return { released: '', allowed: false, reason: 'stream_already_blocked' };
    }
    if (this.releaseGate.pendingSize === 0) {
      return { released: '', allowed: true };
    }
    try {
      const validation = await this.runValidation();
      if (!validation.allowed) {
        this.releaseGate.drop();
        return { released: '', allowed: false, reason: validation.reason };
      }
      return { released: this.releaseGate.takePending(), allowed: true };
    } catch (err) {
      this.releaseGate.drop();
      const reason = err instanceof Error ? `engine_error: ${err.message}` : 'engine_error';
      return { released: '', allowed: false, reason };
    }
  }

  // TC39 Stage 3 explicit-resource-management hook.
  async [Symbol.asyncDispose](): Promise<void> {
    await this.finalize();
    if (!this.finalisedForClient) {
      await this.finalizeForClient();
    }
  }
}
