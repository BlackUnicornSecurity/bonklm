/**
 * Story 3.1 — AudioStreamValidator (CORE)
 * ========================================
 * Voice / realtime transcript validator. Wires `BufferedReleaseGate`
 * (Story 1.1b primitive) as the partial-buffer; runs a curated
 * Aho-Corasick automaton over the released text span for early-block
 * detection on partial transcripts; defers the heavy validator stack to
 * `validateFinal` on stream close.
 *
 * **Hot-path contract** (AC-c): `validatePartial` MUST NOT call
 * `String.prototype.split`, `match`, `normalize`, or `toLowerCase` on
 * the released span. We feed character codes directly to the AC
 * automaton; ASCII A-Z is folded via `code | 0x20` at step time. This
 * is the price of zero-allocation per call — non-ASCII confusables on
 * the partial path are intentionally deferred to `validateFinal`,
 * which runs the full pattern engine (NFKD normalisation included).
 * The returned `AudioStreamPartialResult.partialCoverageOnly` flag is
 * always `true`, signalling to connector authors that a clean partial
 * is NOT a clean stream until `validateFinal` runs.
 *
 * **Automaton persistence** (AC-b): AC `currentState` is a class field
 * that survives across `validatePartial` calls within the same session.
 * A needle split mid-chunk (`"ignore previ" + "ous instructions"`)
 * still matches because the automaton's state at the chunk boundary
 * encodes the partial prefix. `getSignalEarlyBlock()`,
 * `consumeEarlyBlock()`, and `resetSession()` reset the state for the
 * next session; `peekEarlyBlock()` reads without resetting.
 *
 * **Lifecycle** (security B-2): **ONE INSTANCE PER VOICE SESSION**.
 * The validator carries mutable session state (`earlyBlock`, AC
 * automaton position, gate buffer). Sharing one instance across
 * concurrent voice sessions WILL produce cross-session state leakage.
 * Use `fork()` to clone a pre-configured factory into a fresh stateful
 * instance for each session, OR construct a new instance per session
 * from the same config. `[Symbol.asyncDispose]` clears state on
 * `await using` scope exit.
 *
 * **Does NOT validate raw audio**: `validatePartial` and `validateFinal`
 * only accept `string`. Buffer / Uint8Array input throws TypeError at
 * runtime. Upstream realtime SDKs are responsible for the audio→text
 * path.
 *
 * **Validator conformance** (architect B1): implements the
 * `Validator` interface via `validate(input)` accepting
 * `{ kind: 'audio_partial', content, isFinal? }`. Connectors that
 * want to compose this into a `GuardrailEngine` validator chain can
 * dispatch via the standard `ValidatorInput` union; the engine routes
 * partials and finals through the same instance lifecycle.
 *
 * **Surface vocab** (architect B2): exports `AUDIO_STREAM_SURFACE =
 * 'audio_partial'` (R2-10 locked vocabulary). Partial-result
 * `metadata.surface` and final-result `metadata.surface` are stamped
 * with this constant so Story 3.11's OTel adapter can emit
 * `bonklm.surface = 'audio_partial'`.
 *
 * **Known limitations** (documented in `docs/user/known-limitations.md` §22):
 *  - Hot path is ASCII case-fold only. Cyrillic-confusable attacks
 *    against the curated needle set bypass `validatePartial` but are
 *    caught by `validateFinal`.
 *  - The curated needle set is intentionally small (~25 patterns).
 *    Broader prompt-injection / jailbreak detection runs on the final
 *    path via `PromptInjectionValidator`.
 *  - The validator does NOT compose into `createComposedContextValidator`
 *    because its `validate(input)` only accepts `kind: 'audio_partial'`.
 *    For audio-into-memory-recall scenarios, wire the final-validator
 *    stack to include both `AudioStreamValidator`'s final path AND
 *    `ComposedContextValidator` at the composition layer.
 */
