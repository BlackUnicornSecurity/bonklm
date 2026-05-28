/**
 * @blackunicorn/bonklm-memory-utils
 * =================================
 * Shared memory-client wrapping primitives consumed by mem0/zep/letta
 * connectors.
 */
export { wrapMemoryClient, assertGetTenantIdValid, assertTenantIdSafe } from './wrap-memory-client.js';

export type {
  AdapterInvocation,
  AdapterRoute,
  GetTenantId,
  MemoryAdapter,
  MemorySessionContext,
  MemorySurface,
  WrapMemoryClientFullOptions,
  WrapMemoryClientOptions
} from './types.js';

// Re-export the core error class so consumers building custom adapters
// can match throws against it.
export { ConnectorValidationError } from '@blackunicorn/bonklm/core/connector-utils';
