/**
 * Qdrant Guarded Wrapper
 * ======================
 *
 * Provides security guardrails for Qdrant vector database operations.
 *
 * Security Features:
 * - Vector format validation
 * - Retrieved point poisoning detection
 * - Payload filter sanitization
 * - Payload field access control
 * - Production mode error messages
 * - Validation timeout with AbortController
 *
 * @package @blackunicorn/bonklm-qdrant
 */

import {
  ConnectorValidationError,
  createLogger,
  createResult,
  GuardrailEngine,
  type GuardrailResult,
  type Logger,
  Severity,
} from '@blackunicorn/bonklm';
import { applyRetrievedDocValidatorToMatches } from '@blackunicorn/bonklm/core/connector-utils';
import type {
  GuardedQdrantOptions,
  GuardedQdrantResult,
  QdrantPoint,
  QdrantSearchOptions,
} from './types.js';
import {
  DEFAULT_MAX_FILTER_LENGTH,
  DEFAULT_MAX_LIMIT,
  DEFAULT_MAX_PAYLOAD_SIZE,
  DEFAULT_REGEX_TIMEOUT,
  DEFAULT_VALIDATION_TIMEOUT,
} from './types.js';

/**
 * Default logger instance.
 *
 * @internal
 */
const DEFAULT_LOGGER: Logger = createLogger('console');

/**
 * Represents a wrapped Qdrant client with guardrails.
 */
export interface GuardedQdrantClient {
  search(options: QdrantSearchOptions): Promise<GuardedQdrantResult>;
  upsert(collectionName: string, points: any[]): Promise<void>;
}

/**
 * Creates a guarded Qdrant client wrapper for vector operations.
 *
 * @param qdrantClient - The Qdrant client to wrap
 * @param options - Configuration options for the guarded wrapper
 * @returns A guarded client with validation
 *
 * @example
 * ```ts
 * import { QdrantClient } from '@qdrant/js-client';
 * import { createGuardedClient } from '@blackunicorn/bonklm-qdrant';
 * import { PromptInjectionValidator, PIIGuard } from '@blackunicorn/bonklm';
 *
 * const client = new QdrantClient({ url: 'http://localhost:6333' });
 *
 * const guardedClient = createGuardedClient(client, {
 *   validators: [new PromptInjectionValidator()],
 *   guards: [new PIIGuard()],
 *   validateRetrievedPoints: true,
 *   allowedPayloadFields: ['title', 'content']
 * });
 *
 * const results = await guardedClient.search({
 *   collectionName: 'my_collection',
 *   vector: embedding,
 *   limit: 10
 * });
 * ```
 */