import type {
  HookSurface,
  Validator,
  ValidatorInput,
} from '../engine/GuardrailEngine.types.js';
import {
  createResult,
  type Finding,
  type GuardrailResult,
  Severity,
} from '../base/GuardrailResult.js';
import {
  BufferedReleaseGate,
  type BufferedReleaseGateConfig,
} from '../connector-utils/buffered-release-gate.js';
import { PromptInjectionValidator } from './prompt-injection.js';
import { CodeInjectionValidator } from './code-injection.js';
import { scoreToRiskLevel } from './internal/unwrap-input.js';

// =============================================================================
// PUBLIC CONSTANTS
// =============================================================================

/**
 * R2-10 locked surface vocab. Emitted by Story 3.11 OTel as
 * `bonklm.surface`. Stamped on `AudioStreamPartialResult.metadata.surface`
 * and `validateFinal` result `metadata.surface`.
 */
export const AUDIO_STREAM_SURFACE: HookSurface = 'audio_partial';

/**
 * DoS bounds (security C-2). The curated default set has ~25 patterns;
 * a generous 500-pattern cap defeats unbounded supplier-side trie
 * builds without constraining realistic configurations.
 */
export const MAX_AUDIO_STREAM_PATTERNS = 500;
/** Per-needle byte cap. 512 covers every realistic voice-attack phrase. */
export const MAX_AUDIO_STREAM_NEEDLE_LENGTH = 512;

// =============================================================================
// PUBLIC TYPES
// =============================================================================

export type AudioStreamSeverity = 'critical' | 'warning';

export type AudioStreamCategory =
  | 'injection'
  | 'jailbreak'
  | 'high_risk_action'
  | 'data_exfil';

export interface AudioStreamPattern {
  /**
   * Match needle. Lowercased ASCII at construction; the hot path folds
   * uppercase ASCII at step time via bit-twiddle.
   */
  needle: string;
  category: AudioStreamCategory;
  severity: AudioStreamSeverity;
  description: string;
}

export interface AudioStreamMatch {
  pattern: AudioStreamPattern;
  /**
   * Inclusive start index of the matched needle within the released
   * span. `endIndex - pattern.needle.length + 1`.
   */
  startIndex: number;
  /** Inclusive end index (position of the needle's last character). */
  endIndex: number;
  /**
   * @deprecated Use `endIndex`. Retained for backward compatibility;
   * will be removed in v0.7. Value is identical to `endIndex`.
   */
  index: number;
}

export interface AudioStreamPartialResult {
  /** True when the BufferedReleaseGate released a span on this push. */
  released: boolean;
  /** Released span (drained from the gate) — empty when `released=false`. */
  releasedText: string;
  /** Matches emitted by the AC automaton over the released span (deduped). */
  matches: AudioStreamMatch[];
  /** True when any CRITICAL match has fired across the current session. */
  earlyBlock: boolean;
  /**
   * **ALWAYS true** on partial results. Signals to connectors that
   * `earlyBlock: false` is "ASCII-needle clean only" — homoglyph /
   * mixed-script / encoded payloads bypass the partial path and may
   * still fail `validateFinal`. Connectors that gate the LLM call on
   * `earlyBlock` alone produce false negatives for those classes.
   */
  partialCoverageOnly: true;
  /** R2-10 surface vocab — always 'audio_partial'. */
  surface: HookSurface;
}

export interface AudioStreamResetReport {
  /**
   * Bytes silently dropped from the gate's pending buffer. When this
   * exceeds 0 and the caller did NOT first call `validateFinal('')`,
   * unvalidated transcript content was discarded. Surfaces a
   * potential security gap: dropped content may have contained
   * injection / high-risk needles that the gate had not yet released.
   */
  droppedBytes: number;
}

