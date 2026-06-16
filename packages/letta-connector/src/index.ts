// SPDX-License-Identifier: Apache-2.0
/**
 * @blackunicorn/bonklm-letta
 * =========================
 * Letta (formerly MemGPT) memory-client connector for BonkLM.
 *
 * Public surface:
 *  - `wrapLettaClient(client, engine, options?)` — canonical ADR shape #2.
 *  - `buildLettaAdapter(getTenantId)` — adapter factory.
 *
 * Peer: `@letta-ai/letta-client ^1.11.0`.
 */
export { wrapLettaClient } from './wrap-letta-client.js';
export { buildLettaAdapter } from './letta-adapter.js';
export type { WrapMemoryClientOptions } from '@blackunicorn/bonklm-memory-utils';
export { ConnectorValidationError } from '@blackunicorn/bonklm/core/connector-utils';