export function createGuardedClient(
  qdrantClient: any,
  options: GuardedQdrantOptions = {}
): GuardedQdrantClient {
  const {
    validators = [],
    guards = [],
    logger = DEFAULT_LOGGER,
    validateRetrievedPoints = true,
    onBlockedPoint = 'filter',
    productionMode = process.env.NODE_ENV === 'production',
    validationTimeout = DEFAULT_VALIDATION_TIMEOUT,
    maxLimit = DEFAULT_MAX_LIMIT,
    validateFilters = true,
    allowedPayloadFields = [],
    onPointBlocked,
    maxFilterLength = DEFAULT_MAX_FILTER_LENGTH,
    maxPayloadSize = DEFAULT_MAX_PAYLOAD_SIZE,
    regexTimeout = DEFAULT_REGEX_TIMEOUT,
    retrievedDocValidator, // Story 1.2 opt-in batch validator
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
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), validationTimeout);

    try {
      const result = await engine.validate(content, context);
      clearTimeout(timeoutId);
      return result;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === 'AbortError') {
        logger.error('[Guardrails] Validation timeout');
        return createResult(false, Severity.CRITICAL, [
          {
            category: 'timeout',
            description: 'Validation timeout',
            severity: Severity.CRITICAL,
            weight: 30,
          },
        ]);
      }

      throw error;
    }
  };

  /**
   * Validates vector format.
   * Includes Infinity and dimension validation.
   *
   * @internal
   */
  const validateVector = (vector: number[]): void => {
    if (!Array.isArray(vector)) {
      throw new Error('Vector must be an array of numbers');
    }

    if (vector.length === 0) {
      throw new Error('Vector cannot be empty');
    }

    if (vector.length > 100000) {
      throw new Error('Vector dimension exceeds maximum allowed');
    }

    // Check for non-finite values (NaN, Infinity, -Infinity)
    const hasInvalidValues = vector.some((v) => typeof v !== 'number' || !Number.isFinite(v));
    if (hasInvalidValues) {
      throw new Error('Vector must contain only finite numbers (no NaN or Infinity)');
    }
  };

  /**
   * Validates and sanitizes filter expressions.
   * Includes deep object traversal and Unicode escape detection.
   *
   * S012-006: Refined to allow legitimate Qdrant operators while blocking dangerous patterns.
   *
   * @internal
   */
  const validateFilter = (filter: any): void => {
    if (!validateFilters || !filter) {
      return;
    }

    const filterStr = JSON.stringify(filter);

    // S012-006: Add filter string length limit to prevent DoS
    if (filterStr.length > maxFilterLength) {
      logger.warn('[Guardrails] Filter exceeds maximum length', {
        length: filterStr.length,
        max: maxFilterLength,
      });
      throw new ConnectorValidationError(
        productionMode ? 'Filter exceeds maximum length' : `Filter exceeds maximum length of ${maxFilterLength} characters`,
        'filter_too_long',
      );
    }

    // S012-006: Check for truly dangerous patterns (not legitimate Qdrant operators)
    // Qdrant uses: must, must_not, filter, key, match, range, geo, etc.
    // The following are ALWAYS dangerous:
    const dangerousPatterns = [
      /\beval\b/i,          // eval keyword
      /\bconstructor\b/i,   // constructor access
      /\b__proto__\b/i,     // prototype pollution
      /\$where/i,          // MongoDB $where (not used in Qdrant)
      /\.\.\./,             // Path traversal
      // Note: $ne and $regex are REMOVED - they can be legitimate in some contexts
      // We handle them differently below
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(filterStr)) {
        logger.warn('[Guardrails] Dangerous filter pattern detected');
        throw new ConnectorValidationError(
          productionMode ? 'Filter contains dangerous patterns' : 'Filter contains dangerous patterns',
          'dangerous_pattern',
        );
      }
    }

    // S012-006: Check for comprehensive Unicode escape patterns
    // Look for any \uXXXX pattern that could be obfuscation
    const unicodeEscapePattern = /\\u[0-9a-f]{4}/gi;
    const unicodeEscapes = filterStr.match(unicodeEscapePattern);
    if (unicodeEscapes) {
      // Check if any decode to dangerous characters
      for (const escape of unicodeEscapes) {
        try {
          // The matched escape is like \u0024 (literal backslash-u-XXXX)
          // We need to convert it to the actual character
          // escape.slice(2) gets 'u0024' from '\u0024', so we need slice(2).slice(1) or just substring approach
          const hexDigits = escape.slice(2); // Gets 'u0024'
          // Validate hexDigits before parsing
          if (!hexDigits || hexDigits.length < 2) {
            throw new ConnectorValidationError(
              productionMode ? 'Invalid filter' : 'Filter contains invalid Unicode escapes',
              'invalid_unicode',
            );
          }
          const hexCode = parseInt(hexDigits.slice(1), 16); // Skip 'u', get '0024'
          // Validate hexCode
          if (isNaN(hexCode)) {
            throw new ConnectorValidationError(
              productionMode ? 'Invalid filter' : 'Filter contains invalid Unicode escapes',
              'invalid_unicode',
            );
          }
          const decoded = String.fromCharCode(hexCode);
          // Check if decoded character is dangerous
          if (['$', '_', 'p', 'P', 'c', 'C'].some((char) => decoded === char)) {
            // Could be obfuscation - reject
            logger.warn('[Guardrails] Suspicious Unicode escape detected', { escape });
            throw new ConnectorValidationError(
              productionMode ? 'Invalid filter' : 'Filter contains suspicious Unicode escapes',
              'unicode_obfuscation',
            );
          }
        } catch (e) {
          if (e instanceof ConnectorValidationError) {
            throw e;
          }
          // Invalid escape, reject
          throw new ConnectorValidationError(
            productionMode ? 'Invalid filter' : 'Filter contains invalid Unicode escapes',
            'invalid_unicode',
          );
        }
      }
    }

    // S012-006: Refined dangerous keys list
    // Removed: 'ne', 'regex', 'must', 'should' which can be legitimate
    // Kept: keys that are always dangerous in any context
    const dangerousKeys = [
      'constructor',
      '__proto__',
      'prototype',
      'parent',        // Prototype pollution via parent
      'where',         // MongoDB $where equivalent
    ];

    // Deep validation for nested objects
    const deepValidate = (obj: any, depth = 0): void => {
      if (depth > 10) {
        throw new ConnectorValidationError(
          productionMode ? 'Invalid filter' : 'Filter depth exceeded maximum',
          'depth_exceeded',
        );
      }

      if (obj && typeof obj === 'object') {
        for (const key of Object.keys(obj)) {
          // S012-006: More precise key checking - only exact matches, not partial
          if (dangerousKeys.includes(key.toLowerCase())) {
            logger.warn('[Guardrails] Dangerous filter key detected', { key });
            throw new ConnectorValidationError(
              productionMode ? 'Invalid filter' : `Filter contains dangerous key: ${key}`,
              'dangerous_key',
            );
          }

          // Recurse into nested objects
          if (typeof obj[key] === 'object' && obj[key] !== null) {
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
        'validation_failed',
      );
    }
  };

  /**
   * Filters payload to only allowed fields.
   * S012-006: Includes ReDoS protection with safe matching algorithms.
   *
   * @internal
   */
  const filterPayload = async (payload: Record<string, any>): Promise<Record<string, any>> => {
    if (!allowedPayloadFields || allowedPayloadFields.length === 0) {
      return payload;
    }

    // S012-006: Add payload size limit to prevent memory exhaustion
    const payloadSize = JSON.stringify(payload).length;
    if (payloadSize > maxPayloadSize) {
      logger.warn('[Guardrails] Payload exceeds maximum size', {
        size: payloadSize,
        max: maxPayloadSize,
      });
      throw new ConnectorValidationError(
        productionMode ? 'Payload exceeds maximum size' : `Payload exceeds maximum size of ${maxPayloadSize} bytes`,
        'payload_too_large',
      );
    }

    const filtered: Record<string, any> = {};
    let patternsSkipped = 0;

    // S012-006: Safe pattern matching without catastrophic backtracking
    for (const pattern of allowedPayloadFields) {
      let patternSkipped = false;

      // Validate pattern length to prevent ReDoS
      if (pattern.length > 100) {
        logger.warn('[Guardrails] Allowed payload field pattern exceeds maximum length');
        patternSkipped = true;
      }

      // S012-006: Count consecutive wildcards - limit to prevent ReDoS
      if (!patternSkipped) {
        const consecutiveWildcardMatch = pattern.match(/\*+/g);
        if (consecutiveWildcardMatch) {
          for (const wildcards of consecutiveWildcardMatch) {
            if (wildcards.length > 3) {
              logger.warn('[Guardrails] Pattern has too many consecutive wildcards', { pattern });
              patternSkipped = true;
              break;
            }
          }
        }
      }

      if (patternSkipped) {
        patternsSkipped++;
        continue;
      }

      // S012-006: Use safe glob matching instead of regex where possible
      // Only use regex for complex patterns
      if (!pattern.includes('*') && !pattern.includes('?')) {
        // Exact match - no regex needed
        if (Object.prototype.hasOwnProperty.call(payload, pattern)) {
          filtered[pattern] = payload[pattern];
        }
      } else {
        // Has wildcards - use safe regex construction with timeout
        try {
          // Escape special regex characters (except * and ? which are wildcards)
          const escapedPattern = pattern
            .replace(/[.+^${}()|[\]\\]/g, '\\$&')
            .replace(/\*{1,3}/g, '.*')  // Limit wildcards expansion
            .replace(/\?/g, '.');

          // S012-006: Create regex with timeout protection using simple matching
          // Pre-compile and cache the regex for efficiency
          const regex = new RegExp(`^${escapedPattern}$`);

          for (const key of Object.keys(payload)) {
            try {
              // S012-006: Add timeout protection for regex operations
              const timeoutPromise = new Promise<boolean>((_, reject) => {
                setTimeout(() => reject(new Error('Regex timeout')), regexTimeout);
              });

              const testPromise = Promise.resolve(regex.test(key));

              const result = await Promise.race([testPromise, timeoutPromise])
                .catch(() => {
                  logger.warn('[Guardrails] Regex test timeout', { key, pattern });
                  return false;
                });

              if (result) {
                filtered[key] = payload[key];
              }
            } catch (e) {
              // Skip if regex test fails (shouldn't happen with safe patterns)
              logger.warn('[Guardrails] Regex test failed', { key, pattern });
            }
          }
        } catch (e) {
          logger.warn('[Guardrails] Invalid pattern regex', { pattern });
        }
      }
    }

    // S012-006: If all patterns were skipped, return original payload (fail-open for safety)
    // This prevents blocking legitimate content due to overly strict pattern validation
    if (patternsSkipped === allowedPayloadFields.length) {
      return payload;
    }

    return filtered;
  };

  /**
   * Validates retrieved points.
   *
   * @internal
   */
  const validatePoints = async (points: QdrantPoint[]): Promise<{ valid: QdrantPoint[]; blocked: number }> => {
    if (!validateRetrievedPoints) {
      return { valid: points, blocked: 0 };
    }

    // Story 1.2 — batch validator path. Replaces per-point loop when set.
    // Cumulative-audit extraction: identical pattern now in
    // `applyRetrievedDocValidatorToMatches`.
    if (retrievedDocValidator) {
      return applyRetrievedDocValidatorToMatches(
        points,
        retrievedDocValidator,
        (p) => ({
          content: [
            p.payload ? JSON.stringify(p.payload) : '',
            p.id !== null && p.id !== undefined ? String(p.id) : '',
          ].filter(Boolean).join(' '),
          metadata: p.payload as Record<string, unknown> | undefined,
        }),
        { productionMode, itemNoun: 'Point' }
      );
    }

    const valid: QdrantPoint[] = [];
    let blocked = 0;

    for (const point of points) {
      // Build content to validate
      let contentToValidate = '';

      if (point.payload) {
        contentToValidate = JSON.stringify(point.payload);
      }

      if (point.id) {
        contentToValidate += ` ${String(point.id)}`;
      }

      const result = await validateWithTimeout(contentToValidate, 'qdrant_point');

      if (result.allowed) {
        // Filter payload if allowed fields are specified
        const filteredPoint = { ...point };
        if (allowedPayloadFields.length > 0 && point.payload) {
            filteredPoint.payload = await filterPayload(point.payload);
        }
        valid.push(filteredPoint);
      } else {
        blocked++;
        logger.warn('[Guardrails] Point blocked', {
          id: point.id,
          reason: result.reason,
        });
        if (onPointBlocked) {
          onPointBlocked(point.id, result);
        }

        if (onBlockedPoint === 'abort') {
          throw new Error(productionMode ? 'Point blocked' : `Point blocked: ${result.reason}`);
        }
      }
    }

    return { valid, blocked };
  };

  return {
    /**
     * Executes a vector search with full guardrails validation.
     *
     * @param options - Search options including collectionName, vector, filters
     * @returns Search results with validation metadata
     */
    async search(options: QdrantSearchOptions): Promise<GuardedQdrantResult> {
      // Step 1: Validate collection name
      const collectionName = options.collectionName;
      const safeCollectionNameRegex = /^[a-zA-Z0-9_-]+$/;
      if (!safeCollectionNameRegex.test(collectionName)) {
        throw new Error(productionMode ? 'Invalid collection name' : 'Collection name contains invalid characters');
      }
      if (collectionName.length > 255) {
        throw new Error(productionMode ? 'Invalid collection name' : 'Collection name exceeds maximum length');
      }

      // Step 2: Validate vector format
      validateVector(options.vector);

      // Step 3: Validate and apply limit
      const limit = Math.min(options.limit || 10, maxLimit);

      // Step 4: Validate filters
      if (options.filter) {
        validateFilter(options.filter);
      }

      // Step 5: Execute the search
      const rawResult = await qdrantClient.search(collectionName, {
        ...options,
        limit,
      });

      // Step 6: Validate retrieved points
      const points = rawResult || [];
      const { valid: validPoints, blocked } = await validatePoints(points);

      return {
        points: validPoints,
        pointsBlocked: blocked,
        filtered: blocked > 0,
        raw: rawResult,
      };
    },

    /**
     * Upserts points to a collection with optional validation.
     *
     * @param collectionName - Target collection
     * @param points - Points to upsert
     */
    async upsert(collectionName: string, points: any[]): Promise<void> {
      // Validate collection name
      const safeCollectionNameRegex = /^[a-zA-Z0-9_-]+$/;
      if (!safeCollectionNameRegex.test(collectionName)) {
        throw new Error(productionMode ? 'Invalid collection name' : 'Collection name contains invalid characters');
      }
      if (collectionName.length > 255) {
        throw new Error(productionMode ? 'Invalid collection name' : 'Collection name exceeds maximum length');
      }

      // Validate points being added
      for (const point of points) {
        // Validate vector if present
        if (point.vector) {
          validateVector(point.vector);
        }

        // Validate payload content
        if (point.payload) {
          const result = await validateWithTimeout(JSON.stringify(point.payload), 'qdrant_upsert');
          if (!result.allowed) {
            logger.warn('[Guardrails] Point upsert blocked', { reason: result.reason });
            throw new Error(productionMode ? 'Point blocked' : `Point blocked: ${result.reason}`);
          }
        }
      }

      return qdrantClient.upsert(collectionName, points);
    },
  };
}

/**
 * Re-exports types for convenience.
 */
export type {
  GuardedQdrantOptions,
  GuardedQdrantResult,
  QdrantSearchOptions,
  QdrantPoint,
  BlockedPointHandling,
} from './types.js';