export interface AudioStreamValidatorConfig {
  /**
   * BufferedReleaseGate threshold. Story brief calls this
   * `minBufferBeforeRelease`; the underlying primitive's field is
   * `minCharsBeforeRelease`. Both are accepted. When both are
   * supplied, `minCharsBeforeRelease` wins (matches the primitive
   * directly). Prefer `minCharsBeforeRelease` in new code.
   * @default 0
   */
  minBufferBeforeRelease?: number;
  /** See {@link minBufferBeforeRelease}. */
  minCharsBeforeRelease?: number;
  /** Forwarded to {@link BufferedReleaseGateConfig.detectSentenceBoundary}. */
  detectSentenceBoundary?: boolean;
  /** Forwarded to {@link BufferedReleaseGateConfig.minSentenceLength}. */
  minSentenceLength?: number;
  /**
   * Override the curated default partial-pattern set. Empty patterns or
   * non-string needles throw at construction. Pass an empty array to
   * disable AC matching entirely. Capped at
   * {@link MAX_AUDIO_STREAM_PATTERNS}; each needle capped at
   * {@link MAX_AUDIO_STREAM_NEEDLE_LENGTH} chars.
   */
  patterns?: AudioStreamPattern[];
  /**
   * Validator stack to run on `validateFinal`. Defaults to a fresh
   * {@link PromptInjectionValidator}. Replace to compose richer
   * downstream chains (jailbreak, reformulation, etc.). On edge
   * runtimes, pass an explicit empty array `[]` plus your own
   * lightweight validators to avoid the PromptInjection pattern-engine
   * import cost.
   */
  finalValidators?: Validator[];
}

// =============================================================================
// CURATED DEFAULT PATTERN SET
// =============================================================================

const DEFAULT_AUDIO_STREAM_PATTERNS: AudioStreamPattern[] = [
  // injection
  { needle: 'ignore previous instructions', category: 'injection', severity: 'critical', description: 'classic system-prompt override' },
  { needle: 'ignore all previous', category: 'injection', severity: 'critical', description: 'system-prompt override variant' },
  { needle: 'disregard previous', category: 'injection', severity: 'critical', description: 'system-prompt override variant' },
  { needle: 'disregard all previous', category: 'injection', severity: 'critical', description: 'system-prompt override variant' },
  { needle: 'forget your instructions', category: 'injection', severity: 'critical', description: 'system-prompt override variant' },
  { needle: 'forget the previous', category: 'injection', severity: 'critical', description: 'system-prompt override variant' },
  { needle: 'reveal the system prompt', category: 'injection', severity: 'critical', description: 'system-prompt disclosure' },
  { needle: 'repeat the system prompt', category: 'injection', severity: 'critical', description: 'system-prompt disclosure' },
  { needle: 'show me the system prompt', category: 'injection', severity: 'critical', description: 'system-prompt disclosure' },
  { needle: 'read me the system', category: 'injection', severity: 'critical', description: 'system-prompt disclosure (voice phrasing)' },
  { needle: 'from now on you', category: 'injection', severity: 'critical', description: 'role-rewrite preamble' },
  { needle: 'override your', category: 'injection', severity: 'critical', description: 'directive override' },

  // jailbreak
  { needle: 'dan mode', category: 'jailbreak', severity: 'critical', description: 'DAN persona invocation' },
  { needle: 'do anything now', category: 'jailbreak', severity: 'critical', description: 'DAN persona expansion' },
  { needle: 'developer mode', category: 'jailbreak', severity: 'critical', description: 'developer-mode persona invocation' },
  { needle: 'jailbreak', category: 'jailbreak', severity: 'critical', description: 'explicit jailbreak request' },
  { needle: 'pretend you are', category: 'jailbreak', severity: 'warning', description: 'persona-swap preamble' },
  { needle: 'act as if you have no', category: 'jailbreak', severity: 'warning', description: 'rule-removal preamble' },

  // high_risk_action (voice-specific)
  { needle: 'wire transfer', category: 'high_risk_action', severity: 'critical', description: 'unauthorised funds movement' },
  { needle: 'send money to', category: 'high_risk_action', severity: 'critical', description: 'unauthorised funds movement' },
  { needle: 'transfer funds', category: 'high_risk_action', severity: 'critical', description: 'unauthorised funds movement' },
  { needle: 'approve this transaction', category: 'high_risk_action', severity: 'critical', description: 'unauthorised approval' },
  { needle: 'execute this trade', category: 'high_risk_action', severity: 'critical', description: 'unauthorised trade' },
  { needle: 'place the order', category: 'high_risk_action', severity: 'warning', description: 'order-placement (context-dependent)' },

  // data_exfil
  { needle: 'list all users', category: 'data_exfil', severity: 'warning', description: 'bulk PII read' },
  { needle: 'dump the database', category: 'data_exfil', severity: 'critical', description: 'bulk data dump' },
];

