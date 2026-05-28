/**
 * Utility modules for the BonkLM Installation Wizard
 */

export { maskKey, maskKeyWithCustomLength, maskAllButLast, isMasked } from './mask.js';
export { SecureCredential } from './secure-credential.js';
export { WizardError, sanitizeError, ExitCode } from './error.js';
export type { ExitCodeType } from './error.js';
export { AuditLogger, createAuditEvent } from './audit.js';
export type { AuditAction, AuditEvent } from './audit.js';
export { validateApiKeySecure, clearValidationCache, getRateLimitStatus } from './validation.js';
export type { SecureValidationConfig } from './validation.js';

// Terminal capability detection
export {
  getTerminalCapabilities,
  getDetailedTerminalCapabilities,
  supportsColorLevel,
  getCursorControls,
  colorize,
  colors
} from './terminal.js';
export type { TerminalCapabilities, DetailedTerminalCapabilities, ColorLevel } from './terminal.js';

// Exit handling utilities
export { exit, exitWithError, exitSuccess, registerShutdownHandlers, withErrorHandling, isExiting } from './exit.js';
export type { ExitOptions } from './exit.js';
