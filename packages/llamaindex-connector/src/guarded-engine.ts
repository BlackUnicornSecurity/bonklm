/**
 * LlamaIndex Guarded Wrapper
 * ==========================
 *
 * Provides security guardrails for LlamaIndex.TS RAG operations.
 *
 * Security Features:
 * - Query injection validation before retrieval
 * - Retrieved document poisoning detection
 * - Response synthesis validation
 * - Production mode error messages
 * - Validation timeout via validateWithTimeoutSecure (Sprint 30)
 *
 * @package @blackunicorn/bonklm-llamaindex
 */

import {
  createLogger,
  createResult,
  GuardrailEngine,
  type GuardrailResult,
  type Logger,
  sanitizeMeta,
  Severity,
  validateWithTimeoutSecure
} from '@blackunicorn/bonklm';
import type { GuardedLlamaIndexOptions, GuardedQueryResult } from './types.js';
import { DEFAULT_MAX_RETRIEVED_DOCS, DEFAULT_VALIDATION_TIMEOUT } from './types.js';

/**
 * Default logger instance.
 *
 * @internal
 */
const DEFAULT_LOGGER: Logger = createLogger('console');

/**
 * Represents a wrapped QueryEngine with guardrails.
 */
export interface GuardedQueryEngine {
  query(queryStr: string, options?: any): Promise<GuardedQueryResult>;
}

/**
 * Represents a wrapped Retriever with guardrails.
 */
export interface GuardedRetriever {
  retrieve(queryStr: string, options?: any): Promise<any[]>;
}

/**
 * Creates a guarded QueryEngine wrapper for LlamaIndex operations.
 *
 * @param queryEngine - The LlamaIndex QueryEngine to wrap
 * @param options - Configuration options for the guarded wrapper
 * @returns A guarded query engine with validation
 *
 * @example
 * ```ts
 * import { VectorStoreIndex } from 'llamaindex';
 * import { createGuardedQueryEngine } from '@blackunicorn/bonklm-llamaindex';
 * import { PromptInjectionValidator, PIIGuard } from '@blackunicorn/bonklm';
 *
 * const index = await VectorStoreIndex.fromDocuments(documents);
 * const queryEngine = index.asQueryEngine();
 *
 * const guardedEngine = createGuardedQueryEngine(queryEngine, {
 *   validators: [new PromptInjectionValidator()],
 *   guards: [new PIIGuard()],
 *   validateRetrievedDocs: true,
 *   onBlockedDocument: 'filter'
 * });
 *
 * const result = await guardedEngine.query('Tell me about X');
 * ```
 */