// =============================================================================
// AHO-CORASICK AUTOMATON
// =============================================================================

interface AcNode {
  children: Map<number, AcNode>;
  /** BFS-computed failure link (suffix automaton). */
  fail: AcNode | null;
  /** Indices into the patterns array whose needles terminate at this node. */
  outputs: number[];
  /** Needle byte-lengths for the outputs above — paired by index. */
  outputLengths: number[];
}

function createAcNode(): AcNode {
  return { children: new Map(), fail: null, outputs: [], outputLengths: [] };
}

/**
 * Stream-friendly Aho-Corasick. Built once at construction over a
 * fixed needle set; `step(code, outBuffer, outLengths)` advances the
 * automaton one char and appends matched pattern indices + needle
 * lengths into the supplied buffers (caller-owned, zero per-call
 * allocation).
 *
 * **Output-merge correctness proof** (code-reviewer BLOCK-1):
 * `computeFailureLinks` walks in BFS-by-depth order. For any node X,
 * `X.fail` always points to a node at strictly shallower depth than X
 * (failure links never point sideways or down). Therefore by BFS
 * invariant, X.fail is processed before X. When the merge runs:
 *
 *     for (const out of X.fail.outputs) X.outputs.push(out)
 *
 * X.fail.outputs has ALREADY been transitively merged with
 * X.fail.fail.outputs (and so on recursively), because BFS visited
 * X.fail's depth tier before X's. Therefore a single-step merge IS
 * the full chain merge. No explicit walk is needed. See
 * `audio-stream.test.ts` "AC nested-suffix correctness" for the
 * adversarial test that proves this.
 */
class AhoCorasick {
  readonly root: AcNode = createAcNode();
  /** Maximum needle length — for diagnostics + cycle-stop safety. */
  readonly maxNeedleLength: number;
  private state: AcNode = this.root;

  constructor(needlesLowercased: string[]) {
    let max = 0;
    for (let p = 0; p < needlesLowercased.length; p++) {
      const needle = needlesLowercased[p];
      if (needle.length > max) max = needle.length;
      let node = this.root;
      for (let i = 0; i < needle.length; i++) {
        const code = needle.charCodeAt(i);
        let next = node.children.get(code);
        if (!next) {
          next = createAcNode();
          node.children.set(code, next);
        }
        node = next;
      }
      node.outputs.push(p);
      node.outputLengths.push(needle.length);
    }
    this.maxNeedleLength = max;
    this.computeFailureLinks();
  }

  /** BFS failure-link computation — see class-level proof comment. */
  private computeFailureLinks(): void {
    const queue: AcNode[] = [];
    for (const child of this.root.children.values()) {
      child.fail = this.root;
      queue.push(child);
    }
    while (queue.length > 0) {
      const node = queue.shift()!;
      for (const [code, child] of node.children) {
        let fail: AcNode | null = node.fail;
        while (fail !== null && !fail.children.has(code)) {
          fail = fail.fail;
        }
        child.fail = fail ? fail.children.get(code)! : this.root;
        // BFS-order transitive merge — see class-level proof.
        if (child.fail.outputs.length > 0) {
          for (let i = 0; i < child.fail.outputs.length; i++) {
            child.outputs.push(child.fail.outputs[i]);
            child.outputLengths.push(child.fail.outputLengths[i]);
          }
        }
        queue.push(child);
      }
    }
  }

  reset(): void {
    this.state = this.root;
  }

