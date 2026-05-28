/**
 * @blackunicorn/bonklm-weaviate
 *
 * Weaviate connector for LLM-Guardrails.
 *
 * Provides security guardrails for Weaviate vector database operations
 * in RAG applications.
 *
 * @package @blackunicorn/bonklm-weaviate
 */

export { createGuardedClient } from './guarded-weaviate.js';
export type {
  GuardedWeaviateOptions,
  GuardedWeaviateResult,
  WeaviateQueryOptions,
  BlockedObjectHandling
} from './types.js';

export { DEFAULT_VALIDATION_TIMEOUT, DEFAULT_MAX_LIMIT } from './types.js';
