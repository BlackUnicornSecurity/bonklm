// SPDX-License-Identifier: Apache-2.0
/**
 * @blackunicorn/bonklm-chroma
 *
 * ChromaDB connector for LLM-Guardrails.
 *
 * Provides security guardrails for ChromaDB vector database operations
 * in RAG applications.
 *
 * @package @blackunicorn/bonklm-chroma
 */

export { createGuardedCollection } from './guarded-chroma.js';
export type {
  GuardedChromaOptions,
  GuardedChromaQueryResult,
  ChromaQueryOptions,
  BlockedDocumentHandling
} from './types.js';

export { DEFAULT_VALIDATION_TIMEOUT, DEFAULT_MAX_N_RESULTS } from './types.js';