  /**
   * Advance the automaton one char. Appends pattern indices into
   * `outBuffer` and parallel needle lengths into `outLengths`.
   */
  step(code: number, outBuffer: number[], outLengths: number[]): void {
    let state = this.state;
    while (state !== this.root && !state.children.has(code)) {
      state = state.fail!;
    }
    const next = state.children.get(code);
    state = next ?? this.root;
    this.state = state;
    if (state.outputs.length > 0) {
      for (let i = 0; i < state.outputs.length; i++) {
        outBuffer.push(state.outputs[i]);
        outLengths.push(state.outputLengths[i]);
      }
    }
  }
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Lowercase ASCII A-Z. Construction-time only (small fixed cost per
 * needle); the hot path uses bit-twiddle `code | 0x20` on each char
 * instead of allocating a lowercased string.
 */
function lowercaseAscii(s: string): string {
  const codes: number[] = new Array(s.length);
  for (let i = 0; i < s.length; i++) {
    let code = s.charCodeAt(i);
    if (code >= 0x41 && code <= 0x5a) code |= 0x20;
    codes[i] = code;
  }
  return String.fromCharCode(...codes);
}

function validatePatternSet(patterns: AudioStreamPattern[]): void {
  // Security C-2: bound the trie-build surface.
  if (patterns.length > MAX_AUDIO_STREAM_PATTERNS) {
    throw new RangeError(
      `AudioStreamValidator: pattern array length (${patterns.length}) exceeds ` +
        `MAX_AUDIO_STREAM_PATTERNS (${MAX_AUDIO_STREAM_PATTERNS}). Pruning ` +
        `the curated set defeats trie-build DoS surface in serverless / edge environments.`
    );
  }
  for (const p of patterns) {
    if (typeof p !== 'object' || p === null) {
      throw new TypeError('AudioStreamValidator: pattern entry must be an object');
    }
    if (typeof p.needle !== 'string' || p.needle.length === 0) {
      throw new TypeError(
        `AudioStreamValidator: pattern needle must be a non-empty string (received ${String(p.needle)})`
      );
    }
    if (p.needle.length > MAX_AUDIO_STREAM_NEEDLE_LENGTH) {
      throw new RangeError(
        `AudioStreamValidator: needle length (${p.needle.length}) exceeds ` +
          `MAX_AUDIO_STREAM_NEEDLE_LENGTH (${MAX_AUDIO_STREAM_NEEDLE_LENGTH}).`
      );
    }
  }
}

// =============================================================================
// VALIDATOR
// =============================================================================

/**
 * @public Sprint 26/28 v1.0-RC1 API freeze. `name = 'audio_stream'`
 * is frozen. Story 3.1 partial-transcript semantics + BufferedReleaseGate
 * release-only-validated contract are frozen.
 */
export class AudioStreamValidator implements Validator {
  readonly name = 'audio_stream';

  private readonly gate: BufferedReleaseGate;
  private readonly automaton: AhoCorasick;
  private readonly patterns: AudioStreamPattern[];
  private readonly finalValidators: Validator[];
  /** Cached config — used by `fork()` to clone state-free. */
  private readonly config: AudioStreamValidatorConfig;
  private earlyBlock = false;

  constructor(config: AudioStreamValidatorConfig = {}) {
    this.config = config;

    const rawPatterns = config.patterns ?? DEFAULT_AUDIO_STREAM_PATTERNS;
    validatePatternSet(rawPatterns);
    this.patterns = rawPatterns.map((p) => ({
      ...p,
      needle: lowercaseAscii(p.needle),
    }));
    this.automaton = new AhoCorasick(this.patterns.map((p) => p.needle));

    // minCharsBeforeRelease wins over minBufferBeforeRelease (story alias).
    const minChars =
      config.minCharsBeforeRelease ?? config.minBufferBeforeRelease ?? 0;
    const gateConfig: BufferedReleaseGateConfig = {
      minCharsBeforeRelease: minChars,
      detectSentenceBoundary: config.detectSentenceBoundary ?? false,
      minSentenceLength: config.minSentenceLength,
    };
    this.gate = new BufferedReleaseGate(gateConfig);

    // Sprint 16 cumulative audit security BLOCK-2 closure: default
    // finalValidators include CodeInjectionValidator. Voice payloads
    // like "pip install evil-pkg" or spoken dynamic-call sinks
    // otherwise bypass both AudioStream's small curated needle set
    // AND PromptInjection's English-only injection regex (which
    // targets prompt-override phrasings, not arbitrary code).
    // Edge-runtime callers wanting to shed the CodeInjection import
    // cost should pass `finalValidators: [new PromptInjectionValidator()]`
    // explicitly.
    this.finalValidators =
      config.finalValidators ?? [
        new PromptInjectionValidator(),
        new CodeInjectionValidator(),
      ];
  }

