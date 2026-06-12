/**
 * Weaviate Guarded Wrapper Types
 * ===============================
 *
 * Type definitions for the Weaviate guardrails connector.
 *
 * The `Weaviate*` structural interfaces below mirror the exact subset of the
 * `weaviate-client ^3` surface the connector touches (verified against the
 * installed weaviate-client@3.11.0 typings). They are declared locally so the
 * package type-checks without the peer dependency installed; conformance with
 * the real client typings is locked at compile time by
 * `test-d/types.test-d.ts`.
 *
 * @package @blackunicorn/bonklm-weaviate
 */

import type { Guard, GuardrailResult, Logger, Validator } from '@blackunicorn/bonklm';
import type { RetrievedDocValidator } from '@blackunicorn/bonklm';

/**
 * Default validation timeout in milliseconds.
 *
 * @defaultValue 30000 (30 seconds)
 */
export const DEFAULT_VALIDATION_TIMEOUT = 30000;

/**
 * Default maximum number of results to retrieve.
 *
 * @defaultValue 50
 */
export const DEFAULT_MAX_LIMIT = 50;

/**
 * Default number of results requested when `limit` is omitted.
 *
 * @defaultValue 10
 */
export const DEFAULT_QUERY_LIMIT = 10;

/**
 * How to handle blocked objects in query results.
 */
export type BlockedObjectHandling = 'filter' | 'abort';

/**
 * The `weaviate-client ^3` filter operator union (mirrors the client's
 * `Operator` type, verified against weaviate-client@3.11.0).
 */
export type WeaviateFilterOperator =
  | 'Equal'
  | 'NotEqual'
  | 'GreaterThan'
  | 'GreaterThanEqual'
  | 'LessThan'
  | 'LessThanEqual'
  | 'Like'
  | 'IsNull'
  | 'WithinGeoRange'
  | 'ContainsAny'
  | 'ContainsAll'
  | 'ContainsNone'
  | 'And'
  | 'Or'
  | 'Not';

/**
 * Structural mirror of the `weaviate-client ^3` proto `FilterTarget`.
 *
 * Only `property` is declared statically (set by `byProperty(...)` /
 * `byId()` / time filters — including the `len(<property>)` length wrapper).
 * Cross-reference targets (`singleTarget` / `multiTarget` / `count`) exist on
 * the real proto type and pass through at runtime, where the connector's
 * structural validation handles them; they are intentionally not part of this
 * static subset.
 */
export interface WeaviateFilterTarget {
  /** Property name the filter applies to. */
  property?: string;
}

/**
 * Structural mirror of the `weaviate-client ^3` `FilterValue` tree, as
 * produced by `collection.filter.byProperty(...)`, `collection.filter.byId()`,
 * `Filters.and(...)`, `Filters.or(...)`, and `Filters.not(...)`.
 *
 * The connector validates this tree structurally (operator allowlist, node
 * key allowlist, target property checks, per-operator value typing, depth and
 * node-count caps) before forwarding it to the client.
 */
export interface WeaviateFilterValue {
  /** Child filters — present on `And` / `Or` / `Not` nodes. */
  filters?: WeaviateFilterValue[];
  /** PascalCase Weaviate operator (e.g. `'Equal'`, `'ContainsAny'`, `'And'`). */
  operator: WeaviateFilterOperator;
  /** Filter target — present on leaf nodes. */
  target?: WeaviateFilterTarget;
  /** Operand value; `null` on `And` / `Or` / `Not` nodes. */
  value: unknown;
}

/**
 * Structural mirror of a retrieved object as returned by `weaviate-client ^3`
 * query methods (`{ uuid, properties, metadata, references, vectors }`).
 *
 * Intentionally WIDER than the client's own object type (`metadata` /
 * `references` / `vectors` optional and `unknown`-typed): the connector
 * reads these defensively so a non-conforming client cannot crash it. Do
 * not tighten this to the client shape — the defensive read paths depend on
 * the widening.
 */
