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
 * - Validation timeout with AbortController
 *
 * @package @blackunicorn/bonklm-llamaindex
 */

import { createLogger, createResult, GuardrailEngine, type GuardrailResult, type Logger, Severity, validateWithTimeoutSecure } from '@blackunicorn/bonklm';
import type {
  GuardedLlamaIndexOptions,
  GuardedQueryResult,
} from './types.js';
import {
  DEFAULT_MAX_RETRIEVED_DOCS,
  DEFAULT_VALIDATION_TIMEOUT,
} from './types.js';

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
export function createGuardedQueryEngine(
  queryEngine: any,
  options: GuardedLlamaIndexOptions = {}
): GuardedQueryEngine {
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
    onResponseBlocked,
  } = options;

  const engine = new GuardrailEngine({
    validators,
    guards,
    logger,
  });

  /**
   * Validation timeout wrapper with AbortController.
   *
   * @internal
   */
  const validateWithTimeout = async (
    content: string,
    context?: string
  ): Promise<GuardrailResult> => {
    const result = await validateWithTimeoutSecure<GuardrailResult>({
      operation: () => engine.validate(content, context) as Promise<GuardrailResult>,
      timeoutMs: validationTimeout,
      timeoutSentinel: () =>
        createResult(false, Severity.CRITICAL, [
          {
            category: 'timeout',
            description: 'Validation timeout',
            severity: Severity.CRITICAL,
            weight: 30,
          },
        ]),
      logger,
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
      logger.warn('[Guardrails] Query blocked', { reason: result.reason });
      if (onQueryBlocked) onQueryBlocked(result);

      if (productionMode) {
        throw new Error('Query blocked');
      }
      throw new Error(`Query blocked: ${result.reason}`);
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
        logger.warn('[Guardrails] Document blocked', {
          reason: result.reason,
          documentPreview: content.substring(0, 100),
        });
        if (onDocumentBlocked) {
          onDocumentBlocked(content.substring(0, 200), result);
        }

        if (onBlockedDocument === 'abort') {
          throw new Error(productionMode ? 'Retrieved document blocked' : `Document blocked: ${result.reason}`);
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
        similarityTopK: Math.min(options.similarityTopK || maxRetrievedDocs, maxRetrievedDocs),
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
        logger.warn('[Guardrails] Response blocked', { reason: responseResult.reason });
        if (onResponseBlocked) onResponseBlocked(responseResult);

        return {
          response: '[Content filtered by guardrails]',
          filtered: true,
          documentsBlocked: blocked,
          raw: result,
        };
      }

      return {
        response: responseText,
        sourceNodes: validNodes,
        filtered: false,
        documentsBlocked: blocked,
        raw: result,
      };
    },
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
    onDocumentBlocked,
  } = options;

  const engine = new GuardrailEngine({
    validators,
    guards,
    logger,
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
            weight: 30,
          },
        ]),
      logger,
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
        logger.warn('[Guardrails] Retrieval query blocked', { reason: queryResult.reason });
        if (onQueryBlocked) onQueryBlocked(queryResult);

        if (productionMode) {
          throw new Error('Query blocked');
        }
        throw new Error(`Query blocked: ${queryResult.reason}`);
      }

      // Apply retrieval limit
      const retrieveOptions = {
        ...options,
        similarityTopK: Math.min(options.similarityTopK || maxRetrievedDocs, maxRetrievedDocs),
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
          logger.warn('[Guardrails] Retrieved document blocked', {
            reason: result.reason,
            documentPreview: content.substring(0, 100),
          });
          if (onDocumentBlocked) {
            onDocumentBlocked(content.substring(0, 200), result);
          }

          if (onBlockedDocument === 'abort') {
            throw new Error(productionMode ? 'Document blocked' : `Document blocked: ${result.reason}`);
          }
        }
      }

      return valid;
    },
  };
}

/**
 * Re-exports types for convenience.
 */
export type {
  GuardedLlamaIndexOptions,
  GuardedQueryResult,
} from './types.js';
