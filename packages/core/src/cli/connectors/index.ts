/**
 * Connector module exports
 *
 * This module re-exports all connector types, utilities, and registry for easy importing.
 */

export {
  type ConnectorCategory,
  CONNECTOR_CATEGORIES,
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
  getCategories,
  type DetectionSignal,
  getDetectionPackages,
  getDetectionEnvVars,
  getDetectionPorts,
  getDetectionDockerPatterns
} from './registry.js';

// Declarative connector descriptors + the catalog they populate the registry from
export {
  type ConnectorDescriptor,
  type DescriptorCredential,
  type DescriptorProbe,
  defineConnector
} from './descriptor.js';
export { CONNECTOR_CATALOG } from './catalog/index.js';
export { isOptionalEnvVar, validateCredentialFormat } from './credential-format.js';

// Export connector implementations
export { openaiConnector } from './implementations/openai.js';
export { anthropicConnector } from './implementations/anthropic.js';
export { ollamaConnector } from './implementations/ollama.js';
export { expressConnector } from './implementations/express.js';
export { langchainConnector } from './implementations/langchain.js';
