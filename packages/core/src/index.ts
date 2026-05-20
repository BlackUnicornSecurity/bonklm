/**
 * BonkLM - Main Entry Point
 * =================================
 * Comprehensive LLM security guardrails for Node.js applications.
 *
 * @package @blackunicorn/bonklm
 */

// Base types and utilities
export * from './base/index.js';

// Validators
export * from './validators/index.js';

// Guards
export * from './guards/index.js';

// Session tracking
export * from './session/index.js';

// Hooks
export * from './hooks/index.js';

// Adapters
export * from './adapters/index.js';

// Engine
export * from './engine/index.js';

// Common utilities
export * from './common/index.js';

// Telemetry
export * from './telemetry/index.js';

// Fault tolerance
export * from './fault-tolerance/index.js';

// Configuration validation
export {
  Schema,
  NumberRangeRule,
  TypeRule,
  EnumRule,
  FunctionRule,
  ArrayRule,
  ObjectRule,
  OptionalRule,
  CustomRule,
  ConfigValidationError,
  Validators,
  type ConfigValidationResult,
  type ValidationRule,
} from './validation/index.js';

// Enhanced logging
export {
  MonitoringLogger,
  createMonitoringLogger,
  MonitoringLogLevel,
  type LogEntry,
  type MetricsData,
  type MonitoringLoggerOptions,
} from './logging/index.js';

// S011-006: Security utilities
export {
  OverrideTokenValidator,
  TokenScope,
  createOverrideTokenValidator,
  getOverrideTokenSecret,
  hashContent,
  parseOverrideTokenConfig,
  type OverrideTokenConfig,
  type TokenValidationResult,
  type TokenUsage,
  type OverrideTokenConfigString,
} from './security/index.js';

// S012-000: Connector utilities
export {
  ConnectorValidationError,
  StreamValidationError,
  ConnectorConfigurationError,
  ConnectorTimeoutError,
  extractContentFromResponse,
  extractContentFirstSuccess,
  extractContentJoined,
  validateBufferBeforeAccumulation,
  updateStreamValidatorState,
  shouldValidateStream,
  hasUnvalidatedTail,
  markStreamBlocked,
  resetStreamValidatorState,
  processStreamChunk,
  createStreamValidatorState,
  StreamValidator,
  createStandardLogger,
  createConnectorLogger,
  sanitizeLogMetadata,
  logValidationFailure,
  logTimeout,
  DEFAULT_MAX_BUFFER_SIZE,
  DEFAULT_VALIDATION_INTERVAL,
  type ContentExtractorOptions,
  type StreamValidationOptions,
  type StreamValidatorEngine,
  type StreamValidatorResult,
  type StreamValidatorState,
  type StandardLoggerOptions,
} from './connector-utils/index.js';
