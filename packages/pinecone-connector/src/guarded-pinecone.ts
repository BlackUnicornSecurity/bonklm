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
 * - Validation timeout with AbortController
 *
 * @package @blackunicorn/bonklm-pinecone
 */

import {
  createLogger,
  type EngineResult,
  GuardrailEngine,
  type Logger,
  RiskLevel,
  Severity,
} from '@blackunicorn/bonklm';
import {
  applyRetrievedDocValidatorToMatches,
  ConnectorValidationError,
  logTimeout,
  logValidationFailure,
} from '@blackunicorn/bonklm/core/connector-utils';
import type {
  GuardedPineconeOptions,
  GuardedQueryResult,
  VectorQueryOptions,
} from './types.js';
import {
  DEFAULT_MAX_TOP_K,
  DEFAULT_VALIDATION_TIMEOUT,
} from './types.js';

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
export function createGuardedIndex(
  pineconeIndex: any,
  options: GuardedPineconeOptions = {}
): GuardedPineconeIndex {
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
    retrievedDocValidator, // Story 1.2 opt-in batch validator
  } = options;

  const engine = new GuardrailEngine({
    validators,
    guards,
    logger,
  });

  /**
   * S012-002: Validation timeout wrapper with AbortController.
   * Handles EngineResult properly by checking allowed property.
   *
   * @internal
   */
  const validateWithTimeout = async (
    content: string,
    context?: string
  ): Promise<EngineResult> => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), validationTimeout);

    try {
      const result = await engine.validate(content, context);
      clearTimeout(timeoutId);
      return result;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === 'AbortError') {
        // S012-002: Use connector-utils timeout logging
        logTimeout(logger, 'Pinecone validation', validationTimeout);
        return {
          allowed: false,
          blocked: true,
          severity: Severity.CRITICAL,
          risk_level: RiskLevel.HIGH,
          risk_score: 30,
          reason: 'Validation timeout',
          findings: [{
            category: 'timeout',
            severity: Severity.CRITICAL,
            description: 'Validation timeout',
            weight: 30,
          }],
          results: [],
          validatorCount: validators.length,
          guardCount: guards.length,
          executionTime: validationTimeout,
          timestamp: Date.now(),
        };
      }

      // Re-throw non-timeout errors
      throw error;
    }
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
      /\$\.\./,  // Path traversal
      /\beval\b/i,  // eval usage
      /\bconstructor\b/i,  // Constructor access
      /\b__proto__\b/i,  // Prototype pollution
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(filterStr)) {
        logger.warn('[Guardrails] Dangerous filter pattern detected');
        throw new ConnectorValidationError(
          productionMode ? 'Invalid filter' : 'Filter contains dangerous patterns',
          'dangerous_pattern',
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
  const validateQuery = async (options: VectorQueryOptions): Promise<void> => {
    // Validate vector format
    if (!options.vector || !Array.isArray(options.vector)) {
      throw new ConnectorValidationError('Vector must be an array of numbers', 'invalid_format');
    }

    // Validate dimension bounds to prevent DoS
    if (options.vector.length === 0 || options.vector.length > 100000) {
      throw new ConnectorValidationError('Vector dimension must be between 1 and 100000', 'invalid_format');
    }

    // Validate all values are finite (excludes NaN and Infinity)
    if (options.vector.some((v) => typeof v !== 'number' || !Number.isFinite(v))) {
      throw new ConnectorValidationError('Vector must contain only finite numbers', 'invalid_format');
    }

    // Validate topK
    const topK = Math.min(options.topK || 10, maxTopK);
    if (topK < 1 || topK > maxTopK) {
      throw new ConnectorValidationError(`topK must be between 1 and ${maxTopK}`, 'invalid_range');
    }

    // Create query context for validation
    const queryContext = JSON.stringify({
      topK,
      namespace: options.namespace,
      hasFilter: !!options.filter,
    });

    const result = await validateWithTimeout(queryContext, 'pinecone_query');

    if (!result.allowed) {
      // S012-002: Use connector-utils validation failure logging
      logValidationFailure(logger, result.reason || 'Query blocked', { context: 'pinecone_query' });
      if (onQueryBlocked) onQueryBlocked(result);

      throw new ConnectorValidationError(
        productionMode ? 'Query blocked' : `Query blocked: ${result.reason}`,
        'validation_failed',
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
        (m) => ({
          content: [
            m.metadata ? JSON.stringify(m.metadata) : '',
            m.id ?? '',
          ].filter(Boolean).join(' '),
          metadata: m.metadata as Record<string, unknown> | undefined,
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
          throw new ConnectorValidationError(
            productionMode ? 'Vector blocked' : `Vector blocked: ${result.reason}`,
            'validation_failed',
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
      // Step 1: Validate the query
      await validateQuery(options);

      // Step 2: Sanitize filters
      const sanitizedOptions = {
        ...options,
        topK: Math.min(options.topK || 10, maxTopK),
        filter: sanitizeFilter(options.filter),
      };

      // Step 3: Execute the query
      const result = await pineconeIndex.query(sanitizedOptions);

      const matches = result.matches || result.vectors || [];

      // Step 4: Validate retrieved vectors
      const { valid: validMatches, blocked } = await validateVectors(matches);

      return {
        matches: validMatches,
        vectorsBlocked: blocked,
        filtered: blocked > 0,
        raw: result,
      };
    },
  };
}

/**
 * Re-exports types for convenience.
 */
export type {
  GuardedPineconeOptions,
  GuardedQueryResult,
  VectorQueryOptions,
} from './types.js';
