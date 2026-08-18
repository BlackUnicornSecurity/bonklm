/**
 * Detection Module Exports
 *
 * Exports all detection functionality for the wizard.
 */

// Project dependency reader (shared hardened package.json read)
export {
  type ProjectDependencies,
  type ProjectDepsOptions,
  MAX_PACKAGE_JSON_SIZE,
  readProjectDependencies,
  lookupDependency
} from './project-deps.js';

// TCP port reachability (shared by service detection and the connector tcp probe)
export { DEFAULT_PORT_TIMEOUT, checkPort, isValidHost, isValidPort } from './port.js';

// Framework Detection
export {
  type DetectedFramework,
  type FrameworkId,
  type FrameworkDetectionOptions,
  detectFrameworks,
  isFrameworkDetected,
  getFrameworkVersion
} from './framework.js';

// Service Detection
export { type DetectedService, detectServices, isOllamaAvailable, getVectorDbContainers } from './services.js';

// Timeout Wrapper
export { type DetectionPhase, DETECTION_TIMEOUTS, detectWithTimeout, createTimeoutPromise } from './timeout.js';

// Credential Detection
export {
  type DetectedCredential,
  type CredentialName,
  detectCredentials,
  isCredentialPresent,
  getCredentialMasked,
  getPresentCredentials,
  getSupportedCredentialNames
} from './credentials.js';
