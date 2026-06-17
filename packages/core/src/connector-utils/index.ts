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
  ConnectorTimeoutError
} from './errors.js';

// Content extraction
export {
  extractContentFromResponse,
  extractContentFirstSuccess,
  extractContentJoined,
  type ContentExtractorOptions
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
  type StreamValidatorState
} from './stream-validator.js';

// Story 1.1b — release-gate primitive (also reused by Story 3.1 audio).
export { BufferedReleaseGate, type BufferedReleaseGateConfig } from './buffered-release-gate.js';

// D-058 (EPIC 1.1.3-B) — validate-before-release gate for structured-chunk
// connectors. Holds native chunks until StreamValidator.processForClient /
// finalizeForClient clears their text, then forwards the ORIGINAL chunks in
// order. Lets streaming connectors opt into the client-safe lifecycle without
// re-framing structured output to text.
export { ClientSafeStreamGate, type ClientSafeGateResult, type ClientSafeStreamOptions } from './client-safe-stream.js';

// Cumulative-audit extraction — shared retrieved-doc batch helper
// (consolidates the 1D vector-DB retrofit pattern from 4 connectors).
export {
  applyRetrievedDocValidatorToMatches,
  BATCH_POS_PREFIX,
  type ApplyRetrievedDocValidatorOptions
} from './retrieved-doc-batch.js';

// Sprint 20 audit closure — shared validator-adapter for connectors
// routing through cachedValidate (restate + temporal initially; Sprint
// 21+ for other durable-execution + replay-aware connectors).
export {
  adaptValidatorToUniversalInput,
  extractStringContent,
  type ValidatorInputCapability
} from './adapt-validator.js';

// Sprint 22 audit closure (architect C2 + code-reviewer C-4) — shared
// wrap-sentinel for double-wrap defence across connectors. Replaces
// the 5x verbatim Symbol-watermark copy across livekit-connector +
// document-ingest + cloudflare-agents-connector + inference-providers.
export { assertNotWrapped, markWrapped, ensureWrappedOnce } from './wrap-sentinel.js';

// Logger utilities
export {
  createStandardLogger,
  createConnectorLogger,
  sanitizeLogMetadata,
  sanitizeMeta,
  stripLogControlChars,
  logValidationFailure,
  logTimeout,
  type StandardLoggerOptions
} from './logger.js';

// Validation helpers
export { validatePositiveNumber, normalizeLimit, type NormalizeLimitOptions } from './validation-helpers.js';

// Sprint 14 cumulative PB-6 closure: sanitizeReasonText canonical home.
// (Browser-agents-core retains its own export for back-compat; new
// connectors should import from this subpath to avoid a server-side
// runtime dep on a browser-named package.)
export { sanitizeReasonText } from './sanitize.js';

// Sprint 30 — SEC-008 canonical timeout primitive. Replaces the broken
// AbortController-without-signal pattern duplicated across 20+ connectors
// (Sprint 29 architect-CRITICAL audit). All connector timeout impls MUST
// route through this helper; do not roll your own.
export { validateWithTimeoutSecure, type ValidateWithTimeoutOptions } from './timeout-wrapper.js';
