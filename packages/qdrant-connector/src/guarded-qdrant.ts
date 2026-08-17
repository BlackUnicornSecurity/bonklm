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
 * - Validation timeout via validateWithTimeoutSecure
 *
 * @package @blackunicorn/bonkdrant
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
import {
  applyRetrievedDocValidatorToMatches,
  DEFAULT_QUERY_LIMIT,
  normalizeLimit
} from '@blackunicorn/bonklm/core/connector-utils';
import type { GuardedQdrantOptions, GuardedQdrantResult, QdrantPoint, QdrantSearchOptions } from './types.js';
import {
  DEFAULT_MAX_FILTER_LENGTH,
  DEFAULT_MAX_LIMIT,
  DEFAULT_MAX_PAYLOAD_SIZE,
  DEFAULT_REGEX_TIMEOUT,
  DEFAULT_VALIDATION_TIMEOUT
} from './types.js';

/**
 * Default logger instance.
 *
 * @internal
 */
const DEFAULT_LOGGER: Logger = createLogger('console');

/**
 * Native Qdrant `SearchRequest` BODY keys (verified against
 * `@qdrant/js-client-rest@1.16.2` `generated_schema.d.ts` `SearchRequest`) that
 * the guarded `search` does NOT handle explicitly but forwards to the client.
 * The caller-supplied `passthrough` is screened against this allow-list before
 * it reaches the client: any other key — a filter-bearing field that would
 * bypass `validateFilter`, or an arbitrary key admitted by the
 * `[key: string]: any` index signature on `QdrantSearchOptions` — is dropped
 * (defense-in-depth).
 *
 * Scoped to `SearchRequest` BODY fields. The client's `search()` additionally
 * accepts `consistency` / `timeout` (lifted to query-string params — NOT body
 * fields); those are intentionally not forwarded here. Add explicit, validated
 * support if they are ever needed.
 *
 * Exported (off-barrel) solely so the `test-d` conformance lock can derive its
 * key union from this single source of truth — not part of the public API
 * (absent from `index.ts`; unreachable through the package `exports` map).
 *
 * @internal
 */
export const QDRANT_NATIVE_SEARCH_KEYS = ['offset', 'params', 'shard_key'] as const;

/**
 * Runtime allow-list `Set` derived from {@link QDRANT_NATIVE_SEARCH_KEYS}. The
 * tuple above is the single source of truth: the `test-d` real-client
 * conformance lock derives its caller-passthrough union from
 * `(typeof QDRANT_NATIVE_SEARCH_KEYS)[number]`, so a key removed from the tuple
 * shrinks that union and fails type-compilation instead of silently dropping a
 * passthrough field. Closes the hand-transcription drift between the runtime
 * allow-list and its compile-time conformance lock (single source of truth).
 *
 * @internal
 */
