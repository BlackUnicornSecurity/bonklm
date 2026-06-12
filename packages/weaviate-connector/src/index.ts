/**
 * @blackunicorn/bonklm-weaviate
 *
 * Weaviate connector for LLM-Guardrails.
 *
 * Provides security guardrails for Weaviate vector database operations
 * in RAG applications.
 *
 * @experimental
 *
 * @remarks
 * PREVIEW — this connector is not yet wired to its `weaviate-client ^3` peer dependency and will not
 * run against a live Weaviate instance yet. Its API and response shapes are a preview and will
 * change. See `createGuardedClient` and the package README before adopting it.
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
