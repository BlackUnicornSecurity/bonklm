/**
 * Pinecone Guarded Wrapper
 * ========================
 *
 * Provides security guardrails for Pinecone vector database operations.
 *
 * Security Features:
 * - Query injection validation
 * - Retrieved vector poisoning detection
 * - Metadata filter sanitization
 * - Production mode error messages
 * - Validation timeout via validateWithTimeoutSecure (Sprint 30)
 *
 * @package @blackunicorn/bonklm-pinecone
 */

import {
  createLogger,
  type EngineResult,
  GuardrailEngine,
  type Logger,
  RiskLevel,
  sanitizeMeta,
  Severity,
  validateWithTimeoutSecure
} from '@blackunicorn/bonklm';
import {
  applyRetrievedDocValidatorToMatches,
  ConnectorValidationError,
  logValidationFailure,
  normalizeLimit
} from '@blackunicorn/bonklm/core/connector-utils';
import type { GuardedPineconeOptions, GuardedQueryResult, VectorQueryOptions } from './types.js';
import { DEFAULT_MAX_TOP_K, DEFAULT_VALIDATION_TIMEOUT } from './types.js';

/**
 * Default logger instance.
 *
 * @internal
 */
const DEFAULT_LOGGER: Logger = createLogger('console');

/**
 * Represents a wrapped Pinecone Index with guardrails.
 */
export interface GuardedPineconeIndex {
  query(options: VectorQueryOptions): Promise<GuardedQueryResult>;
}

/**
 * Creates a guarded Pinecone Index wrapper for vector operations.
 *
 * @param pineconeIndex - The Pinecone Index to wrap
 * @param options - Configuration options for the guarded wrapper
 * @returns A guarded index with validation
 *
 * @example
 * ```ts
 * import { Pinecone } from '@pinecone-database/pinecone';
 * import { createGuardedIndex } from '@blackunicorn/bonklm-pinecone';
 * import { PromptInjectionValidator } from '@blackunicorn/bonklm';
 *
 * const pinecone = new Pinecone({ apiKey: '...' });
 * const index = pinecone.index('my-index');
 *
 * const guardedIndex = createGuardedIndex(index, {
 *   validators: [new PromptInjectionValidator()],
 *   validateRetrievedVectors: true,
 *   sanitizeMetadataFilters: true
 * });
 *
 * const results = await guardedIndex.query({
 *   vector: embedding,
 *   topK: 10
 * });
 * ```
 */
