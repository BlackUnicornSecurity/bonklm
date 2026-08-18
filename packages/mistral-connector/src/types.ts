/**
 * @blackunicorn/bonklm-mistral — types
 * ===================================
 *
 * Type surface for the Mistral SDK v2 wrapper. Kept narrow so the
 * connector compiles without pulling the full `@mistralai/mistralai`
 * type tree into the boundary signature (peer-dep optionality).
 *
 * **ESM-only.** Mistral SDK v2 ships ESM-only (`"type": "module"` in
 * its package.json; no CJS fallback). The connector inherits that
 * constraint. Consumers on CJS-only stacks should pin
 * `@mistralai/mistralai@^1.x` (with the older API surface) or
 * migrate their build to ESM. README documents the migration.
 *
 * @package @blackunicorn/bonklm-mistral
 */
import type { GuardrailEngine, Logger } from '@blackunicorn/bonklm';

/**
 * Configuration for `wrapMistral`.
 *
 * `defaultLocale: 'auto'` is the DEFAULT
 * (not the only mode). With `auto`, the connector wires
 * `MultilingualValidator` + reformulation-detection default-on so
 * non-English prompt-injection attempts get caught the same as the
 * English baseline. Consumers can opt out by passing an explicit
 * `defaultLocale: 'en'` etc.
 */
export interface WrapMistralOptions {
  /**
   * Locale handling mode.
   *   - `'auto'` (default): enable MultilingualValidator +
   *     reformulation-detection so the validator pipeline handles
   *     non-English variants symmetrically.
   *   - Any string (`'en'`, `'fr'`, ...): hint the locale; downstream
   *     validators may use it to prioritize patterns.
   *
   * @default 'auto'
   */
  defaultLocale?: 'auto' | string;

  /**
   * When true AND a `classifiers.moderate` response is available
   * for the input, the connector adds an advisory FINDING (low
   * severity, non-blocking) from Mistral's moderation result.
   * Consumers wiring `engine.onIntercept(...)` see Mistral's
   * model-side judgement alongside the validator pipeline output.
   *
   * **Cost note**: enabling this adds an extra `classifiers.moderate`
   * round-trip to every chat/agents/fim call. Use selectively in
   * production.
   *
   * @default false
   */
  enableModerateSecondOpinion?: boolean;

  /**
   * Production-mode flag for error messages. When true,
   * `MistralGuardrailBlockedError` carries generic strings; when
   * false, the validator's `reason` is included for debugging.
   * @default false
   */
  productionMode?: boolean;

  /**
   * Optional logger. The connector emits warns on defensive
   * JSON.parse failures (malformed tool-call arguments) +
   * non-string content fields.
   */
  logger?: Logger;

  /**
   * Pre-validate INPUT messages (the user prompts) BEFORE calling
   * the underlying Mistral API. On BLOCK throws
   * `MistralGuardrailBlockedError` and the API call is never made.
   * @default true
   */
  validateInputs?: boolean;

  /**
   * Post-validate OUTPUT content (the model's response text)
   * AFTER the API returns + BEFORE handing back to the consumer.
   * On BLOCK throws.
   * @default true
   */
  validateOutputs?: boolean;

  /**
   * When true, validate EVERY message in the request (system +
   * assistant + tool + user) rather than just user-role messages.
   *
   * @security multi-turn deployments
   *   where assistant history is attacker-influenced (RAG-retrieved
   *   history, vector-store poisoning, prior-turn fed back in) need
   *   this opt-in. Without it, an attacker who controls the
   *   `assistant` slot bypasses the user-only validator. Costs an
   *   extra validate-per-message; recommended for chat interfaces
   *   that replay session history.
   *
   * @default false (user-role only)
   */
  validateAllMessages?: boolean;
}

/**
 * Subset of Mistral's `Mistral` client surface the connector wraps.
 * Each sub-resource (chat/agents/fim/embeddings/classifiers) is
 * intercepted via the Proxy `get` trap; everything else passes
 * through unchanged.
 *
 * Structural typing so consumers can pass either the real `Mistral`
 * instance OR a mock at test time.
 */
export interface MistralLike {
  readonly chat?: unknown;
  readonly agents?: unknown;
  readonly fim?: unknown;
  readonly embeddings?: unknown;
  readonly classifiers?: unknown;
  [k: string]: unknown;
}

/**
 * Error thrown by wrapped Mistral methods when the validator
 * pipeline blocks the call. Extends standard `Error` so consumers
 * can catch via `instanceof`.
 */
export interface MistralGuardrailBlockedErrorShape extends Error {
  /** Surface tag — `chat:complete:input`, `agents:stream:output`, etc. */
  readonly surface: string;
  /** Sanitized blocking reason (200-char cap, control chars stripped). */
  readonly reason?: string;
}

/**
 * Public structural surface of `wrapMistral`. The wrapper preserves
 * the consumer's original `client` type (returns `T`); the structural
 * shape here documents what the wrapper guarantees but does NOT
 * narrow the type.
 */
export interface WrappedMistralClient extends MistralLike {
  /** Original Mistral client reference (escape hatch). */
  readonly raw: MistralLike;
}

/**
 * Helper alias — what the connector needs from the engine. Subset of
 * `GuardrailEngine` so consumers can stub the engine in tests
 * without constructing a full instance.
 */
export type MistralEngineLike = Pick<
  GuardrailEngine,
  'validate' | 'validateInput' | 'getInstanceId' | 'notifyCachedResult' | 'getValidators' | 'addValidator'
>;