export interface WeaviateRetrievedObject {
  /** The UUID of the object. */
  uuid: string;
  /** The retrieved property map — the object's content. */
  properties: Record<string, unknown>;
  /** Returned metadata (distance, score, ...), when requested. */
  metadata?: unknown;
  /** Returned cross-references, when requested. */
  references?: unknown;
  /** Returned named vectors, when requested. */
  vectors?: unknown;
}

/**
 * Structural mirror of the `weaviate-client ^3` query return
 * (`WeaviateReturn`): the found objects live at the top level under
 * `objects` — there is no `data.Get` envelope in the v3 client.
 */
export interface WeaviateQueryResult {
  /** The objects that were found by the query. */
  objects: WeaviateRetrievedObject[];
}

/**
 * Search options the connector forwards to the client's query methods
 * (structural subset of the client's `SearchOptions` / `BaseHybridOptions`).
 */
export interface WeaviateSearchOptions {
  /** Maximum number of results. */
  limit?: number;
  /** Properties to return for each object. */
  returnProperties?: string[];
  /** Validated filter tree to apply to the query. */
  filters?: WeaviateFilterValue;
  /** Hybrid search only — balance between BM25 and vector search. */
  alpha?: number;
}

/**
 * Structural subset of the client's `collection.query` namespace the
 * connector calls. In `weaviate-client ^3`, `query` is a property exposing
 * one async method per search mode — there is no chained
 * `withX(...).do()` builder.
 */
export interface WeaviateQueryNamespaceLike {
  nearText(query: string | string[], opts?: WeaviateSearchOptions): Promise<WeaviateQueryResult>;
  bm25(query: string, opts?: WeaviateSearchOptions): Promise<WeaviateQueryResult>;
  hybrid(query: string, opts?: WeaviateSearchOptions): Promise<WeaviateQueryResult>;
  fetchObjects(opts?: WeaviateSearchOptions): Promise<WeaviateQueryResult>;
}

/**
 * Structural subset of a client collection handle.
 */
export interface WeaviateCollectionLike {
  /** The standard query namespace (`nearText` / `bm25` / `hybrid` / `fetchObjects`). */
  query: WeaviateQueryNamespaceLike;
}

/**
 * Structural subset of the `weaviate-client ^3` client instance the
 * connector consumes — anything exposing `collections.get(name)` returning a
 * collection handle with a v3 `query` namespace.
 */
export interface WeaviateClientLike {
  collections: {
    get(name: string): WeaviateCollectionLike;
  };
}

/**
 * Configuration options for the guarded Weaviate client wrapper.
 */
export interface GuardedWeaviateOptions {
  /**
   * Validators to apply to queries and retrieved objects.
   *
   * @defaultValue []
   */
  validators?: Validator[];

  /**
   * Guards to apply to retrieved content.
   *
   * @defaultValue []
   */
  guards?: Guard[];

  /**
   * Logger instance for debug/warning/error messages.
   *
   * @defaultValue console logger
   */
  logger?: Logger;

  /**
   * Whether to validate retrieved objects. Master switch: when `false`,
   * objects are returned unvalidated and any
   * {@link GuardedWeaviateOptions.retrievedDocValidator} is skipped.
   *
   * @defaultValue true
   */
  validateRetrievedObjects?: boolean;

  /**
   * How to handle blocked objects.
   *
   * @defaultValue 'filter'
   */
  onBlockedObject?: BlockedObjectHandling;

  /**
   * Use generic error messages in production mode.
   *
   * @defaultValue process.env.NODE_ENV === 'production'
   */
  productionMode?: boolean;

  /**
   * Maximum time to wait for validation (milliseconds).
   *
   * @defaultValue 30000
   */
  validationTimeout?: number;

  /**
   * Maximum number of results to allow per query.
   *
   * @defaultValue 50
   */
  maxLimit?: number;

  /**
   * Allowed collection (class) names (empty = all allowed).
   *
   * @defaultValue []
   *
   * @remarks
   * When specified, only these class names can be queried.
   * Supports wildcard patterns (e.g., 'Document*' matches 'Document', 'Documents', etc.)
   */
  allowedClasses?: string[];

