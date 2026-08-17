// SPDX-License-Identifier: Apache-2.0
/**
 * @blackunicorn/bonkviate
 *
 * Weaviate connector for LLM-Guardrails.
 *
 * Provides security guardrails for Weaviate vector database operations
 * in RAG applications, executing queries through the `weaviate-client ^3`
 * API (`collection.query.nearText` / `bm25` / `hybrid` / `fetchObjects`).
 *
 * @package @blackunicorn/bonkviate
 */

export { createGuardedClient } from './guarded-weaviate.js';
export type { GuardedWeaviateClient } from './guarded-weaviate.js';
export type {
  GuardedWeaviateOptions,
  GuardedWeaviateResult,
  WeaviateQueryOptions,
  BlockedObjectHandling,
  WeaviateClientLike,
  WeaviateCollectionLike,
  WeaviateQueryNamespaceLike,
  WeaviateSearchOptions,
  WeaviateQueryResult,
  WeaviateRetrievedObject,
  WeaviateFilterValue,
  WeaviateFilterTarget,
  WeaviateFilterOperator
} from './types.js';

export { DEFAULT_VALIDATION_TIMEOUT, DEFAULT_MAX_LIMIT, DEFAULT_QUERY_LIMIT } from './types.js';
