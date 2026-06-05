/**
 * ChromaDB Guarded Wrapper Types
 * =================================
 *
 * Type definitions for the ChromaDB guardrails connector.
 *
 * @package @blackunicorn/bonklm-chroma
 */

import type { Guard, GuardrailResult, Logger, Validator } from '@blackunicorn/bonklm';
import type { RetrievedDocValidator } from '@blackunicorn/bonklm';

/**
 * Default validation timeout in milliseconds.
 *
 * @defaultValue 30000 (30 seconds)
 *
 * @remarks
 * This prevents validation from hanging indefinitely. Adjust based on your
 * validator performance requirements.
 */
export const DEFAULT_VALIDATION_TIMEOUT = 30000;

/**
 * Default maximum number of results to retrieve.
 *
 * @defaultValue 20
 *
 * @remarks
 * Prevents excessive data retrieval that could be used for data exfiltration.
 */
export const DEFAULT_MAX_N_RESULTS = 20;

/**
 * How to handle blocked documents in query results.
 *
 * @remarks
 * - 'filter': Remove blocked documents from results (default)
 * - 'abort': Throw error and abort the entire query
 */
export type BlockedDocumentHandling = 'filter' | 'abort';

/**
 * Configuration options for the guarded ChromaDB collection wrapper.
 *
 * @remarks
 * All options are optional with sensible defaults. The wrapper validates
 * both input queries and retrieved document content.
 */
export interface GuardedChromaOptions {
  /**
   * Validators to apply to queries and retrieved documents.
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
   * Whether to validate retrieved documents.
   *
   * @defaultValue true
   *
   * @remarks
   * When enabled, each retrieved document is validated before being returned.
   * Blocked documents are either filtered or cause abort based on `onBlockedDocument`.
   */
  validateRetrievedDocs?: boolean;

  /**
   * How to handle blocked documents.
   *
   * @defaultValue 'filter'
   *
   * @remarks
   * - 'filter': Silently remove blocked documents from results
   * - 'abort': Throw an error and prevent returning any results
   */
  onBlockedDocument?: BlockedDocumentHandling;

  /**
   * Use generic error messages in production mode.
   *
   * @defaultValue process.env.NODE_ENV === 'production'
   *
   * @remarks
   * When true, blocked operations return generic messages like "Query blocked"
   * instead of detailed reasons. This prevents information leakage.
   */
  productionMode?: boolean;

  /**
   * Maximum time to wait for validation (milliseconds).
   *
   * @defaultValue 30000
   *
   * @remarks
   * Prevents validation from hanging. Uses validateWithTimeoutSecure
   * (canonical SEC-008 primitive) for enforcement.
   */
  validationTimeout?: number;

  /**
   * Maximum number of results to allow per query.
   *
   * @defaultValue 20
   *
   * @remarks
   * Enforces a ceiling on nResults to prevent data exfiltration through
   * large result sets.
   */
  maxNResults?: number;

  /**
   * Whether to validate/sanitize metadata filters.
   *
   * @defaultValue true
   *
   * @remarks
   * Validates that filter expressions don't contain injection patterns.
   */
  sanitizeFilters?: boolean;

  /**
   * Story 1.2 — opt-in batch retrieved-doc validator. When set, replaces
   * the per-document validation loop (run once per query batch) with a
   * single call to `retrievedDocValidator.validateBatch(...)`. Supports
   * `drop` / `block-all` / `redact` failure modes. NOT default-on; legacy
   * per-document behavior is preserved when absent.
   */
  retrievedDocValidator?: RetrievedDocValidator;

  /**
   * Callback when query is blocked.
   *
   * @param result - The validation result that caused blocking
   */
  onQueryBlocked?: (result: GuardrailResult) => void;

  /**
   * Callback when a document is blocked.
   *
   * @param document - The blocked document content preview
   * @param result - The validation result that caused blocking
   */
  onDocumentBlocked?: (document: string, result: GuardrailResult) => void;
}

/**
 * Query options for ChromaDB collection queries.
 *
 * @remarks
 * Matches the ChromaDB collection.query() API with additional safety limits.
 */
export interface ChromaQueryOptions {
  /**
   * Query text strings (alternative to queryEmbeddings).
   */
  queryTexts?: string[];

  /**
   * Query embedding vectors (alternative to queryTexts).
   */
  queryEmbeddings?: number[][];

  /**
   * Number of results to return.
   */
  nResults?: number;

  /**
   * Metadata filter expression.
   *
   * @remarks
   * Will be sanitized if `sanitizeFilters` is enabled.
   */
  where?: Record<string, any>;

  /**
   * Additional filters to apply.
   */
  whereDocument?: Record<string, any>;

  /**
   * Fields to include in results.
   */
  include?: ('documents' | 'embeddings' | 'metadatas' | 'distances')[];
}

/**
 * Result from a guarded ChromaDB query.
 *
 * @remarks
 * Extends the native ChromaDB result format with guardrails metadata.
 */
export interface GuardedChromaQueryResult {
  /**
   * Retrieved document texts (filtered if any were blocked).
   */
  documents?: string[][];

  /**
   * Associated metadata (filtered if any were blocked).
   */
  metadatas?: Record<string, any>[][];

  /**
   * Document IDs (filtered if any were blocked).
   */
  ids?: string[][];

  /**
   * Document embeddings (if requested).
   */
  embeddings?: number[][][];

  /**
   * Distance scores (if requested).
   */
  distances?: number[][];

  /**
   * Number of documents blocked by guardrails.
   *
   * @remarks
   * Summed across all query results.
   */
  documentsBlocked?: number;

  /**
   * Whether any content was filtered.
   */
  filtered?: boolean;

  /**
   * Raw unfiltered result from ChromaDB.
   *
   * @remarks
   * Contains the original result before guardrails filtering.
   * Useful for debugging and auditing.
   */
  raw?: any;
}