  /**
   * Allowed field names (empty = all allowed).
   *
   * @defaultValue []
   *
   * @remarks
   * When specified, only these fields can be retrieved, and `where` filters
   * may only target these properties (include `_id` / `_creationTimeUnix` /
   * `_lastUpdateTimeUnix` to allow id/time filters; cross-reference filter
   * targets are rejected while an allowlist is configured).
   * Useful for restricting access to sensitive fields.
   */
  allowedFields?: string[];

  /**
   * Story 1.2 — opt-in batch retrieved-doc validator. Replaces the
   * per-object validation loop with a single batch call supporting the
   * `drop` / `block-all` / `redact` failure modes. NOT default-on.
   *
   * @remarks
   * Subordinate to {@link GuardedWeaviateOptions.validateRetrievedObjects}:
   * that flag is the master switch. With `validateRetrievedObjects: false`,
   * objects are returned unvalidated and this batch validator does NOT run.
   */
  retrievedDocValidator?: RetrievedDocValidator;

  /**
   * Whether to validate filter expressions.
   *
   * @defaultValue true
   */
  validateFilters?: boolean;

  /**
   * Callback when query is blocked.
   */
  onQueryBlocked?: (result: GuardrailResult) => void;

  /**
   * Callback when an object is blocked.
   */
  onObjectBlocked?: (object: WeaviateRetrievedObject, result: GuardrailResult) => void;

  /**
   * Callback when class is not allowed.
   */
  onClassNotAllowed?: (className: string) => void;
}

/**
 * Query options for the guarded `query()` facade.
 *
 * Specify at most one search mode (`nearText`, `bm25`, or `hybrid`); when
 * none is given the query is executed as a plain `fetchObjects` retrieval.
 */
export interface WeaviateQueryOptions {
  /**
   * Collection (class) name to query. Always validated structurally
   * (length and character checks) and, when `allowedClasses` is configured,
   * against the allowlist.
   */
  className: string;

  /**
   * Properties to retrieve (forwarded to the client as `returnProperties`).
   * Omit (or pass an empty array) to retrieve all non-reference properties.
   */
  fields?: string[];

  /**
   * Maximum number of results. Clamped to `[1, maxLimit]`.
   *
   * @defaultValue 10
   */
  limit?: number;

  /**
   * Semantic (vector) search over the given concepts.
   */
  nearText?: {
    concepts: string[];
  };

  /**
   * Keyword (BM25) search.
   */
  bm25?: {
    query: string;
  };

  /**
   * Hybrid search (BM25 + vector).
   */
  hybrid?: {
    query: string;
    alpha?: number;
  };

  /**
   * Filter for the query — a `weaviate-client ^3` `FilterValue` built with
   * `collection.filter.byProperty(...)` / `Filters.and(...)` / etc.
   * Validated structurally before being forwarded (see
   * {@link GuardedWeaviateOptions.validateFilters}).
   */
  where?: WeaviateFilterValue;
}

/**
 * Result from a guarded Weaviate query. Mirrors the real `weaviate-client ^3`
 * return shape (`{ objects }`) with guardrail metadata alongside.
 */
export interface GuardedWeaviateResult {
  /**
   * Retrieved objects that passed validation (blocked objects removed).
   */
  objects: WeaviateRetrievedObject[];

  /**
   * Number of objects blocked by guardrails.
   */
  objectsBlocked: number;

  /**
   * Whether any objects were blocked and filtered out.
   */
  filtered: boolean;

  /**
   * Raw, unfiltered result from Weaviate.
   *
   * SECURITY: `raw.objects` bypasses retrieved-object validation — blocked
   * objects are still present here. Read guarded content from
   * {@link GuardedWeaviateResult.objects}; reach for `raw` only when you
   * deliberately need the unvalidated client return.
   */
  raw: WeaviateQueryResult;
}
