/**
 * Weaviate Guarded Wrapper
 * =========================
 *
 * Provides security guardrails for Weaviate vector database operations.
 *
 * Security Features:
 * - Query injection validation before retrieval
 * - Retrieved object poisoning detection
 * - Class and field access control
 * - Filter expression validation
 * - Production mode error messages
 * - Validation timeout with AbortController
 *
 * @package @blackunicorn/bonklm-weaviate
 */

import {
  createLogger,
  createResult,
  GuardrailEngine,
  type GuardrailResult,
  type Logger,
  Severity,
} from '@blackunicorn/bonklm';
import type {
  GuardedWeaviateOptions,
  GuardedWeaviateResult,
  WeaviateQueryOptions,
} from './types.js';
import {
  DEFAULT_MAX_LIMIT,
  DEFAULT_VALIDATION_TIMEOUT,
} from './types.js';

/**
 * Default logger instance.
 *
 * @internal
 */
const DEFAULT_LOGGER: Logger = createLogger('console');

/**
 * Gets a nested value from an object using bracket notation.
 * Supports paths like 'data.Get.Document' or 'data.Document.objects'.
 *
 * @param obj - The object to traverse
 * @param path - The path to traverse (e.g., 'a.b.c' or 'a[0].b')
 * @returns The value at the path, or undefined if not found
 *
 * @internal
 */
function getNestedValue(obj: unknown, path: string): unknown {
  const parts = path.split(/[\.\[]/);
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }

    // Clean up array index notation
    const key = part.replace(/\]$/, '');
    const index = parseInt(key, 10);

    if (typeof current === 'object' && current !== null) {
      if (!isNaN(index) && Array.isArray(current)) {
        current = current[index];
      } else {
        current = (current as Record<string, unknown>)[key];
      }
    } else {
      return undefined;
    }
  }

  return current;
}

/**
 * Represents a wrapped Weaviate client with guardrails.
 */
export interface GuardedWeaviateClient {
  query(options: WeaviateQueryOptions): Promise<GuardedWeaviateResult>;
}

/**
 * Creates a guarded Weaviate client wrapper for vector operations.
 *
 * @param weaviateClient - The Weaviate client to wrap
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
 *   limit: 10
 * });
 * ```
 */
