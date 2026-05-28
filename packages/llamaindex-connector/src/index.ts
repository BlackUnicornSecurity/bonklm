/**
 * LlamaIndex Guardrail Connector
 * ==============================
 *
 * Main entry point for @blackunicorn/bonklm-llamaindex.
 *
 * @package @blackunicorn/bonklm-llamaindex
 */

export { createGuardedQueryEngine, createGuardedRetriever } from './guarded-engine.js';

export type { GuardedLlamaIndexOptions, GuardedQueryResult, DocumentValidationResult } from './types.js';
