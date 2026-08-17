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

// NOTE: the working-directory containment helper (`cli/utils/path.ts`
// `isPathWithinRoot`) is intentionally NOT re-exported here. It is an internal
// security primitive imported by direct path from its in-tree callers and tests;
// keeping it off this barrel prevents a future `package.json` `exports` subpath
// from promoting it onto the published surface (same rationale as
// `cli/commands/index.ts`). The same rationale applies to `error.ts`'s
// `redactCredentials`: an internal redaction primitive consumed by direct path
// (sanitizeError, the wizard's --json renderer) — only `sanitizeError` is on
// the barrel.

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
