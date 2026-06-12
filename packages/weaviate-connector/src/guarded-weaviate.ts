/**
 * Weaviate Guarded Wrapper
 * =========================
 *
 * Provides security guardrails for Weaviate vector database operations,
 * executing queries through the real `weaviate-client ^3` API
 * (`collection.query.nearText` / `bm25` / `hybrid` / `fetchObjects`).
 *
 * Security Features:
 * - Query injection validation before retrieval
 * - Retrieved object poisoning detection
 * - Collection (class) and field access control
 * - Structural `FilterValue` validation (see `filter-validation.ts`)
 * - Production mode error messages
 * - Validation timeout via validateWithTimeoutSecure
 *
 * @package @blackunicorn/bonklm-weaviate
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
import { applyRetrievedDocValidatorToMatches } from '@blackunicorn/bonklm/core/connector-utils';
import { filterValidationDetail, validateWeaviateFilter } from './filter-validation.js';
import type {
  GuardedWeaviateOptions,
  GuardedWeaviateResult,
  WeaviateClientLike,
  WeaviateQueryOptions,
  WeaviateQueryResult,
  WeaviateRetrievedObject,
  WeaviateSearchOptions
} from './types.js';
import { DEFAULT_MAX_LIMIT, DEFAULT_QUERY_LIMIT, DEFAULT_VALIDATION_TIMEOUT } from './types.js';

/**
 * Default logger instance.
 *
 * @internal
 */
const DEFAULT_LOGGER: Logger = createLogger('console');

/**
 * Maximum class-name / pattern length accepted before matching (ReDoS guard).
 *
 * @internal
 */
const MAX_NAME_LENGTH = 100;

/**
 * Safe class-name pattern.
 *
 * @internal
 */
const SAFE_CLASS_NAME_REGEX = /^[a-zA-Z0-9_-]+$/;

/**
 * Safe field-name pattern (GraphQL-safe identifier).
 *
 * @internal
 */
const SAFE_FIELD_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * Non-null object check for defensive reads of caller/client-supplied values.
 *
 * @internal
 */
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/**
 * Case-insensitive wildcard matching (`*` = any run, `?` = any single char)
 * against an allowlist, with ReDoS guards: over-long patterns are skipped and
 * every other regex metacharacter is escaped.
 *
 * @internal
 */
const matchesAnyPattern = (value: string, patterns: string[], logger: Logger): boolean =>
  patterns.some(pattern => {
    if (pattern.length > MAX_NAME_LENGTH) {
      logger.warn('[Guardrails] Allowed pattern exceeds maximum length');
      return false;
    }

    const escapedPattern = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');

    try {
      const regex = new RegExp(`^${escapedPattern}$`, 'i');
      return regex.test(value);
    } catch {
      /* v8 ignore start -- defensive: escaping renders patterns regex-safe */
      logger.warn('[Guardrails] Invalid pattern regex', { pattern: sanitizeMeta(pattern) });
      return false;
      /* v8 ignore stop */
    }
  });

/**
 * Represents a wrapped Weaviate client with guardrails.
 */
export interface GuardedWeaviateClient {
  query(options: WeaviateQueryOptions): Promise<GuardedWeaviateResult>;
}

/**
 * Creates a guarded Weaviate client wrapper for vector operations.
 *
 * @param weaviateClient - The `weaviate-client ^3` client instance to wrap
 * @param options - Configuration options for the guarded wrapper
 * @returns A guarded client with validation
 *
 * @example
 * ```ts
 * import weaviate from 'weaviate-client';
 * import { createGuardedClient } from '@blackunicorn/bonklm-weaviate';
 * import { PromptInjectionValidator } from '@blackunicorn/bonklm';
 *
 * const client = await weaviate.connectToLocal();
 *
 * const guardedClient = createGuardedClient(client, {
 *   validators: [new PromptInjectionValidator()],
 *   allowedClasses: ['Document', 'Article'],
 *   validateRetrievedObjects: true
 * });
 *
 * const results = await guardedClient.query({
 *   className: 'Document',
 *   fields: ['title', 'content'],
 *   nearText: { concepts: ['machine learning tutorials'] },
 *   limit: 10
 * });
 *
 * for (const obj of results.objects) {
 *   console.log(obj.uuid, obj.properties.title);
 * }
 * ```
 */
