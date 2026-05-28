/**
 * Pinecone Guardrail Connector
 * ============================
 *
 * Main entry point for @blackunicorn/bonklm-pinecone.
 *
 * @package @blackunicorn/bonklm-pinecone
 */

export { createGuardedIndex } from './guarded-pinecone.js';

export type { GuardedPineconeOptions, GuardedQueryResult, VectorQueryOptions } from './types.js';

// S012-002: Export connector-utils error classes
export {
  ConnectorValidationError,
  StreamValidationError,
  ConnectorConfigurationError,
  ConnectorTimeoutError
} from '@blackunicorn/bonklm/core/connector-utils';
