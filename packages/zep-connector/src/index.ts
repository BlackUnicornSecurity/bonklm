/**
 * @blackunicorn/bonklm-zep
 * =======================
 * Zep memory-client connector for BonkLM.
 *
 * Public surface:
 *  - `wrapZepClient(client, engine, options?)` — canonical-shape
 *    factory wrapping BOTH `thread.*` and `graph.*` namespaces under
 *    one Proxy. Memory writes (addMessages, graph.add) fire
 *    `memory_write`; recall paths (getUserContext, graph.search) fire
 *    `composed_context` post-call.
 *  - `buildZepAdapter(getTenantId)` — the MemoryAdapter factory
 *    (advanced callers building custom composition).
 *
 * Peer: `@getzep/zep-cloud ^3.0.0`.
 *
 * **`wrapZepGraphRetriever` is NOT exported** — the graph-as-retrieved-docs
 * separate-factory pattern is documented as illustrative-only in
 * `docs/user/connector-style-guide.md` and not implemented in Story 2.5.
 */
export { wrapZepClient } from './wrap-zep-client.js';
export { buildZepAdapter } from './zep-adapter.js';
export type { WrapMemoryClientOptions } from '@blackunicorn/bonklm-memory-utils';
export { ConnectorValidationError } from '@blackunicorn/bonklm/core/connector-utils';
