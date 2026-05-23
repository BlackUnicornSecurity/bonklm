/**
 * BonkLM - GuardrailEngine Types
 * ===============================
 * Interface and type declarations for GuardrailEngine. Extracted to keep the
 * orchestration class file under the 800-line cap.
 */

import type { Logger } from '../base/GenericLogger.js';
import type { GuardrailResult } from '../base/GuardrailResult.js';
import type { OverrideTokenConfigString } from '../security/override-token.js';

/**
 * Story 1.1 (R2-10) — canonical surface vocabulary lock.
 *
 * These seven strings are the ONLY accepted hook / validator surfaces.
 * Synonyms ('prompt', 'output', 'tool_args', etc.) are forbidden — pick
 * the canonical name when extending the engine, or add a new entry here
 * with sprint-team approval. Story 3.11 OTel emits `bonklm.surface` using
 * these exact strings.
 */
export type HookSurface =
  | 'text_input'
  | 'text_output'
  | 'tool_call'
  | 'retrieved_doc'
  | 'memory_write'
  | 'audio_partial'
  | 'composed_context';

/**
 * Story 1.1 (R2-8) — ValidatorInput discriminated union.
 *
 * The five `kind` strings mirror the long-form surface vocabulary above
 * (note: `retrieved_doc`/`retrieved_docs` and `memory_write` keep the
 * canonical names — the singular/plural difference is intentional: the
 * surface fires per-doc, the validator input carries the batch).
 */
export type ValidatorInput =
  | { kind: 'text'; content: string }
  | { kind: 'tool_call'; toolName: string; args: unknown }
  | {
      kind: 'retrieved_docs';
      docs: Array<{ id?: string; content: string; metadata?: Record<string, unknown> }>;
    }
  | {
      kind: 'memory_write';
      payload: {
        content: string;
        userId?: string;
        sessionId?: string;
        metadata?: Record<string, unknown>;
      };
    }
  | { kind: 'composed_context'; entries: string[] }
  | {
      /**
       * Story 3.1 — audio-stream `validate(input)` entry point. Carries
       * a transcript chunk (`content`) plus a flag distinguishing the
       * partial-hot-path call from the final-heavy-path call. Connectors
       * that wire `AudioStreamValidator` into a `GuardrailEngine`
       * validator chain emit `{ kind: 'audio_partial', isFinal,
       * content }`; the validator routes to `validatePartial` /
       * `validateFinal` internally.
       */
      kind: 'audio_partial';
      content: string;
      isFinal?: boolean;
    };

/**
 * Validator instance interface.
 *
 * Story 1.1 (R2-8): `validate` accepts the legacy `string` shape OR the
 * new `ValidatorInput` discriminated union. The string-arg path is
 * `@deprecated` in 0.4, will throw in 0.5, removed in 1.0.
 *
 * Return type accepts sync or async results so future ML / remote-API
 * validators can plug in without breaking existing sync validators.
 *
 * @public Sprint 26/28 v1.0-RC1 API freeze. Adding a required method
 * is a major-version break; new OPTIONAL methods (e.g. `validateStream`)
 * may be added in minor versions.
 */
export interface Validator {
  /**
   * Validate content and return a result (sync or async).
   *
   * @param input - Legacy string OR a `ValidatorInput` union member.
   *   The string overload is retained for backward compatibility with
   *   pre-0.4 validators; new code should pass `{ kind, ... }` directly.
   */
  validate(input: string | ValidatorInput): GuardrailResult | Promise<GuardrailResult>;

  /**
   * Optional validator name for identification.
   */
  name?: string;
}

/**
 * Guard instance interface.
 * Guards validate content with optional context (e.g., file path).
 * Return type accepts sync or Promise for forward compatibility.
 *
 * @public Sprint 26/28 v1.0-RC1 API freeze.
 */