  // -------------------------------------------------------------------------
  // PARTIAL (HOT PATH)
  // -------------------------------------------------------------------------

  /**
   * Push a partial transcript chunk through the gate; if released,
   * stream the released span through the AC automaton.
   *
   * Hot-path contract (AC-c): MUST NOT call split / match / normalize /
   * toLowerCase on the released span. Character codes only.
   */
  validatePartial(chunk: string): AudioStreamPartialResult {
    if (typeof chunk !== 'string') {
      throw new TypeError(
        `AudioStreamValidator.validatePartial: expected string, got ${chunk === null ? 'null' : typeof chunk}. ` +
          'This validator does NOT accept raw audio bytes — transcribe via the upstream realtime SDK first.'
      );
    }

    this.gate.push(chunk);
    if (!this.gate.shouldRelease()) {
      return {
        released: false,
        releasedText: '',
        matches: [],
        earlyBlock: this.earlyBlock,
        partialCoverageOnly: true,
        surface: AUDIO_STREAM_SURFACE,
      };
    }

    const released = this.gate.takePending();
    return this.runAutomatonOver(released);
  }

  /**
   * Run the AC automaton over a span. Local match-index + length
   * buffers (code-reviewer BLOCK-2): no shared instance buffer →
   * concurrent runAutomatonOver calls on a forked instance never
   * stomp each other's state. (Forks share immutable trie nodes; the
   * `automaton.state` pointer is still session-scoped — see
   * `fork()`.)
   */
  private runAutomatonOver(span: string): AudioStreamPartialResult {
    const idxBuf: number[] = [];
    const lenBuf: number[] = [];
    const matches: AudioStreamMatch[] = [];
    /**
     * Per-character dedup set — defeats overlapping-needle duplicate
     * findings (security N-1). One match per pattern per occurrence
     * end-position.
     */
    const dedup = new Set<string>();
    for (let i = 0; i < span.length; i++) {
      let code = span.charCodeAt(i);
      if (code >= 0x41 && code <= 0x5a) code |= 0x20;
      this.automaton.step(code, idxBuf, lenBuf);
      if (idxBuf.length > 0) {
        for (let j = 0; j < idxBuf.length; j++) {
          const patternIdx = idxBuf[j];
          const needleLen = lenBuf[j];
          const dedupKey = `${patternIdx}@${i}`;
          if (dedup.has(dedupKey)) continue;
          dedup.add(dedupKey);
          const pattern = this.patterns[patternIdx];
          const startIndex = i - needleLen + 1;
          matches.push({
            pattern,
            startIndex,
            endIndex: i,
            index: i,
          });
          if (pattern.severity === 'critical') {
            this.earlyBlock = true;
          }
        }
        idxBuf.length = 0;
        lenBuf.length = 0;
      }
    }
    return {
      released: true,
      releasedText: span,
      matches,
      earlyBlock: this.earlyBlock,
      partialCoverageOnly: true,
      surface: AUDIO_STREAM_SURFACE,
    };
  }

  // -------------------------------------------------------------------------
  // FINAL (HEAVY PATH)
  // -------------------------------------------------------------------------

