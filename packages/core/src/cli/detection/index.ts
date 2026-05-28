/**
 * Detection Module Exports
 *
 * Exports all detection functionality for the wizard.
 */

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