export function createGuardedQueryEngine(queryEngine: any, options: GuardedLlamaIndexOptions = {}): GuardedQueryEngine {
  const {
    validators = [],
    guards = [],
    logger = DEFAULT_LOGGER,
    validateRetrievedDocs = true,
    onBlockedDocument = 'filter',
    productionMode = process.env.NODE_ENV === 'production',
    validationTimeout = DEFAULT_VALIDATION_TIMEOUT,
    maxRetrievedDocs = DEFAULT_MAX_RETRIEVED_DOCS,
    onQueryBlocked,
    onDocumentBlocked,
    onResponseBlocked
  } = options;

  const engine = new GuardrailEngine({
    validators,
    guards,
    logger
  });

  /**
   * Validation timeout wrapper (Sprint 30: routes through canonical validateWithTimeoutSecure primitive).
   *
   * @internal
   */
  const validateWithTimeout = async (content: string, context?: string): Promise<GuardrailResult> => {
    const result = await validateWithTimeoutSecure<GuardrailResult>({
      operation: () => engine.validate(content, context) as Promise<GuardrailResult>,
      timeoutMs: validationTimeout,
      timeoutSentinel: () =>
        createResult(false, Severity.CRITICAL, [
          {
            category: 'timeout',
            description: 'Validation timeout',
            severity: Severity.CRITICAL,
            weight: 30
          }
        ]),
      logger
    });
    return result;
  };

  /**
   * Validates a query string and throws if blocked.
   *
   * @internal
   */
  const validateQuery = async (queryStr: string): Promise<void> => {
    const result = await validateWithTimeout(queryStr, 'rag_query');

    if (!result.allowed) {
      // Sprint 43 cross-connector CWE-117 sweep (security HIGH #3).
      const safeReason = sanitizeMeta(result.reason);
      logger.warn('[Guardrails] Query blocked', { reason: safeReason });
      if (onQueryBlocked) onQueryBlocked(result);

      if (productionMode) {
        throw new Error('Query blocked');
      }
      throw new Error(`Query blocked: ${safeReason}`);
    }
  };

  /**
   * Validates retrieved documents.
   *
   * @internal
   */
  const validateDocuments = async (nodes: any[]): Promise<{ valid: any[]; blocked: number }> => {
    if (!validateRetrievedDocs) {
      return { valid: nodes, blocked: 0 };
    }

    const valid: any[] = [];
    let blocked = 0;

    for (const node of nodes) {
      const content = node.getContent?.() || node.text || String(node);

      const result = await validateWithTimeout(content, 'rag_document');

      if (result.allowed) {
        valid.push(node);
      } else {
        blocked++;
        // Sprint 43 CWE-117 sweep: also sanitize documentPreview —
        // it's a slice of attacker-controlled retrieved doc content.
        const safeReason = sanitizeMeta(result.reason);
        logger.warn('[Guardrails] Document blocked', {
          reason: safeReason,
          documentPreview: sanitizeMeta(content.substring(0, 100))
        });
        if (onDocumentBlocked) {
          onDocumentBlocked(content.substring(0, 200), result);
        }

        if (onBlockedDocument === 'abort') {
          throw new Error(productionMode ? 'Retrieved document blocked' : `Document blocked: ${safeReason}`);
        }
      }
    }

    return { valid, blocked };
  };

  return {
    /**
     * Executes a query with full guardrails validation.
     *
     * @param queryStr - The query string
     * @param options - Additional query options
     * @returns Query result with validation metadata
     */
    async query(queryStr: string, options: any = {}): Promise<GuardedQueryResult> {
      // Step 1: Validate the query
      await validateQuery(queryStr);

      // Step 2: Apply retrieval limit if specified
      const queryOptions = {
        ...options,
        similarityTopK: Math.min(options.similarityTopK || maxRetrievedDocs, maxRetrievedDocs)
      };

      // Step 3: Execute the query
      const result = await queryEngine.query(queryStr, queryOptions);

      // Step 4: Validate retrieved documents if available
      const sourceNodes = result.sourceNodes || [];
      const { valid: validNodes, blocked } = await validateDocuments(sourceNodes);

      // Step 5: Validate the response
      const responseText = result.response || result.toString?.() || String(result);
      const responseResult = await validateWithTimeout(responseText, 'rag_response');

      if (!responseResult.allowed) {
        // Sprint 43 CWE-117 sweep.
        logger.warn('[Guardrails] Response blocked', { reason: sanitizeMeta(responseResult.reason) });
        if (onResponseBlocked) onResponseBlocked(responseResult);

        return {
          response: '[Content filtered by guardrails]',
          filtered: true,
          documentsBlocked: blocked,
          raw: result
        };
      }

      return {
        response: responseText,
        sourceNodes: validNodes,
        filtered: false,
        documentsBlocked: blocked,
        raw: result
      };
    }
  };
}