export function createGuardedClient(
  weaviateClient: any,
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
   * Checks if a class is allowed based on allowedClasses patterns.
   * Includes input validation and ReDoS protection.
   *
   * @internal
   */
  const isClassAllowed = (className: string): boolean => {
    if (!allowedClasses || allowedClasses.length === 0) {
      return true;
    }

    // Validate className input length to prevent ReDoS
    if (className.length > 100) {
      logger.warn('[Guardrails] Class name exceeds maximum length');
      return false;
    }

    // Validate className contains only safe characters
    const safeClassNameRegex = /^[a-zA-Z0-9_-]+$/;
    if (!safeClassNameRegex.test(className)) {
      logger.warn('[Guardrails] Class name contains invalid characters');
      return false;
    }

    return allowedClasses.some((pattern) => {
      // Validate pattern length to prevent ReDoS
      if (pattern.length > 100) {
        logger.warn('[Guardrails] Allowed class pattern exceeds maximum length');
        return false;
      }

      // Escape special regex characters (except * and ? which are wildcards)
      const escapedPattern = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.');

      try {
        const regex = new RegExp(`^${escapedPattern}$`, 'i');
        return regex.test(className);
      } catch (e) {
        logger.warn('[Guardrails] Invalid pattern regex', { pattern });
        return false;
      }
    });
  };

  /**
   * Validates and sanitizes field list.
   * Includes input validation and GraphQL injection protection.
   *
   * @internal
   */
  const validateFields = (fields: string[]): string[] => {
    if (!allowedFields || allowedFields.length === 0) {
      return fields;
    }

    // Validate each field name against GraphQL safe characters
    const safeFieldRegex = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

    return fields.filter((field) => {
      // Reject fields with unsafe characters (GraphQL injection risk)
      if (!safeFieldRegex.test(field)) {
        logger.warn('[Guardrails] Field contains invalid characters', { field });
        return false;
      }

      // Check if field matches any allowed pattern
      return allowedFields.some((pattern) => {
        // Escape special regex characters (except * and ? which are wildcards)
        const escapedPattern = pattern
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*/g, '.*')
          .replace(/\?/g, '.');

        try {
          const regex = new RegExp(`^${escapedPattern}$`, 'i');
          return regex.test(field);
        } catch (e) {
          logger.warn('[Guardrails] Invalid pattern regex', { pattern });
          return false;
        }
      });
    });
  };

  /**
   * Validates filter expressions for dangerous patterns.
   * Includes deep object traversal and Unicode escape detection.
   *
   * @internal
   */
  const validateFilter = (filter: any): void => {
    if (!validateFilters || !filter) {
      return;
    }

    const filterStr = JSON.stringify(filter);

    // Check for dangerous patterns including Unicode escape variants
    const dangerousPatterns = [
      /\beval\b/i,
      /\bconstructor\b/i,
      /\b__proto__\b/i,
      /\$where/i,
      /\$ne\b/,
      /\$regex\b/,
      /\\u0024/i,  // Unicode escape for $
      /\\u005f/i,  // Unicode escape for _
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(filterStr)) {
        logger.warn('[Guardrails] Dangerous filter pattern detected');
        throw new Error(productionMode ? 'Filter contains dangerous patterns' : 'Filter contains dangerous patterns');
      }
    }

    // Deep validation for nested objects
    const deepValidate = (obj: any, depth = 0): void => {
      if (depth > 10) {
        throw new Error(productionMode ? 'Invalid filter' : 'Filter depth exceeded maximum');
      }

      if (obj && typeof obj === 'object') {
        for (const key of Object.keys(obj)) {
          // Code review fix: Use exact match instead of substring match to prevent bypass
          // Previous: key.toLowerCase().includes(dk.toLowerCase()) would match "myNeField" due to "ne"
          const dangerousKeys = ['constructor', '__proto__', 'prototype', 'where', 'ne', 'regex'];
          const keyLower = key.toLowerCase();
          if (dangerousKeys.some((dk) => keyLower === dk.toLowerCase())) {
            logger.warn('[Guardrails] Dangerous filter key detected', { key });
            throw new Error(productionMode ? 'Invalid filter' : 'Filter contains dangerous keys');
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
      if (e instanceof Error) {
        throw e;
      }
      throw new Error(productionMode ? 'Invalid filter' : 'Filter validation failed', { cause: e });
    }
  };

  /**
   * Validates retrieved objects.
   *
   * @internal
   */
  const validateObjects = async (objects: any[]): Promise<{ valid: any[]; blocked: number }> => {
    if (!validateRetrievedObjects) {
      return { valid: objects, blocked: 0 };
    }

    // Story 1.2 — batch validator path. Replaces per-object loop when set.
    if (retrievedDocValidator) {
      // Audit-loop fix: position-stable synthetic ids defeat attacker-
      // influenced metadata from spoofing another object's id key.
      const docs = objects.map((o, i) => ({
        id: `__pos_${i}`,
        content: JSON.stringify(o),
        metadata: o,
      }));
      const batch = await retrievedDocValidator.validateBatch(docs);
      if (batch.result.blocked) {
        throw new Error(
          productionMode ? 'Object batch blocked' : `Object batch blocked: ${batch.result.reason}`
        );
      }
      const survivorPositions = new Set(batch.docs.map((d) => d.id));
      const valid = objects.filter((_o, i) => survivorPositions.has(`__pos_${i}`));
      return { valid, blocked: batch.filteredCount };
    }

    const valid: any[] = [];
    let blocked = 0;

    for (const obj of objects) {
      // Convert object to string for validation
      const content = JSON.stringify(obj);
      const result = await validateWithTimeout(content, 'weaviate_object');

      if (result.allowed) {
        valid.push(obj);
      } else {
        blocked++;
        logger.warn('[Guardrails] Object blocked', {
          id: obj.id,
          reason: result.reason,
        });
        if (onObjectBlocked) {
          onObjectBlocked(obj, result);
        }

        if (onBlockedObject === 'abort') {
          throw new Error(productionMode ? 'Object blocked' : `Object blocked: ${result.reason}`);
        }
      }
    }

    return { valid, blocked };
  };

  return {
    /**
     * Executes a query with full guardrails validation.
     *
     * @param options - Query options including className, fields, filters
     * @returns Query results with validation metadata
     */
    async query(options: WeaviateQueryOptions): Promise<GuardedWeaviateResult> {
      // Step 1: Validate class name
      if (!isClassAllowed(options.className)) {
        logger.warn('[Guardrails] Class not allowed', { className: options.className });
        if (onClassNotAllowed) onClassNotAllowed(options.className);
        throw new Error(productionMode ? 'Class not allowed' : `Class '${options.className}' is not allowed`);
      }

      // Step 2: Validate and sanitize fields
      let validatedFields = options.fields || [];
      if (allowedFields.length > 0) {
        validatedFields = validateFields(validatedFields);
        if (validatedFields.length === 0 && options.fields && options.fields.length > 0) {
          throw new Error(productionMode ? 'No fields allowed' : 'None of the requested fields are allowed');
        }
      }

      // Step 3: Validate query content (nearText, bm25, hybrid)
      let queryContent = '';
      if (options.nearText?.concepts) {
        queryContent = options.nearText.concepts.join(' ');
      } else if (options.bm25?.query) {
        queryContent = options.bm25.query;
      } else if (options.hybrid?.query) {
        queryContent = options.hybrid.query;
      }

      if (queryContent) {
        const result = await validateWithTimeout(queryContent, 'weaviate_query');
        if (!result.allowed) {
          logger.warn('[Guardrails] Query blocked', { reason: result.reason });
          if (onQueryBlocked) onQueryBlocked(result);
          throw new Error(productionMode ? 'Query blocked' : `Query blocked: ${result.reason}`);
        }
      }

      // Step 4: Validate filters
      if (options.where) {
        validateFilter(options.where);
      }

      // Step 5: Apply limit
      const limit = Math.min(options.limit || 10, maxLimit);

      // Step 6: Execute the query
      // Build the query chain
      let queryChain = weaviateClient.collections.get(options.className)
        .query()
        .withLimit(limit)
        .withFields(validatedFields.join(' '));

      // Apply nearText, bm25, or hybrid if specified
      if (options.nearText) {
        queryChain = queryChain.withNearText(options.nearText);
      } else if (options.bm25) {
        queryChain = queryChain.withBM25(options.bm25.query);
      } else if (options.hybrid) {
        queryChain = queryChain.withHybrid(options.hybrid.query, options.hybrid.alpha);
      }

      // Apply filter and execute
      let result;
      if (options.where) {
        result = await queryChain.withWhere(options.where);
      } else {
        result = await queryChain.do();
      }

      // Step 7: S012-009: Validate retrieved objects with robust response structure handling
      // Extract objects from various Weaviate response formats

      // Direct extraction: try all known formats
      const data = result.data as Record<string, unknown> | undefined;
      const className = options.className;
      let objects: any[] = [];

      // Check for v4 nested format: result.data[className].objects
      // This checks if data.Document exists and has an 'objects' property that is an array
      if (data && className in data) {
        const classData = data[className];
        if (classData && typeof classData === 'object' && !Array.isArray(classData) && classData !== null) {
          const objData = classData as Record<string, unknown>;
          const objectsValue = objData.objects;
          if (Array.isArray(objectsValue) && objectsValue.length > 0) {
            objects = objectsValue;
          }
        }
      }

      // Check for v4 flat format: result.data[className] is directly an array
      if (objects.length === 0 && data && className in data) {
        const classData = data[className];
        if (Array.isArray(classData) && classData.length > 0) {
          objects = classData;
        }
      }

      // Check for GraphQL Get format: result.data.Get[className]
      if (objects.length === 0 && data?.Get && typeof data.Get === 'object') {
        const getData = data.Get as Record<string, unknown>;
        if (className in getData) {
          const getValue = getData[className];
          if (Array.isArray(getValue) && getValue.length > 0) {
            objects = getValue;
          }
        }
      }

      // Check for legacy format: result.objects
      if (objects.length === 0 && 'objects' in result && result.objects && typeof result.objects === 'object') {
        const resultObjects = result.objects as unknown;
        if (Array.isArray(resultObjects) && resultObjects.length > 0) {
          objects = resultObjects;
        }
      }

      // Last resort: nested value extraction
      if (objects.length === 0) {
        // Try to get objects by using various path patterns
        const possiblePaths = [
          `data.${className}.objects`,
          `data.${className}`,
          `data.Get.${className}`,
          'objects',
        ];

        for (const path of possiblePaths) {
          try {
            const value = getNestedValue(result, path);
            if (Array.isArray(value) && value.length > 0) {
              objects = value;
              break;
            }
          } catch {
            // Ignore errors in path resolution
          }
        }
      }

      const { valid: validObjects, blocked } = await validateObjects(objects);

      return {
        data: {
          ...result.data,
          Get: {
            ...(result.data?.Get || {}),
            [options.className]: validObjects,
          },
        },
        objectsBlocked: blocked,
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
  GuardedWeaviateOptions,
  GuardedWeaviateResult,
  WeaviateQueryOptions,
  BlockedObjectHandling,
} from './types.js';
