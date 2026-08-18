/**
 * Buffered Release Gate
 * ===========================================
 * Standalone primitive: holds appended content until a release condition
 * fires, then exposes a `takePending()` drain. The gate itself never
 * decides on validation — it is a pure buffer that callers (StreamValidator
 * and AudioStreamValidator) pair with their own
 * validate-before-release policy.
 *
 * **Text-only by design** (cumulative-audit note for Story 3.1 reuse):
 * `push(chunk: string)` accepts UTF-16 JS strings; `minCharsBeforeRelease`
 * counts CHARACTERS, not bytes; sentence-boundary detection assumes
 * ASCII terminators (`.`, `!`, `?`). The audio stream validator
 * will need EITHER a sibling `BufferedReleaseGateBinary` over raw PCM
 * frames OR a generic-typed `push<T>` overload — the current API
 * cannot ingest binary audio frames without first stringifying them
 * (which defeats the purpose of frame-aligned buffering). Track the
 * generalization as a pre-blocker.
 *
 * Release conditions, in priority order:
 *   1. `minCharsBeforeRelease === 0` — releases on every push.
 *   2. `pendingSize >= minCharsBeforeRelease` (when finite) — buffer cap hit.
 *   3. Sentence terminator at the end of the buffer with at least
 *      `minSentenceLength` chars accumulated (when `detectSentenceBoundary`
 *      is on).
 *
 * `minCharsBeforeRelease: Infinity` is the documented full-response mode:
 * `shouldRelease()` never returns true; the caller must explicitly call
 * `takePending()` (typically at stream finalize) to drain.
 *
 * The gate is cycle-reusable: `takePending()` clears the internal buffer,
 * so each subsequent batch is held under the same rules.
 */

const DEFAULT_MIN_SENTENCE_LENGTH = 32;

/**
 * Configuration for {@link BufferedReleaseGate}.
 */
export interface BufferedReleaseGateConfig {
  /**
   * Minimum buffered characters before the gate signals ready-to-release.
   * `0` releases immediately; `Infinity` holds everything until the caller
   * drains via {@link BufferedReleaseGate.takePending}.
   */
  minCharsBeforeRelease: number;
  /**
   * When `true` (default), the gate also signals ready-to-release if the
   * buffer ends with a sentence terminator (`.`, `!`, `?`) — provided the
   * buffer has reached at least `minSentenceLength` characters. Disable
   * for languages or content where terminator-based heuristics are unsafe.
   *
   * **Locale coverage**: the regex matches ASCII terminators only.
   * CJK punctuation (`。！？`), Arabic `؟`, and ellipsis `…` are NOT
   * detected. For non-Latin streams pass `detectSentenceBoundary: false`
   * and rely on the char-count cap.
   * @default true
   */
  detectSentenceBoundary?: boolean;
  /**
   * Minimum buffer length before a sentence terminator is allowed to
   * trigger a release. Filters out abbreviations like `Mr.` and `e.g.`.
   * Ignored when `detectSentenceBoundary` is `false`.
   * @default 32
   */
  minSentenceLength?: number;
}

/**
 * Append-only release gate. See module docstring for semantics.
 */
export class BufferedReleaseGate {
  private buffer = '';
  private readonly minChars: number;
  private readonly detectSentence: boolean;
  private readonly minSentenceLength: number;

  constructor(config: BufferedReleaseGateConfig) {
    // Audit-loop reviewer MEDIUM: reject NaN / negative thresholds at
    // construction. Silent misbehaviour in a security primitive (e.g.
    // `NaN` → never release, `−1` → release on every push) would
    // produce hard-to-diagnose leaks in connectors that mis-configure.
    const m = config.minCharsBeforeRelease;
    if (Number.isNaN(m) || (Number.isFinite(m) && m < 0)) {
      throw new RangeError(
        `BufferedReleaseGate: minCharsBeforeRelease must be a non-negative finite number or Infinity (received ${String(m)}).`
      );
    }
    this.minChars = m;
    this.detectSentence = config.detectSentenceBoundary ?? true;
    this.minSentenceLength = config.minSentenceLength ?? DEFAULT_MIN_SENTENCE_LENGTH;
  }

  /** Append a chunk to the pending buffer. */
  push(chunk: string): void {
    this.buffer += chunk;
  }

  /** True when the buffer satisfies any release condition. */
  shouldRelease(): boolean {
    if (this.minChars === 0) return true;
    if (!Number.isFinite(this.minChars)) return false;
    if (this.buffer.length >= this.minChars) return true;
    if (!this.detectSentence) return false;
    if (this.buffer.length < this.minSentenceLength) return false;
    return /[.!?]["')\]]*\s*$/.test(this.buffer);
  }

  /** Drain the pending buffer and return its contents. */
  takePending(): string {
    const out = this.buffer;
    this.buffer = '';
    return out;
  }

  /** Discard the pending buffer without returning it (used on block). */
  drop(): void {
    this.buffer = '';
  }

  /** Peek at the pending buffer without draining. */
  get pending(): string {
    return this.buffer;
  }

  /** Number of characters currently held back from release. */
  get pendingSize(): number {
    return this.buffer.length;
  }
}