  /**
   * Run the full final-validator stack on the held buffer + supplied
   * chunk. Drains the gate, resets the AC automaton in `finally`
   * (security C-3), and returns a standard `GuardrailResult`.
   *
   * **Fail-secure on validator throw** (security C-3): if any entry in
   * `finalValidators` throws, the loop pushes a synthetic CRITICAL
   * finding marked `validator_threw` and forces `blocked: true`. The
   * `finally` block resets streaming state regardless.
   */
  async validateFinal(finalChunk: string): Promise<GuardrailResult> {
    if (typeof finalChunk !== 'string') {
      throw new TypeError(
        `AudioStreamValidator.validateFinal: expected string, got ${finalChunk === null ? 'null' : typeof finalChunk}. ` +
          'This validator does NOT accept raw audio bytes — transcribe via the upstream realtime SDK first.'
      );
    }
    const held = this.gate.takePending();
    const text = held + finalChunk;
    const findings: Finding[] = [];
    let worstSeverity: Severity = Severity.INFO;
    let blocked = false;
    let aggregateScore = 0;

    try {
      for (const v of this.finalValidators) {
        try {
          // Pass plain string for backward compatibility with validators
          // whose .validate signature predates the ValidatorInput union.
          const r = await v.validate(text);
          for (const f of r.findings) findings.push(f);
          if (r.blocked) blocked = true;
          aggregateScore += r.risk_score ?? 0;
          if (severityRank(r.severity) > severityRank(worstSeverity)) {
            worstSeverity = r.severity;
          }
        } catch (err) {
          // Fail-secure: a throwing validator MUST NOT allow the call
          // to proceed. Synthesize a CRITICAL finding so connectors
          // can surface the failure to operators.
          blocked = true;
          worstSeverity = Severity.CRITICAL;
          findings.push({
            category: 'validator_error',
            severity: Severity.CRITICAL,
            description: `Final validator '${v.name ?? 'unnamed'}' threw: ${
              err instanceof Error ? err.message : String(err)
            }. Fail-secure: result forced to BLOCK.`,
            weight: 10,
          });
          aggregateScore += 10;
        }
      }
    } finally {
      // Reset streaming state — next session starts clean even if the
      // loop above re-threw (shouldn't, since each iteration catches).
      this.clearSessionState();
    }

    const result = createResult(!blocked, worstSeverity, findings);
    result.risk_score = aggregateScore;
    result.risk_level = scoreToRiskLevel(aggregateScore);
    result.metadata = {
      ...(result.metadata ?? {}),
      surface: AUDIO_STREAM_SURFACE,
    };
    return result;
  }

  // -------------------------------------------------------------------------
  // VALIDATOR INTERFACE CONFORMANCE (architect B1)
  // -------------------------------------------------------------------------

  /**
   * `Validator` interface entry point. Connectors that wire this
   * validator into a `GuardrailEngine` validator chain can emit
   * `{ kind: 'audio_partial', content, isFinal }`. Dispatches to
   * `validatePartial` (default) or `validateFinal` (when `isFinal`).
   *
   * For partial calls, packages a `GuardrailResult` summarising the
   * automaton matches; the rich `AudioStreamPartialResult` (with
   * `releasedText`, per-match indices) is only available via the
   * direct `validatePartial` API.
   */
  async validate(input: string | ValidatorInput): Promise<GuardrailResult> {
    let content: string;
    let isFinal = true;

    if (typeof input === 'string') {
      content = input;
    } else if (input.kind === 'audio_partial') {
      content = input.content;
      isFinal = input.isFinal ?? false;
    } else if (input.kind === 'text') {
      content = input.content;
    } else {
      throw new TypeError(
        `AudioStreamValidator.validate: unsupported ValidatorInput kind '${input.kind}'. ` +
          `Expected 'audio_partial' or 'text'.`
      );
    }

    if (isFinal) {
      return this.validateFinal(content);
    }

    const partial = this.validatePartial(content);
    const findings: Finding[] = partial.matches.map((m) => ({
      category: m.pattern.category,
      severity: m.pattern.severity === 'critical' ? Severity.CRITICAL : Severity.WARNING,
      match: m.pattern.needle,
      description: m.pattern.description,
      weight: m.pattern.severity === 'critical' ? 10 : 5,
    }));
    const worstSeverity =
      findings.find((f) => f.severity === Severity.CRITICAL)?.severity ??
      findings[0]?.severity ??
      Severity.INFO;
    const result = createResult(!partial.earlyBlock, worstSeverity, findings);
    result.risk_score = findings.reduce((s, f) => s + (f.weight ?? 0), 0);
    result.risk_level = scoreToRiskLevel(result.risk_score);
    result.metadata = {
      surface: AUDIO_STREAM_SURFACE,
      partialCoverageOnly: true,
      earlyBlock: partial.earlyBlock,
    };
    return result;
  }

