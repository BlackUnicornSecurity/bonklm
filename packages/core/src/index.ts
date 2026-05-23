/**
 * BonkLM - Main Entry Point
 * =================================
 * Comprehensive LLM security guardrails for Node.js applications.
 *
 * @package @blackunicorn/bonklm
 *
 * ## API Surface Policy (v1.0-RC1 onwards)
 *
 * Every symbol re-exported from this barrel is **`@public`** —
 * frozen until v2.0 per SemVer. Removal or breaking-change of any
 * `@public` symbol requires a major version bump.
 *
 * Symbols prefixed `_` (e.g. `_testOnlyClearSentinel`,
 * `_resetFailOpenWarnState`) AND symbols NOT re-exported from this
 * barrel are **`@internal`** — may change in any minor / patch.
 *
 * Sprint 26 Story 4.7 API freeze. See
 * `docs/user/public-api-surface.md` for the full PUBLIC vs INTERNAL
 * catalog.
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
  ValidatorInstanceRule,
  LoggerInstanceRule,
  AttackLoggerInstanceRule,
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

// Story 2.1b-edge-core (iter-1 architect BLOCK-2): re-export the ALS
// canary guard from the root barrel so Node consumers (engine
// construction path, ElizaOS connector Phase-2) can import it without
// reaching into the `/edge` subpath. Edge consumers continue to import
// from `@blackunicorn/bonklm/edge` for the portable surface; both
// paths resolve to the SAME implementation.
export {
  assertAsyncLocalStorageHealthy,
  AsyncLocalStorageCanaryError,
} from './edge/als-canary.js';

// Story 1.3b — shadow log primitive. Edge-portable (uses Web Crypto
// for sha256). Default in-memory adapter ships in core; production
// adapters (Drizzle/PGlite for ElizaOS, Cloudflare DO for Story 3.8)
// live in their respective connector packages.
export {
  createShadowLog,
  createInMemoryShadowLogStorage,
  computeContentHash,
  computeChainLinkHash,
} from './shadow-log/index.js';
export type {
  CreateShadowLogOptions,
  EvictionPolicy,
  ReadByRoomOptions,
  ShadowLog,
  ShadowLogAppendInput,
  ShadowLogEntry,
  ShadowLogSourceTrust,
  ShadowLogStorageAdapter,
  VerifyChainResult,
} from './shadow-log/index.js';
