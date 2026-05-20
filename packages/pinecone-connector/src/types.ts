/**
 * Pinecone Connector Types
 *
 * This file contains all TypeScript type definitions for the Pinecone connector.
 * Includes security-related options for vector query validation and retrieval safety.
 */

import type { Guard, GuardrailResult, Logger, Validator } from '@blackunicorn/bonklm';

/**
 * Configuration options for the guarded Pinecone wrapper.
 *
 * @remarks
 * All security options are included to address vector database vulnerabilities:
 * - Query injection validation
 * - Retrieved vector poisoning detection
 * - Metadata filter sanitization
 * - Production mode error messages
 * - Validation timeout
 */
export interface GuardedPineconeOptions {
  /**
   * Validators to apply to queries.
   */
  validators?: Validator[];

  /**
   * Guards to apply to retrieved content.
   */
  guards?: Guard[];

  /**
   * Logger instance for validation events.
   *
   * @defaultValue createLogger('console')
   */
  logger?: Logger;

  /**
   * Whether to validate retrieved vectors.
   *
   * @remarks
   * When enabled, each retrieved vector's metadata/content is validated.
   *
   * @defaultValue true
   */
  validateRetrievedVectors?: boolean;

  /**
   * Action to take when a retrieved vector is blocked.
   *
   * @remarks
   * - 'filter': Remove the vector from results (default)
   * - 'abort': Stop the entire query and return error
   *
   * @defaultValue 'filter'
   */
  onBlockedVector?: 'filter' | 'abort';

  /**
   * Production mode flag.
   *
   * @defaultValue process.env.NODE_ENV === 'production'
   */
  productionMode?: boolean;

  /**
   * Validation timeout in milliseconds.
   *
   * @defaultValue 30000 (30 seconds)
   */
  validationTimeout?: number;

  /**
   * Maximum number of vectors to retrieve.
   *
   * @defaultValue 100
   */
  maxTopK?: number;

  /**
   * Whether to sanitize metadata filter expressions.
   *
   * @remarks
   * Prevents metadata filter injection attacks.
   *
   * @defaultValue true
   */
  sanitizeMetadataFilters?: boolean;

  /**
   * Callback invoked when query is blocked.
   */
  onQueryBlocked?: (result: GuardrailResult) => void;

  /**
   * Callback invoked when a vector is blocked.
   */
  onVectorBlocked?: (vectorId: string, result: GuardrailResult) => void;
}

/**
 * Result type for guarded query operations.
 */
export interface GuardedQueryResult {
  /**
   * Retrieved matches/vectors.
   */
  matches: any[];

  /**
   * Number of vectors blocked during validation.
   */
  vectorsBlocked?: number;

  /**
   * Whether the query was partially filtered.
   */
  filtered?: boolean;

  /**
   * The original result from Pinecone.
   */
  raw?: any;
}

/**
 * Vector query options.
 */
export interface VectorQueryOptions {
  /**
   * The vector to query with.
   */
  vector: number[];

  /**
   * Number of results to return.
   */
  topK?: number;

  /**
   * Namespace to query.
   */
  namespace?: string;

  /**
   * Filter expression.
   */
  filter?: any;

  /**
   * Include values in results.
   */
  includeValues?: boolean;

  /**
   * Include metadata in results.
   */
  includeMetadata?: boolean;
}

/**
 * Default validation timeout (30 seconds).
 *
 * @internal
 */
export const DEFAULT_VALIDATION_TIMEOUT = 30000;

/**
 * Default max topK value.
 *
 * @internal
 */
export const DEFAULT_MAX_TOP_K = 100;