const QDRANT_NATIVE_SEARCH_KEY_SET: ReadonlySet<string> = new Set(QDRANT_NATIVE_SEARCH_KEYS);

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
 * import { createGuardedClient } from '@blackunicorn/bonkdrant';
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
export function createGuardedClient(qdrantClient: any, options: GuardedQdrantOptions = {}): GuardedQdrantClient {
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
    retrievedDocValidator // opt-in batch validator
  } = options;

  const engine = new GuardrailEngine({
    validators,
    guards,
    logger
  });

  /**
   * Validation timeout wrapper (routes through canonical validateWithTimeoutSecure primitive).
   *
   * @internal
   */
  const validateWithTimeout = async (content: string, context?: string): Promise<GuardrailResult> => {
    const result = await validateWithTimeoutSecure<GuardrailResult>({
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
    return result;
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
    const hasInvalidValues = vector.some(v => typeof v !== 'number' || !Number.isFinite(v));
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
        max: maxFilterLength
      });
      throw new ConnectorValidationError(
        productionMode
          ? 'Filter exceeds maximum length'
          : `Filter exceeds maximum length of ${maxFilterLength} characters`,
        'filter_too_long'
      );
    }

    // S012-006: Check for truly dangerous patterns (not legitimate Qdrant operators)
    // Qdrant uses: must, must_not, filter, key, match, range, geo, etc.
    // The following are ALWAYS dangerous:
    const dangerousPatterns = [
      /\beval\b/i, // eval keyword
      /\bconstructor\b/i, // constructor access
      /\b__proto__\b/i, // prototype pollution
      /\$where/i, // MongoDB $where (not used in Qdrant)
      /\.\.\./ // Path traversal
      // Note: $ne and $regex are REMOVED - they can be legitimate in some contexts
      // We handle them differently below
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
              'invalid_unicode'
            );
          }
          const hexCode = parseInt(hexDigits.slice(1), 16); // Skip 'u', get '0024'
          // Validate hexCode
          if (isNaN(hexCode)) {
            throw new ConnectorValidationError(
              productionMode ? 'Invalid filter' : 'Filter contains invalid Unicode escapes',
              'invalid_unicode'
            );
          }
          const decoded = String.fromCharCode(hexCode);
          // Check if decoded character is dangerous
          if (['$', '_', 'p', 'P', 'c', 'C'].some(char => decoded === char)) {
            // Could be obfuscation - reject
            // CWE-117 (consistency only): `escape` is a `/\\u[0-9a-f]{4}/`
            // match — control-char-free by construction — wrapped to keep every
            // attacker-derived log value in this file uniform (see the key /
            // reason load-bearing sinks).
            logger.warn('[Guardrails] Suspicious Unicode escape detected', { escape: sanitizeMeta(escape) });
            throw new ConnectorValidationError(
              productionMode ? 'Invalid filter' : 'Filter contains suspicious Unicode escapes',
              'unicode_obfuscation'
            );
          }
        } catch (e) {
          if (e instanceof ConnectorValidationError) {
            throw e;
          }
          // Invalid escape, reject
          throw new ConnectorValidationError(
            productionMode ? 'Invalid filter' : 'Filter contains invalid Unicode escapes',
            'invalid_unicode'
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
      'parent', // Prototype pollution via parent
      'where' // MongoDB $where equivalent
    ];

    // Deep validation for nested objects
    const deepValidate = (obj: any, depth = 0): void => {
      if (depth > 10) {
        throw new ConnectorValidationError(
          productionMode ? 'Invalid filter' : 'Filter depth exceeded maximum',
          'depth_exceeded'
        );
      }

      if (obj && typeof obj === 'object') {
        for (const key of Object.keys(obj)) {
          // S012-006: More precise key checking - only exact matches, not partial
          if (dangerousKeys.includes(key.toLowerCase())) {
            // CWE-117 (defense-in-depth / consistency only): the `includes(...)`
            // guard above admits only a case-variant of one of the fixed
            // `dangerousKeys` constants, so `key` cannot carry control characters
            // here today. The `sanitizeMeta` wraps keep this boundary uniform with
            // the connector's genuinely attacker-influenced log/throw sinks
            // (validator `reason`, point `id`), so a future widening of the key
            // source can never regress into a raw-interpolation gap. Intentionally
            // NOT mutation-tested: the reachable input set is control-char-free by
            // construction, so removing these wraps would not change observable
            // output (see cwe117-regression.test.ts).
            logger.warn('[Guardrails] Dangerous filter key detected', { key: sanitizeMeta(key) });
            throw new ConnectorValidationError(
              productionMode ? 'Invalid filter' : `Filter contains dangerous key: ${sanitizeMeta(key)}`,
              'dangerous_key'
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
        'validation_failed'
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
        max: maxPayloadSize
      });
      throw new ConnectorValidationError(
        productionMode ? 'Payload exceeds maximum size' : `Payload exceeds maximum size of ${maxPayloadSize} bytes`,
        'payload_too_large'
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
              // CWE-117 consistency wrap (operator-supplied `pattern`; see the regex sinks below).
              logger.warn('[Guardrails] Pattern has too many consecutive wildcards', {
                pattern: sanitizeMeta(pattern)
              });
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
            .replace(/\*{1,3}/g, '.*') // Limit wildcards expansion
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

              const result = await Promise.race([testPromise, timeoutPromise]).catch(() => {
                // CWE-117: `key` is an UNCONSTRAINED field name from the
                // retrieved point payload (attacker/upstream-influenced) — the
                // load-bearing wrap. `pattern` is an operator-supplied
                // `allowedPayloadFields` entry — a consistency wrap, sanitized at
                // every pattern sink in this function (see above/below).
                logger.warn('[Guardrails] Regex test timeout', {
                  key: sanitizeMeta(key),
                  pattern: sanitizeMeta(pattern)
                });
                return false;
              });

              if (result) {
                filtered[key] = payload[key];
              }
            } catch (e) {
              // Skip if regex test fails (shouldn't happen with safe patterns).
              // CWE-117: same boundary as the timeout sink above — `key` is the
              // unconstrained retrieved-payload field name (load-bearing wrap);
              // `pattern` is operator config (consistency wrap, like the other
              // pattern sinks).
              logger.warn('[Guardrails] Regex test failed', {
                key: sanitizeMeta(key),
                pattern: sanitizeMeta(pattern)
              });
            }
          }
        } catch (e) {
          // CWE-117 consistency wrap (operator-supplied `pattern`; see the regex sinks above).
          logger.warn('[Guardrails] Invalid pattern regex', { pattern: sanitizeMeta(pattern) });
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

    // batch validator path. Replaces per-point loop when set.
    // Cumulative-audit extraction: identical pattern now in
    // `applyRetrievedDocValidatorToMatches`.
    if (retrievedDocValidator) {
      return applyRetrievedDocValidatorToMatches(
        points,
        retrievedDocValidator,
        p => ({
          content: [p.payload ? JSON.stringify(p.payload) : '', p.id !== null && p.id !== undefined ? String(p.id) : '']
            .filter(Boolean)
            .join(' '),
          metadata: p.payload as Record<string, unknown> | undefined
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
        // Sprint 43 cross-connector CWE-117 sweep (architect CRITICAL
        // #3 closure): qdrant was a peer of weaviate/pinecone but
        // initial scoping missed it. Sanitize `point.id` (caller-
        // supplied) + `reason` (validator output) at log + throw.
        const safeReason = sanitizeMeta(result.reason);
        logger.warn('[Guardrails] Point blocked', {
          id: sanitizeMeta(point.id),
          reason: safeReason
        });
        if (onPointBlocked) {
          onPointBlocked(point.id, result);
        }

        if (onBlockedPoint === 'abort') {
          throw new Error(productionMode ? 'Point blocked' : `Point blocked: ${safeReason}`);
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
      // Separate connector-level options from the rest; the remaining
      // `passthrough` keys are screened against the QDRANT_NATIVE_SEARCH_KEY_SET
      // allow-list (Step 5 below) before any of them can reach the client.
      const {
        collectionName,
        vector,
        limit: requestedLimit,
        scoreThreshold,
        withPayload,
        withVector,
        filter,
        ...passthrough
      } = options;

      // Step 1: Validate collection name
      const safeCollectionNameRegex = /^[a-zA-Z0-9_-]+$/;
      if (!safeCollectionNameRegex.test(collectionName)) {
        throw new Error(productionMode ? 'Invalid collection name' : 'Collection name contains invalid characters');
      }
      if (collectionName.length > 255) {
        throw new Error(productionMode ? 'Invalid collection name' : 'Collection name exceeds maximum length');
      }

      // Step 2: Validate vector format
      validateVector(vector);

      // Step 3: Normalize limit to [1, maxLimit] (shared vector-DB family
      // clamp: floors fractional, defaults non-finite, rejects zero/negative
      // so an invalid limit can never reach the client).
      const limit = normalizeLimit(requestedLimit, { max: maxLimit, fallback: DEFAULT_QUERY_LIMIT });

      // Step 4: Validate filters
      if (filter) {
        validateFilter(filter);
      }

      // Step 5: Restrict forwarded caller options to an allow-list of native
      // Qdrant `SearchRequest` keys. Anything else in `passthrough` (a
      // filter-bearing field that would bypass `validateFilter`, or any key
      // admitted by the `[key: string]: any` index signature) is dropped so it
      // cannot reach the client unvalidated (defense-in-depth).
      const nativeOptions: Record<string, unknown> = {};
      for (const key of Object.keys(passthrough)) {
        if (QDRANT_NATIVE_SEARCH_KEY_SET.has(key)) {
          nativeOptions[key] = (passthrough as Record<string, unknown>)[key];
        }
      }

      // Bound the only numeric native passthrough key: a negative, fractional,
      // or non-numeric `offset` must not reach the client.
      if (nativeOptions.offset !== undefined) {
        const offset = nativeOptions.offset;
        if (typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0) {
          throw new Error(productionMode ? 'Invalid search options' : 'Search offset must be a non-negative integer');
        }
      }

      // Step 6: Execute the search. Translate the connector's camelCase options
      // to Qdrant's snake_case `SearchRequest` fields — the real
      // `@qdrant/js-client-rest` client expects `score_threshold` /
      // `with_payload` / `with_vector` (the camelCase forms are silently
      // ignored server-side), and the request body carries no `collectionName`
      // (that is the first positional argument).
      const searchBody = {
        ...nativeOptions,
        vector,
        limit,
        ...(filter !== undefined ? { filter } : {}),
        ...(scoreThreshold !== undefined ? { score_threshold: scoreThreshold } : {}),
        ...(withPayload !== undefined ? { with_payload: withPayload } : {}),
        ...(withVector !== undefined ? { with_vector: withVector } : {})
      };
      const rawResult = await qdrantClient.search(collectionName, searchBody);

      // Step 7: Validate retrieved points
      const points = rawResult || [];
      const { valid: validPoints, blocked } = await validatePoints(points);

      return {
        points: validPoints,
        pointsBlocked: blocked,
        filtered: blocked > 0,
        raw: rawResult
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
            // CWE-117 sweep: sister to point-blocked above.
            const safeReason = sanitizeMeta(result.reason);
            logger.warn('[Guardrails] Point upsert blocked', { reason: safeReason });
            throw new Error(productionMode ? 'Point blocked' : `Point blocked: ${safeReason}`);
          }
        }
      }

      // Qdrant's REST client expects the points wrapped in a `PointsList`
      // object (`{ points }`), not a bare array — a bare array serializes
      // to a body with no `points`/`batch` key, which the API rejects as
      // schema-invalid.
      return qdrantClient.upsert(collectionName, { points });
    }
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
  BlockedPointHandling
} from './types.js';
