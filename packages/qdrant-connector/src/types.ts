/**
 * Qdrant Guarded Wrapper Types
 * ==============================
 *
 * Type definitions for the Qdrant guardrails connector.
 *
 * @package @blackunicorn/bonklm-qdrant
 */

// D-011 (Sprint 52 Gate 2): explicit resolution-mode attribute required so
// consumers with `moduleResolution: "node16"`/`"nodenext"` can type-resolve
// these imports across the CJS connector → ESM core boundary. Without the
// attribute, tsc emits TS1541 in the consumer build.
import type { Guard, GuardrailResult, Logger, Validator } from '@blackunicorn/bonklm' with {
  'resolution-mode': 'import'
};
import type { RetrievedDocValidator } from '@blackunicorn/bonklm' with { 'resolution-mode': 'import' };

/**
 * Default validation timeout in milliseconds.
 *
 * @defaultValue 30000 (30 seconds)
 */
export const DEFAULT_VALIDATION_TIMEOUT = 30000;

/**
 * Default maximum number of points to retrieve.
 *
 * @defaultValue 50
 */
export const DEFAULT_MAX_LIMIT = 50;

/**
 * Default maximum filter string length.
 *
 * @defaultValue 10000
 */
export const DEFAULT_MAX_FILTER_LENGTH = 10000;

/**
 * Default maximum payload size in bytes.
 *
 * @defaultValue 1048576 (1MB)
 */
export const DEFAULT_MAX_PAYLOAD_SIZE = 1048576;

/**
 * Default regex timeout in milliseconds.
 *
 * @defaultValue 5000
 */
export const DEFAULT_REGEX_TIMEOUT = 5000;

/**
 * How to handle blocked points in search results.
 */
export type BlockedPointHandling = 'filter' | 'abort';

/**
 * Configuration options for the guarded Qdrant client wrapper.
 */
export interface GuardedQdrantOptions {
  /**
   * Validators to apply to queries and retrieved points.
   *
   * @defaultValue []
   */
  validators?: Validator[];

  /**
   * Guards to apply to retrieved content.
   *
   * @defaultValue []
   */
  guards?: Guard[];

  /**
   * Logger instance for debug/warning/error messages.
   *
   * @defaultValue console logger
   */
  logger?: Logger;

  /**
   * Whether to validate retrieved points.
   *
   * @defaultValue true
   */
  validateRetrievedPoints?: boolean;

  /**
   * How to handle blocked points.
   *
   * @defaultValue 'filter'
   */
  onBlockedPoint?: BlockedPointHandling;

  /**
   * Use generic error messages in production mode.
   *
   * @defaultValue process.env.NODE_ENV === 'production'
   */
  productionMode?: boolean;

  /**
   * Maximum time to wait for validation (milliseconds).
   *
   * @defaultValue 30000
   */
  validationTimeout?: number;

  /**
   * Maximum number of points to allow per search.
   *
   * @defaultValue 50
   */
  maxLimit?: number;

  /**
   * Whether to validate filter expressions.
   *
   * @defaultValue true
   */
  validateFilters?: boolean;

  /**
   * Story 1.2 — opt-in batch retrieved-doc validator. Replaces the
   * per-point validation loop with a single batch call supporting the
   * `drop` / `block-all` / `redact` failure modes. NOT default-on.
   */
  retrievedDocValidator?: RetrievedDocValidator;

  /**
   * Allowed payload fields (empty = all allowed).
   *
   * @defaultValue []
   *
   * @remarks
   * When specified, only these payload fields can be retrieved.
   * Useful for restricting access to sensitive fields.
   */
  allowedPayloadFields?: string[];

  /**
   * Maximum filter string length to prevent DoS.
   *
   * @defaultValue 10000
   *
   * @remarks
   * Prevents excessively large filter strings that could cause
   * performance issues or ReDoS attacks.
   */
  maxFilterLength?: number;

  /**
   * Maximum payload size in bytes.
   *
   * @defaultValue 1048576 (1MB)
   *
   * @remarks
   * Prevents memory exhaustion through large payloads.
   */
  maxPayloadSize?: number;

  /**
   * Maximum regex execution timeout in milliseconds.
   *
   * @defaultValue 5000
   *
   * @remarks
   * Prevents ReDoS attacks through long-running regex operations.
   */
  regexTimeout?: number;

  /**
   * Callback when query is blocked.
   */
  onQueryBlocked?: (result: GuardrailResult) => void;

  /**
   * Callback when a point is blocked.
   */
  onPointBlocked?: (pointId: string | number, result: GuardrailResult) => void;
}

/**
 * Search options for Qdrant.
 */
export interface QdrantSearchOptions {
  /**
   * Collection name.
   */
  collectionName: string;

  /**
   * Query vector.
   */
  vector: number[];

  /**
   * Maximum number of results.
   */
  limit?: number;

  /**
   * Score threshold for filtering.
   */
  scoreThreshold?: number;

  /**
   * Payload filter expression.
   */
  filter?: Record<string, any>;

  /**
   * Whether to include payload in results.
   */
  withPayload?: boolean | string[];

  /**
   * Whether to include vectors in results.
   */
  withVector?: boolean;

  /**
   * Additional parameters.
   */
  [key: string]: any;
}

/**
 * Point data structure.
 */
export interface QdrantPoint {
  /**
   * Point ID.
   */
  id: string | number;

  /**
   * Similarity score.
   */
  score: number;

  /**
   * Payload data.
   */
  payload?: Record<string, any>;

  /**
   * Vector data (if requested).
   */
  vector?: number[];
}

/**
 * Result from a guarded Qdrant search.
 */
export interface GuardedQdrantResult {
  /**
   * Retrieved points (filtered if any were blocked).
   */
  points: QdrantPoint[];

  /**
   * Number of points blocked by guardrails.
   */
  pointsBlocked?: number;

  /**
   * Whether any content was filtered.
   */
  filtered?: boolean;

  /**
   * Raw unfiltered result from Qdrant.
   */
  raw?: any;
}
