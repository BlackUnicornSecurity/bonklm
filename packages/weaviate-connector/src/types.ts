/**
 * Weaviate Guarded Wrapper Types
 * ===============================
 *
 * Type definitions for the Weaviate guardrails connector.
 *
 * @package @blackunicorn/bonklm-weaviate
 */

// D-011 (Sprint 52 Gate 2): explicit resolution-mode attribute required so
// consumers with `moduleResolution: "node16"`/`"nodenext"` can type-resolve
// these imports across the CJS connector → ESM core boundary. Without the
// attribute, tsc emits TS1541 in the consumer build.
import type { Guard, GuardrailResult, Logger, Validator } from '@blackunicorn/bonklm' with { 'resolution-mode': 'import' };
import type { RetrievedDocValidator } from '@blackunicorn/bonklm' with { 'resolution-mode': 'import' };

/**
 * Default validation timeout in milliseconds.
 *
 * @defaultValue 30000 (30 seconds)
 */
export const DEFAULT_VALIDATION_TIMEOUT = 30000;

/**
 * Default maximum number of results to retrieve.
 *
 * @defaultValue 50
 */
export const DEFAULT_MAX_LIMIT = 50;

/**
 * How to handle blocked objects in query results.
 */
export type BlockedObjectHandling = 'filter' | 'abort';

/**
 * Configuration options for the guarded Weaviate client wrapper.
 */
export interface GuardedWeaviateOptions {
  /**
   * Validators to apply to queries and retrieved objects.
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
   * Whether to validate retrieved objects.
   *
   * @defaultValue true
   */
  validateRetrievedObjects?: boolean;

  /**
   * How to handle blocked objects.
   *
   * @defaultValue 'filter'
   */
  onBlockedObject?: BlockedObjectHandling;

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
   * Maximum number of results to allow per query.
   *
   * @defaultValue 50
   */
  maxLimit?: number;

  /**
   * Allowed class names (empty = all allowed).
   *
   * @defaultValue []
   *
   * @remarks
   * When specified, only these class names can be queried.
   * Supports wildcard patterns (e.g., 'Document*' matches 'Document', 'Documents', etc.)
   */
  allowedClasses?: string[];

  /**
   * Allowed field names (empty = all allowed).
   *
   * @defaultValue []
   *
   * @remarks
   * When specified, only these fields can be retrieved.
   * Useful for restricting access to sensitive fields.
   */
  allowedFields?: string[];

  /**
   * Story 1.2 — opt-in batch retrieved-doc validator. Replaces the
   * per-object validation loop with a single batch call supporting the
   * `drop` / `block-all` / `redact` failure modes. NOT default-on.
   */
  retrievedDocValidator?: RetrievedDocValidator;

  /**
   * Whether to validate filter expressions.
   *
   * @defaultValue true
   */
  validateFilters?: boolean;

  /**
   * Callback when query is blocked.
   */
  onQueryBlocked?: (result: GuardrailResult) => void;

  /**
   * Callback when an object is blocked.
   */
  onObjectBlocked?: (object: any, result: GuardrailResult) => void;

  /**
   * Callback when class is not allowed.
   */
  onClassNotAllowed?: (className: string) => void;
}

/**
 * GraphQL query options for Weaviate.
 */
export interface WeaviateQueryOptions {
  /**
   * Class name to query.
   */
  className: string;

  /**
   * Fields to retrieve.
   */
  fields?: string[];

  /**
   * Maximum number of results.
   */
  limit?: number;

  /**
   * Near text search (semantic).
   */
  nearText?: {
    concepts: string[];
  };

  /**
   * BM25 search (keyword).
   */
  bm25?: {
    query: string;
  };

  /**
   * Hybrid search (BM25 + vector).
   */
  hybrid?: {
    query: string;
    alpha?: number;
  };

  /**
   * Filter expression.
   */
  where?: Record<string, any>;

  /**
   * Additional parameters.
   */
  [key: string]: any;
}

/**
 * Result from a guarded Weaviate query.
 */
export interface GuardedWeaviateResult {
  /**
   * Retrieved objects (filtered if any were blocked).
   */
  data?: any;

  /**
   * Number of objects blocked by guardrails.
   */
  objectsBlocked?: number;

  /**
   * Whether any content was filtered.
   */
  filtered?: boolean;

  /**
   * Raw unfiltered result from Weaviate.
   */
  raw?: any;
}
