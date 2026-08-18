/**
 * ChromaDB Guarded Wrapper
 * ========================
 *
 * Provides security guardrails for ChromaDB vector database operations.
 *
 * Security Features:
 * - Query injection validation before retrieval
 * - Retrieved document poisoning detection
 * - Metadata filter sanitization
 * - Production mode error messages
 * - Validation timeout via validateWithTimeoutSecure
 *
 * @package @blackunicorn/bonklm-chroma
 */

import {
  ConnectorValidationError,
  createLogger,
  createResult,
  GuardrailEngine,
  type GuardrailResult,
  type Logger,
  sanitizeMeta,
  Severity,
  validateWithTimeoutSecure
} from '@blackunicorn/bonklm';
import type { ChromaQueryOptions, GuardedChromaOptions, GuardedChromaQueryResult } from './types.js';
import { DEFAULT_MAX_N_RESULTS, DEFAULT_VALIDATION_TIMEOUT } from './types.js';
import { DEFAULT_QUERY_LIMIT, normalizeLimit } from '@blackunicorn/bonklm/core/connector-utils';

/**
 * Default logger instance.
 *
 * @internal
 */
const DEFAULT_LOGGER: Logger = createLogger('console');

/**
 * Represents a wrapped ChromaDB collection with guardrails.
 */
export interface GuardedChromaCollection {
  query(options: ChromaQueryOptions): Promise<GuardedChromaQueryResult>;
  add(options: any): Promise<void>;
  delete(options: any): Promise<void>;
}

/**
 * Creates a guarded ChromaDB collection wrapper for vector operations.
 *
 * @param chromaCollection - The ChromaDB collection to wrap
 * @param options - Configuration options for the guarded wrapper
 * @returns A guarded collection with validation
 *
 * @example
 * ```ts
 * import { ChromaClient } from 'chromadb';
 * import { createGuardedCollection } from '@blackunicorn/bonklm-chroma';
 * import { PromptInjectionValidator, PIIGuard } from '@blackunicorn/bonklm';
 *
 * const client = new ChromaClient();
 * const collection = await client.getOrCreateCollection({ name: 'my_collection' });
 *
 * const guardedCollection = createGuardedCollection(collection, {
 *   validators: [new PromptInjectionValidator()],
 *   guards: [new PIIGuard()],
 *   validateRetrievedDocs: true,
 *   sanitizeFilters: true
 * });
 *
 * const results = await guardedCollection.query({
 *   queryTexts: ['Tell me about X'],
 *   nResults: 5
 * });
 * ```
 */