export function createGuardedIndex(pineconeIndex: any, options: GuardedPineconeOptions = {}): GuardedPineconeIndex {
  const {
    validators = [],
    guards = [],
    logger = DEFAULT_LOGGER,
    validateRetrievedVectors = true,
    onBlockedVector = 'filter',
    productionMode = process.env.NODE_ENV === 'production',
    validationTimeout = DEFAULT_VALIDATION_TIMEOUT,
    maxTopK = DEFAULT_MAX_TOP_K,
    sanitizeMetadataFilters = true,
    onQueryBlocked,
    onVectorBlocked,
    retrievedDocValidator // Story 1.2 opt-in batch validator
  } = options;

  const engine = new GuardrailEngine({
    validators,
    guards,
    logger
  });

  /**
   * S012-002: Validation timeout wrapper (Sprint 30: routes through canonical validateWithTimeoutSecure primitive).
   * Handles EngineResult properly by checking allowed property.
   *
   * @internal
   */
  const validateWithTimeout = async (content: string, context?: string): Promise<EngineResult> => {
    const result = await validateWithTimeoutSecure<EngineResult>({
      operation: () => engine.validate(content, context),
      timeoutMs: validationTimeout,
      timeoutSentinel: () => ({
        allowed: false,
        blocked: true,
        severity: Severity.CRITICAL,
        risk_level: RiskLevel.HIGH,
        risk_score: 30,
        reason: 'Validation timeout',
        findings: [
          {
            category: 'timeout',
            severity: Severity.CRITICAL,
            description: 'Validation timeout',
            weight: 30
          }
        ],
        results: [],
        validatorCount: validators.length,
        guardCount: guards.length,
        executionTime: validationTimeout,
        timestamp: Date.now()
      }),
      logger
    });
    return result;
  };

  /**
   * Sanitizes metadata filter expressions to prevent injection.
   *
   * @internal
   */
  const sanitizeFilter = (filter: any): any => {
    if (!sanitizeMetadataFilters || !filter) {
      return filter;
    }

    // Convert to string for validation
    const filterStr = JSON.stringify(filter);

    // Check for dangerous patterns
    const dangerousPatterns = [
      /\$\.\./, // Path traversal
      /\beval\b/i, // eval usage
      /\bconstructor\b/i, // Constructor access
      /\b__proto__\b/i // Prototype pollution
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(filterStr)) {
        logger.warn('[Guardrails] Dangerous filter pattern detected');
        throw new ConnectorValidationError(
          productionMode ? 'Invalid filter' : 'Filter contains dangerous patterns',
          'dangerous_pattern'
        );
      }
    }

    return filter;
  };

  /**
   * Validates a vector query.
   *
   * @internal
   */
  const validateQuery = async (options: VectorQueryOptions, topK: number): Promise<void> => {
    // Validate vector format
    if (!options.vector || !Array.isArray(options.vector)) {
      throw new ConnectorValidationError('Vector must be an array of numbers', 'invalid_format');
    }

    // Validate dimension bounds to prevent DoS
    if (options.vector.length === 0 || options.vector.length > 100000) {
      throw new ConnectorValidationError('Vector dimension must be between 1 and 100000', 'invalid_format');
    }

    // Validate all values are finite (excludes NaN and Infinity)
    if (options.vector.some(v => typeof v !== 'number' || !Number.isFinite(v))) {
      throw new ConnectorValidationError('Vector must contain only finite numbers', 'invalid_format');
    }

    // Create query context for validation. `topK` is the already-normalized
    // value that will be sent to the client (see `query`), so the scanned
    // context matches the outgoing request and limit clamping is unified
    // across the qdrant/weaviate connectors via the shared normalizeLimit.
    const queryContext = JSON.stringify({
      topK,
      namespace: options.namespace,
      hasFilter: !!options.filter
    });

    const result = await validateWithTimeout(queryContext, 'pinecone_query');

    if (!result.allowed) {
      // S012-002: Use connector-utils validation failure logging
      logValidationFailure(logger, result.reason || 'Query blocked', { context: 'pinecone_query' });
      if (onQueryBlocked) onQueryBlocked(result);

      // Sprint 43 CWE-117 sweep: sanitize `result.reason` at the
      // dev-mode throw boundary (caller may log error.message).
      throw new ConnectorValidationError(
        productionMode ? 'Query blocked' : `Query blocked: ${sanitizeMeta(result.reason)}`,
        'validation_failed'
      );
    }
  };

  /**
   * Validates retrieved vectors.
   *
   * @internal
   */
  const validateVectors = async (matches: any[]): Promise<{ valid: any[]; blocked: number }> => {
    if (!validateRetrievedVectors) {
      return { valid: matches, blocked: 0 };
    }

    // Story 1.2 — batch validator path. When set, replaces per-vector loop.
    // Cumulative-audit extraction: position-stable synthetic-id pattern
    // now lives in `applyRetrievedDocValidatorToMatches`. The defence
    // against attacker-influenced metadata spoofing another match's
    // synthetic id is preserved by the helper.
    if (retrievedDocValidator) {
      return applyRetrievedDocValidatorToMatches(
        matches as Array<{ id?: string; metadata?: unknown }>,
        retrievedDocValidator,
        m => ({
          content: [m.metadata ? JSON.stringify(m.metadata) : '', m.id ?? ''].filter(Boolean).join(' '),
          metadata: m.metadata as Record<string, unknown> | undefined
        }),
        { productionMode, itemNoun: 'Vector' }
      );
    }

    const valid: any[] = [];
    let blocked = 0;

    for (const match of matches) {
      // Validate metadata content
      let contentToValidate = '';

      if (match.metadata) {
        contentToValidate = JSON.stringify(match.metadata);
      }

      if (match.id) {
        contentToValidate += ` ${match.id}`;
      }

      if (!contentToValidate) {
        // No content to validate, allow it
        valid.push(match);
        continue;
      }

      const result = await validateWithTimeout(contentToValidate, 'pinecone_vector');

      if (result.allowed) {
        valid.push(match);
      } else {
        blocked++;
        // S012-002: Use connector-utils validation failure logging
        logValidationFailure(logger, result.reason || 'Vector blocked', { id: match.id });
        if (onVectorBlocked && match.id) {
          onVectorBlocked(match.id, result);
        }

        if (onBlockedVector === 'abort') {
          // Sprint 43 CWE-117 sweep: sanitize `result.reason` at the
          // dev-mode throw boundary (sister to query-blocked at line ~221).
          throw new ConnectorValidationError(
            productionMode ? 'Vector blocked' : `Vector blocked: ${sanitizeMeta(result.reason)}`,
            'validation_failed'
          );
        }
      }
    }

    return { valid, blocked };
  };

  return {
    /**
     * Executes a vector query with guardrails validation.
     *
     * @param options - Query options including vector and topK
     * @returns Query results with validation metadata
     */
    async query(options: VectorQueryOptions): Promise<GuardedQueryResult> {
      // Normalize the limit once (shared vector-DB family clamp) so the
      // validation context scans the same value that is sent to the client.
      const topK = normalizeLimit(options.topK, { max: maxTopK, fallback: 10 });

      // Step 1: Validate the query
      await validateQuery(options, topK);

      // Step 2: Sanitize filters. `namespace` is NOT a member of the SDK's
      // query body (it is targeted via `index.namespace(ns)` below), so it
      // is separated out here.
      const { namespace, ...queryOptions } = options;
      const sanitizedOptions = {
        ...queryOptions,
        topK,
        filter: sanitizeFilter(options.filter)
      };

      // Step 3: Execute the query. Route namespace targeting through the
      // SDK's `namespace()` method — passing `namespace` inside the query
      // body is silently ignored and queries the DEFAULT namespace.
      const target = namespace ? pineconeIndex.namespace(namespace) : pineconeIndex;
      const result = await target.query(sanitizedOptions);

      // `QueryResponse` carries only `matches`; the `vectors` fallback was
      // dead (that field exists on Fetch/List/Upsert responses only).
      const matches = result.matches || [];

      // Step 4: Validate retrieved vectors
      const { valid: validMatches, blocked } = await validateVectors(matches);

      return {
        matches: validMatches,
        vectorsBlocked: blocked,
        filtered: blocked > 0,
        raw: result
      };
    }
  };
}

/**
 * Re-exports types for convenience.
 */
export type { GuardedPineconeOptions, GuardedQueryResult, VectorQueryOptions } from './types.js';
