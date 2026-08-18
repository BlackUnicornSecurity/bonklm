/**
 * @blackunicorn/bonklm — Shadow Log Primitive
 * ============================================
 * Story 1.3b shadow-log primitive — Construct A from the
 * Story-1.8 scope-update v2 split path.
 *
 * Public surface:
 *  - `createShadowLog(adapter, options?)` — factory.
 *  - `createInMemoryShadowLogStorage()` — default in-memory adapter.
 *  - `computeContentHash` + `computeChainLinkHash` — exposed for
 *    consumers building custom adapters that need to validate hashes.
 *  - Types: `ShadowLog`, `ShadowLogEntry`, `ShadowLogAppendInput`,
 *    `ShadowLogStorageAdapter`, `VerifyChainResult`,
 *    `ShadowLogSourceTrust`, `ReadByRoomOptions`,
 *    `CreateShadowLogOptions`, `EvictionPolicy`.
 */
export { createShadowLog, computeContentHash, computeChainLinkHash } from './shadow-log.js';

export { createInMemoryShadowLogStorage } from './in-memory-adapter.js';

export type {
  CreateShadowLogOptions,
  EvictionPolicy,
  ReadByRoomOptions,
  ShadowLog,
  ShadowLogAppendInput,
  ShadowLogEntry,
  ShadowLogSourceTrust,
  ShadowLogStorageAdapter,
  VerifyChainResult
} from './types.js';