/**
 * Creates a guarded Retriever wrapper for LlamaIndex retrieval operations.
 *
 * @param retriever - The LlamaIndex Retriever to wrap
 * @param options - Configuration options for the guarded wrapper
 * @returns A guarded retriever with validation
 *
 * @example
 * ```ts
 * import { createGuardedRetriever } from '@blackunicorn/bonklm-llamaindex';
 * import { PromptInjectionValidator } from '@blackunicorn/bonklm';
 *
 * const guardedRetriever = createGuardedRetriever(retriever, {
 *   validators: [new PromptInjectionValidator()],
 *   validateRetrievedDocs: true
 * });
 *
 * const nodes = await guardedRetriever.retrieve('Find documents about X');
 * ```
 */
export function createGuardedRetriever(
  retriever: any,
  options: Omit<GuardedLlamaIndexOptions, 'onResponseBlocked'> = {}
): GuardedRetriever {
  const {
    validators = [],
    guards = [],
    logger = DEFAULT_LOGGER,
    validateRetrievedDocs = true,
    onBlockedDocument = 'filter',
    productionMode = process.env.NODE_ENV === 'production',
    validationTimeout = DEFAULT_VALIDATION_TIMEOUT,
    maxRetrievedDocs = DEFAULT_MAX_RETRIEVED_DOCS,
    onQueryBlocked,
    onDocumentBlocked
  } = options;

  const engine = new GuardrailEngine({
    validators,
    guards,
    logger
  });

  const validateWithTimeout = async (content: string, context?: string): Promise<GuardrailResult> => {
    const result = await validateWithTimeoutSecure<GuardrailResult>({
      operation: () => engine.validate(content, context) as Promise<GuardrailResult>,
      timeoutMs: validationTimeout,
      timeoutSentinel: () =>
        createResult(false, Severity.CRITICAL, [
          {
            category: 'timeout',
            description: 'Validation timeout',
            severity: Severity.CRITICAL,
            weight: 30
          }
        ]),
      logger
    });
    return result;
  };

  return {
    /**
     * Retrieves documents with validation.
     *
     * @param queryStr - The query string
     * @param options - Additional retrieval options
     * @returns Validated document nodes
     */
    async retrieve(queryStr: string, options: any = {}): Promise<any[]> {
      // Validate the query
      const queryResult = await validateWithTimeout(queryStr, 'rag_query');
      if (!queryResult.allowed) {
        // Sprint 43 CWE-117 sweep.
        logger.warn('[Guardrails] Retrieval query blocked', { reason: sanitizeMeta(queryResult.reason) });
        if (onQueryBlocked) onQueryBlocked(queryResult);

        if (productionMode) {
          throw new Error('Query blocked');
        }
        // Sprint 43 CWE-117 sweep.
        throw new Error(`Query blocked: ${sanitizeMeta(queryResult.reason)}`);
      }

      // Apply retrieval limit
      const retrieveOptions = {
        ...options,
        similarityTopK: Math.min(options.similarityTopK || maxRetrievedDocs, maxRetrievedDocs)
      };

      // Execute retrieval
      const nodes = await retriever.retrieve(queryStr, retrieveOptions);

      // Validate documents
      if (!validateRetrievedDocs) {
        return nodes;
      }

      const valid: any[] = [];
      for (const node of nodes) {
        const content = node.getContent?.() || node.text || String(node);
        const result = await validateWithTimeout(content, 'rag_document');

        if (result.allowed) {
          valid.push(node);
        } else {
          // Sprint 43 CWE-117 sweep (sister to retrieved-doc-blocked above).
          const safeReason = sanitizeMeta(result.reason);
          logger.warn('[Guardrails] Retrieved document blocked', {
            reason: safeReason,
            documentPreview: sanitizeMeta(content.substring(0, 100))
          });
          if (onDocumentBlocked) {
            onDocumentBlocked(content.substring(0, 200), result);
          }

          if (onBlockedDocument === 'abort') {
            throw new Error(productionMode ? 'Document blocked' : `Document blocked: ${safeReason}`);
          }
        }
      }

      return valid;
    }
  };
}

/**
 * Re-exports types for convenience.
 */
export type { GuardedLlamaIndexOptions, GuardedQueryResult } from './types.js';
