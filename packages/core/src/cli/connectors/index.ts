/**
 * Connector module exports
 *
 * This module re-exports all connector types, utilities, and registry for easy importing.
 */

export {
  type ConnectorCategory,
  type DetectionRules,
  type TestResult,
  type CredentialFormat,
  type ConnectorDefinition,
  isConnectorCategory,
  isTestResult,
  isConnectorDefinition,
  type z
} from './base.js';

export {
  getConnector,
  getAllConnectors,
  getConnectorsByCategory,
  hasConnector,
  getConnectorIds,
  getCategories
} from './registry.js';

// Export connector implementations
export { openaiConnector } from './implementations/openai.js';
export { anthropicConnector } from './implementations/anthropic.js';
export { ollamaConnector } from './implementations/ollama.js';
export { expressConnector } from './implementations/express.js';
export { langchainConnector } from './implementations/langchain.js';