export function createGuardedClient(
  weaviateClient: WeaviateClientLike,
  options: GuardedWeaviateOptions = {}
): GuardedWeaviateClient {
  const {
    validators = [],
    guards = [],
    logger = DEFAULT_LOGGER,
    validateRetrievedObjects = true,
    onBlockedObject = 'filter',
    productionMode = process.env.NODE_ENV === 'production',
    validationTimeout = DEFAULT_VALIDATION_TIMEOUT,
    maxLimit = DEFAULT_MAX_LIMIT,
    allowedClasses = [],
    allowedFields = [],
    validateFilters = true,
    onQueryBlocked,
    onObjectBlocked,
    onClassNotAllowed,
    retrievedDocValidator // Story 1.2 opt-in batch validator
  } = options;

  // Fail fast on a client that cannot satisfy the v3 surface the wrapper
  // executes against. The unknown-typed alias exists because JS callers
  // bypass the static type — the runtime checks must not trust it.
  const clientView: unknown = weaviateClient;
  if (!isRecord(clientView) || !isRecord(clientView.collections) || typeof clientView.collections.get !== 'function') {
    throw new Error('weaviateClient must expose collections.get() — pass a weaviate-client ^3 client instance');
  }

  const engine = new GuardrailEngine({
    validators,
    guards,
    logger
  });

  /**
   * Validation timeout wrapper — routes through the canonical
   * `validateWithTimeoutSecure` primitive.
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
   * Class-name enforcement: structural checks (length, safe characters) run
   * unconditionally so an unconfigured wrapper still rejects hostile names
   * before they reach `collections.get`; the allowlist (wildcards supported)
   * applies when configured.
   *
   * @internal
   */
  const assertClassAllowed = (className: string): void => {
    const reject = (detail: string): never => {
      // `className` is caller-supplied — sanitize at the log-meta and
      // dev-mode error-message boundaries (CWE-117).
      logger.warn('[Guardrails] Class not allowed', { className: sanitizeMeta(className) });
      if (onClassNotAllowed) onClassNotAllowed(className);
      throw new Error(productionMode ? 'Class not allowed' : detail);
    };

    if (typeof className !== 'string' || className.length === 0) {
      reject('Class name must be a non-empty string');
    }
    if (className.length > MAX_NAME_LENGTH) {
      reject('Class name exceeds maximum length');
    }
    if (!SAFE_CLASS_NAME_REGEX.test(className)) {
      reject(`Class '${sanitizeMeta(className)}' contains invalid characters`);
    }
    if (allowedClasses.length > 0 && !matchesAnyPattern(className, allowedClasses, logger)) {
      reject(`Class '${sanitizeMeta(className)}' is not allowed`);
    }
  };

  /**
   * Validates and filters the requested fields against `allowedFields`
   * (wildcards supported), rejecting unsafe characters. Returns the
   * `returnProperties` array to forward, or `undefined` to retrieve all
   * non-reference properties.
   *
   * @internal
   */
  const resolveReturnProperties = (fields: string[] | undefined): string[] | undefined => {
    if (!fields || fields.length === 0) {
      return undefined;
    }

    if (fields.some(field => typeof field !== 'string')) {
      throw new Error(productionMode ? 'Invalid fields' : 'fields must be an array of strings');
    }

    if (allowedFields.length === 0) {
      return fields;
    }

    const validated = fields.filter(field => {
      if (!SAFE_FIELD_REGEX.test(field)) {
        logger.warn('[Guardrails] Field contains invalid characters', { field: sanitizeMeta(field) });
        return false;
      }
      return matchesAnyPattern(field, allowedFields, logger);
    });

    if (validated.length === 0) {
      throw new Error(productionMode ? 'No fields allowed' : 'None of the requested fields are allowed');
    }

    return validated;
  };

  /**
   * Reads an object's `properties` map through a widened view — the typed
   * contract requires it, but a non-conforming client may omit it at
   * runtime.
   *
   * @internal
   */
  const objectProperties = (obj: WeaviateRetrievedObject): Record<string, unknown> | undefined =>
    (obj as { properties?: Record<string, unknown> }).properties;

  /**
   * Serializes the content view of a retrieved object — its `properties`
   * map. Falls back to the whole object when a non-conforming client omits
   * `properties`. Single source of the content-derivation rule for both the
   * per-object and batch validation paths.
   *
   * @internal
   */
  const objectContent = (obj: WeaviateRetrievedObject): string => JSON.stringify(objectProperties(obj) ?? obj);

  /**
   * Validates retrieved objects. The validated content is the object's
   * `properties` map (the retrieved content); `uuid`, vectors, and return
   * metadata are not treated as content — except when a non-conforming
   * client omits `properties`, in which case the whole object is validated
   * as a fail-safe.
   *
   * @internal
   */
  const validateObjects = async (
    objects: WeaviateRetrievedObject[]
  ): Promise<{ valid: WeaviateRetrievedObject[]; blocked: number }> => {
    if (!validateRetrievedObjects) {
      return { valid: objects, blocked: 0 };
    }

    // Story 1.2 — batch validator path. Replaces the per-object loop when
    // set. The shared helper throws `ConnectorValidationError` for
    // cross-connector consistency.
    if (retrievedDocValidator) {
      return applyRetrievedDocValidatorToMatches(
        objects,
        retrievedDocValidator,
        obj => ({
          content: objectContent(obj),
          metadata: objectProperties(obj)
        }),
        { productionMode, itemNoun: 'Object' }
      );
    }

    const valid: WeaviateRetrievedObject[] = [];
    let blocked = 0;

    for (const obj of objects) {
      const result = await validateWithTimeout(objectContent(obj), 'weaviate_object');

      if (result.allowed) {
        valid.push(obj);
      } else {
        blocked++;
        // `obj.uuid` is upstream-supplied and `result.reason` is validator
        // output — both are CWE-117 log boundaries and stay wrapped.
        logger.warn('[Guardrails] Object blocked', {
          id: sanitizeMeta(obj.uuid),
          reason: sanitizeMeta(result.reason)
        });
        if (onObjectBlocked) {
          onObjectBlocked(obj, result);
        }

        if (onBlockedObject === 'abort') {
          // Sanitize `reason` at the dev-mode throw boundary (the caller may
          // log error.message into a downstream aggregator).
          throw new Error(productionMode ? 'Object blocked' : `Object blocked: ${sanitizeMeta(result.reason)}`);
        }
      }
    }

    return { valid, blocked };
  };

  return {
    /**
     * Executes a query with full guardrails validation through the real
     * `weaviate-client ^3` query namespace.
     *
     * @param queryOptions - Query options including className, fields, search mode, and filters
     * @returns Validated objects plus guardrail metadata and the raw client result
     */
    async query(queryOptions: WeaviateQueryOptions): Promise<GuardedWeaviateResult> {
      // Step 1: class-name validation — structural always, allowlist when configured
      assertClassAllowed(queryOptions.className);

      // Step 2: field validation → returnProperties
      const returnProperties = resolveReturnProperties(queryOptions.fields);

      // Step 3: search-mode selection + query-content validation
      const { nearText, bm25, hybrid } = queryOptions;
      const modeCount = [nearText, bm25, hybrid].filter(mode => mode !== undefined).length;
      if (modeCount > 1) {
        throw new Error(productionMode ? 'Invalid query' : 'Specify at most one of nearText, bm25, or hybrid');
      }

      // Blank (whitespace-only) query inputs are rejected rather than
      // skipped: the content-validation gate below fires on non-empty
      // content, so an empty/blank query must never reach it unvalidated.
      let queryContent = '';
      if (nearText !== undefined) {
        if (
          !Array.isArray(nearText.concepts) ||
          nearText.concepts.length === 0 ||
          nearText.concepts.some(concept => typeof concept !== 'string' || concept.trim().length === 0)
        ) {
          throw new Error(
            productionMode ? 'Invalid query' : 'nearText.concepts must be a non-empty array of non-blank strings'
          );
        }
        // Validated as one space-joined blob; the client receives the raw
        // array (concepts are embedded per element). Equivalent for the
        // bundled substring/pattern validators — noted because the validated
        // representation is not byte-identical to what is forwarded.
        queryContent = nearText.concepts.join(' ');
      } else if (bm25 !== undefined) {
        if (typeof bm25.query !== 'string' || bm25.query.trim().length === 0) {
          throw new Error(productionMode ? 'Invalid query' : 'bm25.query must be a non-blank string');
        }
        queryContent = bm25.query;
      } else if (hybrid !== undefined) {
        if (typeof hybrid.query !== 'string' || hybrid.query.trim().length === 0) {
          throw new Error(productionMode ? 'Invalid query' : 'hybrid.query must be a non-blank string');
        }
        queryContent = hybrid.query;
      }

      if (queryContent) {
        const result = await validateWithTimeout(queryContent, 'weaviate_query');
        if (!result.allowed) {
          // Sanitize `result.reason` at both the log-meta and dev-mode-throw
          // boundaries (CWE-117).
          const safeReason = sanitizeMeta(result.reason);
          logger.warn('[Guardrails] Query blocked', { reason: safeReason });
          if (onQueryBlocked) onQueryBlocked(result);
          throw new Error(productionMode ? 'Query blocked' : `Query blocked: ${safeReason}`);
        }
      }

      // Step 4: filter validation — structural FilterValue walk; when a
      // field allowlist is configured, filter targets must satisfy it too.
      if (queryOptions.where !== undefined && validateFilters) {
        try {
          validateWeaviateFilter(
            queryOptions.where,
            allowedFields.length > 0
              ? { isPropertyAllowed: property => matchesAnyPattern(property, allowedFields, logger) }
              : {}
          );
        } catch (e) {
          const detail = filterValidationDetail(e);
          logger.warn('[Guardrails] Filter rejected', { reason: sanitizeMeta(detail) });
          throw new Error(productionMode ? 'Invalid filter' : detail, { cause: e });
        }
      }

      // Step 5: limit normalization — clamped to [1, maxLimit]
      const effectiveMaxLimit = Math.max(1, maxLimit);
      const requestedLimit =
        typeof queryOptions.limit === 'number' && Number.isFinite(queryOptions.limit)
          ? Math.floor(queryOptions.limit)
          : DEFAULT_QUERY_LIMIT;
      const limit = Math.min(Math.max(requestedLimit, 1), effectiveMaxLimit);

      // Step 6: execute through the real v3 query namespace
      const collection = weaviateClient.collections.get(queryOptions.className);
      const searchOptions: WeaviateSearchOptions = {
        limit,
        ...(returnProperties !== undefined ? { returnProperties } : {}),
        ...(queryOptions.where !== undefined ? { filters: queryOptions.where } : {})
      };

      let raw: WeaviateQueryResult;
      if (nearText !== undefined) {
        raw = await collection.query.nearText(nearText.concepts, searchOptions);
      } else if (bm25 !== undefined) {
        raw = await collection.query.bm25(bm25.query, searchOptions);
      } else if (hybrid !== undefined) {
        raw = await collection.query.hybrid(
          hybrid.query,
          hybrid.alpha !== undefined ? { ...searchOptions, alpha: hybrid.alpha } : searchOptions
        );
      } else {
        raw = await collection.query.fetchObjects(searchOptions);
      }

      // Step 7: extraction + retrieved-object validation. The v3 client
      // returns `{ objects }` at the top level; anything else (a
      // misbehaving client or JS caller) is treated as empty, and non-object
      // entries are dropped before validation.
      const rawValue: unknown = raw;
      const objectsValue = isRecord(rawValue) ? rawValue.objects : undefined;
      const retrieved = Array.isArray(objectsValue)
        ? (objectsValue.filter(isRecord) as unknown as WeaviateRetrievedObject[])
        : [];

      const { valid: validObjects, blocked } = await validateObjects(retrieved);

      return {
        objects: validObjects,
        objectsBlocked: blocked,
        filtered: blocked > 0,
        raw
      };
    }
  };
}
