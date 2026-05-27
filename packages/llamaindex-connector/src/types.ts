/**
 * LlamaIndex Connector Types
 *
 * This file contains all TypeScript type definitions for the LlamaIndex connector.
 * Includes security-related options for RAG query validation, document validation,
 * and retrieval safety.
 */

// D-011 (Sprint 52 Gate 2): explicit resolution-mode attribute required so
// consumers with `moduleResolution: "node16"`/`"nodenext"` can type-resolve
// this import across the CJS connector → ESM core boundary. Without the
// attribute, tsc emits TS1541 in the consumer build.
import type { Guard, GuardrailResult, Logger, Validator } from '@blackunicorn/bonklm' with { 'resolution-mode': 'import' };

/**
 * Configuration options for the guarded LlamaIndex wrapper.
 *
 * @remarks
 * All security options are included to address RAG-specific vulnerabilities:
 * - Query injection validation
 * - Retrieved document poisoning detection
 * - Response validation for synthesis
 * - Production mode error messages
 * - Validation timeout
 */
export interface GuardedLlamaIndexOptions {
  /**
   * Validators to apply to queries and responses.
   */
  validators?: Validator[];

  /**
   * Guards to apply to retrieved content and responses.
   */
  guards?: Guard[];

  /**
   * Logger instance for validation events.
   *
   * @defaultValue createLogger('console')
   */
  logger?: Logger;

  /**
   * Whether to validate retrieved documents.
   *
   * @remarks
   * When enabled, each retrieved document is validated before synthesis.
   * This prevents poisoned documents from being used in response generation.
   *
   * @defaultValue true
   */
  validateRetrievedDocs?: boolean;

  /**
   * Action to take when a retrieved document is blocked.
   *
   * @remarks
   * - 'filter': Remove the document from results (default)
   * - 'abort': Stop the entire query and return error
   * - 'replace': Replace with placeholder indicating content was filtered
   *
   * @defaultValue 'filter'
   */
  onBlockedDocument?: 'filter' | 'abort' | 'replace';

  /**
   * Production mode flag.
   *
   * @remarks
   * When true, error messages are generic to avoid leaking security information.
   *
   * @defaultValue process.env.NODE_ENV === 'production'
   */
  productionMode?: boolean;

  /**
   * Validation timeout in milliseconds.
   *
   * @remarks
   * Prevents hanging on slow or malicious inputs.
   *
   * @defaultValue 30000 (30 seconds)
   */
  validationTimeout?: number;

  /**
   * Maximum number of documents to retrieve.
   *
   * @remarks
   * Limits retrieval to prevent excessive processing.
   *
   * @defaultValue 10
   */
  maxRetrievedDocs?: number;

  /**
   * Callback invoked when query is blocked.
   *
   * @param result - The validation result that caused blocking.
   */
  onQueryBlocked?: (result: GuardrailResult) => void;

  /**
   * Callback invoked when a document is blocked.
   *
   * @param document - The document content that was blocked.
   * @param result - The validation result.
   */
  onDocumentBlocked?: (document: string, result: GuardrailResult) => void;

  /**
   * Callback invoked when response is blocked.
   *
   * @param result - The validation result that caused blocking.
   */
  onResponseBlocked?: (result: GuardrailResult) => void;
}

/**
 * Result type for guarded query operations.
 */
export interface GuardedQueryResult {
  /**
   * The generated response text.
   */
  response: string;

  /**
   * Retrieved nodes/documents used in generating the response.
   */
  sourceNodes?: any[];

  /**
   * Whether the result was filtered by guardrails.
   */
  filtered?: boolean;

  /**
   * Number of documents blocked during retrieval validation.
   */
  documentsBlocked?: number;

  /**
   * The original result object from LlamaIndex.
   */
  raw?: any;
}

/**
 * Document validation result.
 */
export interface DocumentValidationResult {
  /**
   * The document content.
   */
  content: string;

  /**
   * Whether the document passed validation.
   */
  allowed: boolean;

  /**
   * Validation result if blocked.
   */
  result?: GuardrailResult;
}

/**
 * Default validation timeout (30 seconds).
 *
 * @internal
 */
export const DEFAULT_VALIDATION_TIMEOUT = 30000;

/**
 * Default maximum retrieved documents.
 *
 * @internal
 */
export const DEFAULT_MAX_RETRIEVED_DOCS = 10;