  // -------------------------------------------------------------------------
  // SIGNAL + RESET
  // -------------------------------------------------------------------------

  /**
   * Non-destructive read of the early-block flag (security B-1). Safe
   * to call repeatedly without resetting session state.
   */
  peekEarlyBlock(): boolean {
    return this.earlyBlock;
  }

  /**
   * **ONE-SHOT**: returns the early-block flag and resets session
   * state (automaton + flag + gate). Second call returns `false`
   * regardless of prior signal. Use `peekEarlyBlock()` for
   * non-destructive checks; this method is for connectors that
   * consume the signal exactly once at session close.
   *
   * Story brief uses this name (`getSignalEarlyBlock`); the alias
   * `consumeEarlyBlock()` is preferred in new code for clarity.
   */
  getSignalEarlyBlock(): boolean {
    return this.consumeEarlyBlock();
  }

  /**
   * **ONE-SHOT** alias for {@link getSignalEarlyBlock}. Returns the
   * flag, then resets. Name is more honest about the destructive read.
   */
  consumeEarlyBlock(): boolean {
    const flag = this.earlyBlock;
    this.clearSessionState();
    return flag;
  }

  /**
   * Explicit session reset. Returns the number of bytes silently
   * dropped from the gate's pending buffer (security C-4). A non-zero
   * `droppedBytes` when the caller did NOT first call `validateFinal`
   * indicates unvalidated transcript content was discarded — surface
   * this to operators if the buffer might have held malicious content.
   */
  resetSession(): AudioStreamResetReport {
    const droppedBytes = this.gate.pendingSize;
    this.clearSessionState();
    return { droppedBytes };
  }

  /** Internal: clear all session state without reporting. */
  private clearSessionState(): void {
    this.earlyBlock = false;
    this.automaton.reset();
    this.gate.drop();
  }

  // -------------------------------------------------------------------------
  // FACTORIES + DISPOSAL
  // -------------------------------------------------------------------------

  /**
   * Clone the validator into a fresh stateful instance (security B-2).
   * The pattern set + automaton trie are rebuilt from the same config;
   * session state (`earlyBlock`, automaton position, gate buffer) is
   * NOT shared. Use one fork per concurrent voice session.
   */
  fork(): AudioStreamValidator {
    return new AudioStreamValidator(this.config);
  }

  /**
   * `await using validator = new AudioStreamValidator(...)` clears
   * session state on scope exit. Symmetric with `StreamValidator`'s
   * disposal pattern.
   */
  async [Symbol.asyncDispose](): Promise<void> {
    this.clearSessionState();
  }
}

// =============================================================================
// INTERNAL UTILITIES
// =============================================================================

function severityRank(s: Severity): number {
  // CRITICAL ranks highest; BLOCKED is treated as an outcome label
  // below CRITICAL on the severity scale (matches the precedent in
  // `pattern-engine.ts` + `prompt-injection.ts`).
  switch (s) {
    case Severity.CRITICAL:
      return 4;
    case Severity.BLOCKED:
      return 3;
    case Severity.WARNING:
      return 2;
    case Severity.INFO:
    default:
      return 1;
  }
}

// Sprint 17 buffer (cumulative audit code-reviewer CONCERN-1 closure):
// scoreToRisk → scoreToRiskLevel (shared, 10/5/0 unified thresholds).
// Old audio-stream-specific 7/3/0 thresholds removed; connectors
// observing risk_level across validators now see a single scale.

// =============================================================================
// EXPORTS FOR TEST + CONSUMER REUSE
// =============================================================================

export { DEFAULT_AUDIO_STREAM_PATTERNS };