export function createGuardedCollection(
  chromaCollection: any,
  options: GuardedChromaOptions = {}
): GuardedChromaCollection {
  const {
    validators = [],
    guards = [],
    logger = DEFAULT_LOGGER,
    validateRetrievedDocs = true,
    onBlockedDocument,
    productionMode = process.env.NODE_ENV === 'production',
    validationTimeout = DEFAULT_VALIDATION_TIMEOUT,
    maxNResults = DEFAULT_MAX_N_RESULTS,
    sanitizeFilters = true,
    onQueryBlocked,
    onDocumentBlocked,
    retrievedDocValidator // opt-in batch validator
  } = options;

  // Default onBlockedDocument to 'filter' if not provided (fixes issue where function parameter was overridden)
  const blockedDocumentHandling = onBlockedDocument ?? 'filter';

  const engine = new GuardrailEngine({
    validators,
    guards,
    logger
  });

  /**
   * Validation timeout wrapper.
   *
   * fix: replaced broken AbortController pattern (signal
   * never propagated to engine.validate) with the canonical shared
   * `validateWithTimeoutSecure` primitive from core/connector-utils.
   * See `core/src/connector-utils/timeout-wrapper.ts` for the regression
   * contract.
   *
   * @internal
   */
  const validateWithTimeout = async (content: string, context?: string): Promise<GuardrailResult> => {
    const result = await validateWithTimeoutSecure({
      operation: () => engine.validate(content, context),
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
    // engine.validate may return an EngineResult union; chroma callers
    // expect a single GuardrailResult. If the result contains multiple
    // sub-results, surface the first blocked one (or the first one if
    // none are blocked).
    if ('results' in result && Array.isArray((result as { results?: unknown[] }).results)) {
      const arr = (result as { results: GuardrailResult[] }).results;
      const blocked = arr.find(r => r.blocked);
      return blocked ?? arr[0] ?? result;
    }
    return result;
  };

  /**
   * Sanitizes metadata filter expressions to prevent injection.
   * S012-007: Uses recursive traversal to catch dangerous patterns at any depth.
   * Added case-insensitive regex pattern matching and array operator validation.
   *
   * @internal
   */
  const sanitizeFilter = (filter: any): any => {
    if (!sanitizeFilters || !filter) {
      return filter;
    }

    // Convert to string for initial validation (catches Unicode escapes)
    const filterStr = JSON.stringify(filter);

    // S012-007: Check for dangerous patterns including case-insensitive variants
    const dangerousPatterns = [
      /\$\.\./, // Path traversal
      /\beval\b/i, // eval usage
      /\bconstructor\b/i, // Constructor access
      /\b__proto__\b/i, // Prototype pollution
      /\$where/i, // MongoDB-style injection
      /\\u0024/i, // Unicode escape for $ (\u0024where)
      /\\u005f/i, // Unicode escape for _ (__proto__ variants)
      // S012-007: Case-insensitive regex operators
      /\$regex\b/i, // Now case-insensitive
      /\$RegEx\b/i,
      /\$REGEX\b/i,
      /\$ne\b/i // Not equal operator
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(filterStr)) {
        logger.warn('[Guardrails] Dangerous filter pattern detected');
        throw new ConnectorValidationError(
          productionMode ? 'Filter contains dangerous patterns' : 'Filter contains dangerous patterns',
          'dangerous_pattern'
        );
      }
    }

    // S012-007: Deep validation for nested objects
    const deepValidate = (obj: any, depth = 0): void => {
      if (depth > 10) {
        throw new ConnectorValidationError(
          productionMode ? 'Invalid filter' : 'Filter depth exceeded maximum',
          'depth_exceeded'
        );
      }

      if (obj && typeof obj === 'object') {
        for (const key of Object.keys(obj)) {
          // S012-007: Expanded dangerous keys list including array operators
          const dangerousKeys = [
            'constructor',
            '__proto__',
            'prototype',
            'parent',
            'where',
            // S012-007: Added ChromaDB array operators that could be abused
            '$in',
            '$nin',
            '$all',
            '$elemMatch',
            '$size',
            '$exists',
            '$type'
          ];

          // Check exact matches first
          if (dangerousKeys.includes(key)) {
            // CWE-117 (defense-in-depth / consistency only): `key` is provably
            // one of the fixed `dangerousKeys` constants here — the
            // `includes()` guard above admits nothing else — so it cannot carry
            // control characters today. The `sanitizeMeta` wraps keep this
            // boundary uniform with the connector's genuinely attacker-influenced
            // log/throw sinks (validator `reason`, document `id`), so a future
            // widening of the key source can never regress into a raw-
            // interpolation gap. Intentionally NOT mutation-tested: the reachable
            // input set is control-char-free by construction, so removing these
            // wraps would not change observable output (see cwe117-regression.test.ts).
            logger.warn('[Guardrails] Dangerous filter key detected', { key: sanitizeMeta(key) });
            throw new ConnectorValidationError(
              productionMode ? 'Invalid filter' : `Filter contains dangerous key: ${sanitizeMeta(key)}`,
              'dangerous_key'
            );
          }

          // Recurse into nested objects
          if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
            deepValidate(obj[key], depth + 1);
          }
        }
      }
    };

    try {
      deepValidate(filter);
    } catch (e) {
      if (e instanceof ConnectorValidationError) {
        throw e;
      }
      throw new ConnectorValidationError(
        productionMode ? 'Invalid filter' : 'Filter validation failed',
        'validation_failed'
      );
    }

    return filter;
  };

  /**
   * Validates a query string or embedding.
   *
   * @internal
   */
  const validateQuery = async (options: ChromaQueryOptions): Promise<void> => {
    // Validate query text if provided
    if (options.queryTexts && options.queryTexts.length > 0) {
      const queryText = options.queryTexts.join(' ');
      const result = await validateWithTimeout(queryText, 'chroma_query');

      if (!result.allowed) {
        // Sprint 43 cross-connector CWE-117 sweep (architect CRITICAL
        // #2 closure): chroma was a peer of weaviate/pinecone but
        // initial scoping missed it. Same pattern: sanitize at log +
        // dev-mode throw boundaries.
        const safeReason = sanitizeMeta(result.reason);
        logger.warn('[Guardrails] Query blocked', { reason: safeReason });
        if (onQueryBlocked) onQueryBlocked(result);

        if (productionMode) {
          throw new Error('Query blocked');
        }
        throw new Error(`Query blocked: ${safeReason}`);
      }
    }

    // Validate filters
    if (options.where) {
      sanitizeFilter(options.where);
    }
    if (options.whereDocument) {
      sanitizeFilter(options.whereDocument);
    }
  };

  /**
   * S012-007: Validates a complex document structure recursively.
   * Checks for NoSQL injection patterns in nested objects.
   * S012-007: Added circular reference detection and depth-based size limits.
   *
   * @internal
   */
  const validateDocumentStructure = (doc: any, depth = 0, seen = new WeakSet()): void => {
    // S012-007: Circular reference detection
    if (typeof doc === 'object' && doc !== null) {
      if (seen.has(doc)) {
        throw new ConnectorValidationError(
          productionMode ? 'Invalid document' : 'Document contains circular reference',
          'circular_reference'
        );
      }
      seen.add(doc);
    }

    // Code review fix: Reduced depth limit from 20 to 10 for better security
    if (depth > 10) {
      throw new ConnectorValidationError(
        productionMode ? 'Invalid document' : 'Document structure exceeds maximum depth',
        'depth_exceeded'
      );
    }

    if (doc === null || doc === undefined) {
      return;
    }

    if (typeof doc === 'string') {
      // S012-007: Depth-based string length limit
      // Deeper nesting = shorter strings allowed to prevent DoS
      const maxStringLength = Math.max(1000, 100000 - depth * 10000);
      if (doc.length > maxStringLength) {
        throw new ConnectorValidationError(
          productionMode
            ? 'Invalid document'
            : `Document field exceeds maximum length of ${maxStringLength} characters at depth ${depth}`,
          'field_too_long'
        );
      }
      return;
    }

    if (typeof doc === 'number') {
      if (!Number.isFinite(doc)) {
        throw new ConnectorValidationError(
          productionMode ? 'Invalid document' : 'Document contains non-finite number',
          'invalid_number'
        );
      }
      return;
    }

    if (Array.isArray(doc)) {
      // S012-007: Depth-based array length limit
      // Deeper nesting = smaller arrays allowed
      const maxArrayLength = Math.max(10, 10000 - depth * 1000);
      if (doc.length > maxArrayLength) {
        throw new ConnectorValidationError(
          productionMode
            ? 'Invalid document'
            : `Document array exceeds maximum length of ${maxArrayLength} at depth ${depth}`,
          'array_too_large'
        );
      }
      for (const item of doc) {
        validateDocumentStructure(item, depth + 1, seen);
      }
      return;
    }

    if (typeof doc === 'object') {
      // S012-007: Depth-based object key limit
      const maxKeys = Math.max(10, 1000 - depth * 100);
      const keys = Object.keys(doc);
      if (keys.length > maxKeys) {
        throw new ConnectorValidationError(
          productionMode
            ? 'Invalid document'
            : `Document object exceeds maximum key count of ${maxKeys} at depth ${depth}`,
          'object_too_large'
        );
      }

      // Check for prototype pollution
      const dangerousKeys = ['__proto__', 'constructor', 'prototype', 'parent'];
      for (const key of keys) {
        if (dangerousKeys.includes(key)) {
          throw new ConnectorValidationError(
            productionMode ? 'Invalid document' : 'Document contains dangerous key',
            'dangerous_key'
          );
        }
        validateDocumentStructure(doc[key], depth + 1, seen);
      }
    }
  };

  /**
   * Validates retrieved documents.
   * S012-007: Added comprehensive document validation including embeddings and arrays.
   *
   * @internal
   */
  const validateDocuments = async (
    documents: string[][],
    metadatas: Record<string, any>[][],
    ids: string[][]
  ): Promise<{
    validDocuments: string[][];
    validMetadatas: Record<string, any>[][];
    validIds: string[][];
    blocked: number;
    validIndices: number[][];
  }> => {
    if (!validateRetrievedDocs) {
      // Return all indices as valid when validation is disabled
      const validIndices = documents.map(docArray => docArray.map((_, idx) => idx));
      return { validDocuments: documents, validMetadatas: metadatas, validIds: ids, blocked: 0, validIndices };
    }

    // batch validator path. Iterate per-query batch (Chroma
    // returns 2D arrays), feed each batch through validateBatch, and
    // re-shape the surviving docs back into the 2D structure. Doc
    // content uses the optionally-redacted `docs[i].content` returned by
    // the validator so redact mode propagates to the caller.
    if (retrievedDocValidator) {
      const outDocs: string[][] = [];
      const outMeta: Record<string, any>[][] = [];
      const outIds: string[][] = [];
      const outIndices: number[][] = [];
      let blocked = 0;
      for (let q = 0; q < documents.length; q++) {
        // Audit-loop fix: position-stable synthetic ids (per-batch).
        // Defeats attacker-controlled content from spoofing another
        // doc's id within the same batch.
        const queryDocs = documents[q].map((content, j) => ({
          id: `__pos_${j}`,
          content: content ?? '',
          metadata: metadatas[q]?.[j]
        }));
        const batch = await retrievedDocValidator.validateBatch(queryDocs);
        if (batch.result.blocked) {
          throw new ConnectorValidationError(
            // CWE-117: `batch.result.reason` can carry attacker-influenced
            // content from a flagged doc; sanitize before it reaches a throw
            // boundary a caller may log. (Chroma's 2D batch path is inline and
            // does not route through the shared helper's hardened throw.)
            productionMode ? 'Document batch blocked' : `Document batch blocked: ${sanitizeMeta(batch.result.reason)}`,
            'validation_failed'
          );
        }
        const survivorContentByPos = new Map(batch.docs.map(d => [d.id, d.content]));
        const qDocs: string[] = [];
        const qMeta: Record<string, any>[] = [];
        const qIds: string[] = [];
        const qIdx: number[] = [];
        for (let j = 0; j < queryDocs.length; j++) {
          const posKey = `__pos_${j}`;
          if (!survivorContentByPos.has(posKey)) continue;
          qDocs.push(survivorContentByPos.get(posKey) ?? '');
          qMeta.push(metadatas[q]?.[j] ?? {});
          qIds.push(ids[q]?.[j] ?? '');
          qIdx.push(j);
        }
        blocked += batch.filteredCount;
        outDocs.push(qDocs);
        outMeta.push(qMeta);
        outIds.push(qIds);
        outIndices.push(qIdx);
      }
      return { validDocuments: outDocs, validMetadatas: outMeta, validIds: outIds, blocked, validIndices: outIndices };
    }

    const validDocuments: string[][] = [];
    const validMetadatas: Record<string, any>[][] = [];
    const validIds: string[][] = [];
    const validIndices: number[][] = [];
    let blocked = 0;

    // Process each query result set
    for (let i = 0; i < documents.length; i++) {
      const queryDocuments: string[] = [];
      const queryMetadatas: Record<string, any>[] = [];
      const queryIds: string[] = [];
      const queryValidIndices: number[] = [];

      for (let j = 0; j < documents[i].length; j++) {
        const doc = documents[i][j];
        const metadata = metadatas[i]?.[j];
        const id = ids[i]?.[j];

        try {
          // S012-007: Validate document structure for NoSQL injection
          validateDocumentStructure(doc);
          if (metadata) {
            validateDocumentStructure(metadata);
          }
        } catch (e) {
          if (e instanceof ConnectorValidationError) {
            blocked++;
            logger.warn('[Guardrails] Document structure validation failed', {
              // CWE-117: doc id is retrieved/attacker-influenced; escape before logging.
              id: sanitizeMeta(id),
              reason: sanitizeMeta(e.message)
            });
            if (onDocumentBlocked) {
              onDocumentBlocked(doc?.substring(0, 200) || '', e as any);
            }

            if (blockedDocumentHandling === 'abort') {
              throw e;
            }
            continue;
          }
          throw e;
        }

        // Build content to validate (document + metadata + id)
        let contentToValidate = doc || '';
        if (metadata) {
          contentToValidate += ` ${JSON.stringify(metadata)}`;
        }
        if (id) {
          contentToValidate += ` ${id}`;
        }

        const result = await validateWithTimeout(contentToValidate, 'chroma_document');

        if (result.allowed) {
          queryDocuments.push(doc);
          if (metadata) queryMetadatas.push(metadata);
          if (id) queryIds.push(id);
          queryValidIndices.push(j);
        } else {
          blocked++;
          // CWE-117: doc id + validator reason are retrieved/attacker-influenced;
          // escape before they reach the log meta or the thrown error message.
          const safeReason = sanitizeMeta(result.reason);
          logger.warn('[Guardrails] Document blocked', {
            id: sanitizeMeta(id),
            reason: safeReason
          });
          if (onDocumentBlocked) {
            onDocumentBlocked(doc.substring(0, 200), result);
          }

          if (blockedDocumentHandling === 'abort') {
            throw new ConnectorValidationError(
              productionMode ? 'Document blocked' : `Document blocked: ${safeReason}`,
              'validation_failed'
            );
          }
        }
      }

      validDocuments.push(queryDocuments);
      validMetadatas.push(queryMetadatas);
      validIds.push(queryIds);
      validIndices.push(queryValidIndices);
    }

    return { validDocuments, validMetadatas, validIds, blocked, validIndices };
  };

  return {
    /**
     * Executes a query with full guardrails validation.
     *
     * @param options - Query options including queryTexts, nResults, filters
     * @returns Query results with validation metadata
     */
    async query(options: ChromaQueryOptions): Promise<GuardedChromaQueryResult> {
      // Step 1: Validate the query
      await validateQuery(options);

      // Step 2: Apply limits and sanitization
      const sanitizedOptions = {
        ...options,
        // Vector-DB family parity: clamp to [1, maxNResults] via the shared
        // normalizeLimit (chroma previously threw on a negative nResults and
        // defaulted 0 -> 10; it now clamps 0/negative -> 1 like the other
        // vector-DB connectors). Non-finite still falls back to DEFAULT_QUERY_LIMIT.
        nResults: normalizeLimit(options.nResults, { max: maxNResults, fallback: DEFAULT_QUERY_LIMIT }),
        where: sanitizeFilter(options.where),
        whereDocument: sanitizeFilter(options.whereDocument)
      };

      // Step 3: Execute the query
      const rawResult = await chromaCollection.query(sanitizedOptions);

      // Step 4: Validate retrieved documents
      const documents = rawResult.documents || [[]];
      const metadatas = rawResult.metadatas || [[]];
      const ids = rawResult.ids || [[]];

      const { validDocuments, validMetadatas, validIds, blocked, validIndices } = await validateDocuments(
        documents,
        metadatas,
        ids
      );

      // Build filtered result
      const result: GuardedChromaQueryResult = {
        documents: validDocuments,
        metadatas: validMetadatas.length > 0 ? validMetadatas : undefined,
        ids: validIds,
        documentsBlocked: blocked,
        filtered: blocked > 0,
        raw: rawResult
      };

      // Add optional fields if they were in original result
      if (rawResult.embeddings) {
        result.embeddings = rawResult.embeddings;
      }
      if (rawResult.distances) {
        // Filter distances using valid indices for accurate mapping
        result.distances = rawResult.distances.map((distArray: number[], idx: number) => {
          const indices = validIndices[idx] || [];
          if (indices.length < distArray.length) {
            // Filter distances to only include valid document indices
            return indices.map(i => distArray[i]);
          }
          return distArray;
        });
      }

      return result;
    },

    /**
     * Adds documents to the collection with optional validation.
     *
     * @param options - Add options including documents, embeddings, metadatas
     */
    async add(options: any): Promise<void> {
      // Validate documents being added if present
      if (options.documents && Array.isArray(options.documents)) {
        for (const doc of options.documents) {
          const result = await validateWithTimeout(String(doc), 'chroma_add');
          if (!result.allowed) {
            // CWE-117 sweep: sister to query-blocked above.
            const safeReason = sanitizeMeta(result.reason);
            logger.warn('[Guardrails] Document add blocked', { reason: safeReason });
            throw new Error(productionMode ? 'Document blocked' : `Document blocked: ${safeReason}`);
          }
        }
      }

      // Validate metadatas if present
      if (options.metadatas && Array.isArray(options.metadatas)) {
        for (const metadata of options.metadatas) {
          sanitizeFilter(metadata);
        }
      }

      return chromaCollection.add(options);
    },

    /**
     * Deletes documents from the collection.
     *
     * @param options - Delete options
     */
    async delete(options: any): Promise<void> {
      // Sanitize filters in delete operations (create copy to avoid mutating caller's object)
      const sanitizedOptions = { ...options };
      if (sanitizedOptions.where) {
        sanitizedOptions.where = sanitizeFilter(sanitizedOptions.where);
      }
      if (sanitizedOptions.whereDocument) {
        sanitizedOptions.whereDocument = sanitizeFilter(sanitizedOptions.whereDocument);
      }

      return chromaCollection.delete(sanitizedOptions);
    }
  };
}

/**
 * Re-exports types for convenience.
 */
export type {
  GuardedChromaOptions,
  GuardedChromaQueryResult,
  ChromaQueryOptions,
  BlockedDocumentHandling
} from './types.js';
