// SPDX-License-Identifier: Apache-2.0
/**
 * @blackunicorn/bonkdrant
 *
 * Qdrant connector for LLM-Guardrails.
 *
 * Provides security guardrails for Qdrant vector database operations
 * in RAG applications.
 *
 * @package @blackunicorn/bonkdrant
 */

export { createGuardedClient } from './guarded-qdrant.js';
export type {
  GuardedQdrantOptions,
  GuardedQdrantResult,
  QdrantSearchOptions,
  QdrantPoint,
  BlockedPointHandling
} from './types.js';

export { DEFAULT_VALIDATION_TIMEOUT, DEFAULT_MAX_LIMIT } from './types.js';
