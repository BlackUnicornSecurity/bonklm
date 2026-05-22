/**
 * @blackunicorn/bonklm-mem0
 * ========================
 * Mem0 memory-client connector for BonkLM.
 *
 * Public surface:
 *  - `wrapMem0Client(client, engine, options?)` — canonical-shape
 *    `wrap<Vendor>Client` factory per the connector-style ADR (shape #2).
 *  - `mem0Adapter` — the MemoryAdapter implementation (exposed for
 *    advanced callers building custom composition over memory-utils).
 *
 * Peer: `mem0ai ^3.0.0`.
 */
export { wrapMem0Client } from './wrap-mem0-client.js';
export { buildMem0Adapter, mem0Adapter } from './mem0-adapter.js';
export type { WrapMemoryClientOptions } from '@blackunicorn/bonklm-memory-utils';
export { ConnectorValidationError } from '@blackunicorn/bonklm/core/connector-utils';
