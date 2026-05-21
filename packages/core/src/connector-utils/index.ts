/**
 * Connector Utilities
 * ===================
 *
 * Standard utilities for use across all connector packages.
 * Provides consistent error handling, content extraction, stream validation,
 * and logging patterns.
 *
 * @package @blackunicorn/bonklm/core
 *
 * @example
 * ```ts
 * import {
 *   ConnectorValidationError,
 *   StreamValidationError,
 *   extractContentFromResponse,
 *   validateBufferBeforeAccumulation,
 *   createStandardLogger,
 * } from '@blackunicorn/bonklm/core/connector-utils';
 * ```
 */

// Error classes
export {
  ConnectorValidationError,
  StreamValidationError,
  ConnectorConfigurationError,
  ConnectorTimeoutError,
} from './errors.js';

// Content extraction
export {
  extractContentFromResponse,
  extractContentFirstSuccess,
  extractContentJoined,
  type ContentExtractorOptions,
} from './content-extractor.js';

// Stream validation
export {
  validateBufferBeforeAccumulation,
  updateStreamValidatorState,
  shouldValidateStream,
  hasUnvalidatedTail,
  markStreamBlocked,
  resetStreamValidatorState,
  processStreamChunk,
  createStreamValidatorState,
  DEFAULT_MAX_BUFFER_SIZE,
  DEFAULT_VALIDATION_INTERVAL,
  DEFAULT_MIN_BUFFER_BEFORE_RELEASE,
  StreamValidator,
  type StreamValidationOptions,
  type StreamValidatorEngine,
  type StreamValidatorResult,
  type StreamValidatorReleaseResult,
  type StreamValidatorState,
} from './stream-validator.js';

// Story 1.1b — release-gate primitive (also reused by Story 3.1 audio).
export {
  BufferedReleaseGate,
  type BufferedReleaseGateConfig,
} from './buffered-release-gate.js';

// Logger utilities
export {
  createStandardLogger,
  createConnectorLogger,
  sanitizeLogMetadata,
  logValidationFailure,
  logTimeout,
  type StandardLoggerOptions,
} from './logger.js';

// Validation helpers
export { validatePositiveNumber } from './validation-helpers.js';