export interface Guard {
  /**
   * Validate content and return a result (sync or async).
   */
  validate(content: string, context?: string): GuardrailResult | Promise<GuardrailResult>;

  /**
   * Optional guard name for identification.
   */
  name?: string;
}

/**
 * Execution order for validators.
 */
export type ExecutionOrder = 'sequential' | 'parallel';

/**
 * Engine configuration options.
 */
export interface GuardrailEngineConfig {
  /**
   * List of validators to run.
   */
  validators?: Validator[];

  /**
   * List of guards to run.
   */
  guards?: Guard[];

  /**
   * Whether to stop execution on first failure.
   * @default true
   */
  shortCircuit?: boolean;

  /**
   * Execution order for validators.
   * @default 'sequential'
   */
  executionOrder?: ExecutionOrder;

  /**
   * Custom logger.
   */
  logger?: Logger;

  /**
   * Whether to include individual validator results in the output.
   * @default true
   */
  includeIndividualResults?: boolean;

  /**
   * Global sensitivity level.
   * @default 'standard'
   */
  sensitivity?: 'strict' | 'standard' | 'permissive';

  /**
   * Global action mode.
   * @default 'block'
   */
  action?: 'block' | 'sanitize' | 'log' | 'allow';

  /**
   * Override token to bypass validation.
   * S011-006: Now supports cryptographic validation.
   * - string: Legacy plaintext token (INSECURE, not recommended)
   * - OverrideTokenConfig object: Secure HMAC-based token validation
   *
   * @example
   * // Legacy (insecure)
   * overrideToken: 'BYPASS-VALIDATION'
   *
   * // Secure (recommended)
   * overrideToken: { secret: 'your-32-char-secret' }
   */
  overrideToken?: OverrideTokenConfigString;

  /**
   * Maximum time in milliseconds for validation to complete.
   * Prevents DoS via complex regex patterns. @default 5000ms
   */
  validationTimeout?: number;

  /**
   * Maximum time for individual pattern matching.
   * Prevents ReDoS attacks. @default 100ms
   */
  patternTimeout?: number;

  /**
   * Maximum buffer size for streaming validation in bytes.
   * Prevents memory exhaustion through buffer overflow attacks. @default 1MB
   */
  maxBufferSize?: number;

  /**
   * Circuit breaker threshold for buffer overflow violations.
   * Triggers circuit breaker after this many violations. @default 3
   */
  circuitBreakerThreshold?: number;

  /**
   * Circuit breaker timeout in milliseconds.
   * How long to stay in OPEN state before attempting recovery. @default 60000ms (1 minute)
   */
  circuitBreakerTimeout?: number;

  /**
   * Story 0.1 (R2-7) escape hatch.
   *
   * An engine with neither validators nor guards has no protective layer:
   * every input is silently allowed. The constructor refuses such a config
   * by default. Set this to `true` to bypass the check — intended for unit
   * tests that exercise the engine shell. Using the hatch logs a CRITICAL
   * warning so it cannot be silently abused in production. @default false
   */
  allowEmptyForTesting?: boolean;
}

/**
 * Individual validator result with metadata.
 */
export interface ValidatorResult extends GuardrailResult {
  /**
   * Name of the validator that produced this result.
   */
  validatorName: string;
}

/**
 * Aggregated engine result.
 */
export interface EngineResult extends GuardrailResult {
  /**
   * Individual results from each validator/guard.
   */
  results: ValidatorResult[];

  /**
   * Number of validators run.
   */
  validatorCount: number;

  /**
   * Number of guards run.
   */
  guardCount: number;

  /**
   * Execution time in milliseconds.
   */
  executionTime: number;
}

/**
 * Callback function type for intercept events.
 * Called when validation completes with a result.
 *
 * @param result - The engine result from validation
 * @param context - Context including original content and optional validation context
 */
export type InterceptCallback = (
  result: EngineResult,
  context: {
    content: string;
    validation_context?: string;
  }
) => void | Promise<void>;
