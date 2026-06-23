/**
 * `@blackunicorn/bonklm/edge` — Edge-Runtime Surface
 * ===================================================
 * Story 2.1 Phase-1 ships the portable subset of BonkLM's core API
 * for Node-compatible edge runtimes — Cloudflare Workers (`workerd`)
 * with the `nodejs_compat` flag, Deno, and Bun — in addition to Node.
 *
 * Runtime-support caveat (important): this surface is NOT loadable on
 * the strict Vercel Edge Runtime (`edge-light`). Its codecs and most
 * validators use only Web Standard APIs, but the surface transitively
 * pulls a few Node built-ins:
 * - `node:fs` + `node:path` — via `common/index` (file-read /
 *   secret-detection + log helpers) and the bash-safety guard.
 * - `node:crypto` + `Buffer` — `GuardrailEngine` imports the internal
 *   `override-token` module (for `hashContent` / config parsing), which
 *   uses `createHmac` / `timingSafeEqual`.
 * Those built-ins are provided by `workerd` (`nodejs_compat`), Deno,
 * and Bun, but not by `edge-light`, so the `edge-light` export
 * condition is intentionally NOT declared for this subpath. A
 * genuinely Web-only (zero Node built-ins) edge surface is tracked for
 * a future release.
 *
 * Subpath usage:
 *
 * ```ts
 * // Cloudflare Worker (nodejs_compat) / Deno Deploy / Bun:
 * import {
 *   GuardrailEngine,
 *   PromptInjectionValidator,
 *   SecretGuard,
 * } from '@blackunicorn/bonklm/edge';
 * ```
 *
 * **What's exported**: every validator + guard + composite factory
 * + connector-utils helper that does NOT depend on Node-specific
 * APIs. The exports map (`workerd` / `deno` / `bun` / `import`) ensures
 * Workerd / Deno / Bun resolve to this file automatically; Node
 * consumers can opt in to the same edge subset by importing from
 * `@blackunicorn/bonklm/edge` explicitly for portability testing.
 *
 * **What's NOT exported** (Node-only, deferred to Phase-2):
 * - `HookSandbox` — uses `node:vm` + Node `EventEmitter`. Workerd
 *   has no `vm`; an edge variant of HookSandbox lands in Story 2.1
 *   Phase-2.
 * - `OverrideToken` HMAC validator — uses `node:crypto`'s `timingSafeEqual`
 *   + `Buffer`. The HMAC unified-async migration lands in Phase-2
 *   alongside the `validateToken` sync→async deprecation. (The
 *   validator symbol is not exported here, but `GuardrailEngine` still
 *   imports the `override-token` module internally, so `node:crypto` is
 *   present in the bundle — see the runtime-support caveat above.)
 * - `raw-upstream-cache` primitives (`runWithRawUpstreamCache` etc.) — use
 *   `node:async_hooks` (`AsyncLocalStorage`), which is not part of the strict
 *   edge subset. The `IndirectInjectionValidator` itself is edge-safe and IS
 *   exported below; only the ALS forward-cache is Node-only.
 *
 * @package @blackunicorn/bonklm/edge
 */

// Core engine + types.
export { GuardrailEngine } from '../engine/GuardrailEngine.js';
export type {
  GuardrailEngineConfig,
  Validator,
  Guard,
  ValidatorInput,
  HookSurface,
  ExecutionOrder,
  EngineResult,
  ValidatorResult,
  InterceptCallback
} from '../engine/GuardrailEngine.types.js';

// Base result types.
export {
  createResult,
  mergeResults,
  type Finding,
  type GuardrailResult,
  RiskLevel,
  Severity
} from '../base/GuardrailResult.js';
export { LogLevel, ConsoleLogger, createLogger, type Logger } from '../base/GenericLogger.js';

// Validators (post-Story-2.1 portable Buffer.from removal).
export {
  PromptInjectionValidator,
  validatePromptInjection,
  analyzePromptInjection
} from '../validators/prompt-injection.js';
export {
  detectPatterns,
  type PatternFinding,
  type PatternDefinition,
  ALL_PATTERN_CATEGORIES,
  WEB3_PREFERENCE_PATTERNS,
  TOOL_OUTPUT_IMPERSONATION_PATTERNS
} from '../validators/pattern-engine.js';
export { normalizeText, detectHiddenUnicode } from '../validators/text-normalizer.js';
export { JailbreakValidator } from '../validators/jailbreak.js';
export { ReformulationDetector } from '../validators/reformulation-detector.js';
export { BoundaryDetector } from '../validators/boundary-detector.js';
export { MultilingualDetector } from '../validators/multilingual-patterns.js';

// Composite validators (Stories 1.1 / 1.2 / 1.3 / 1.3a).
export { createToolCallArgsValidator } from '../validators/tool-call-args.js';
export type { ToolCallArgsValidatorConfig, ToolCallSerializer } from '../validators/tool-call-args.js';

export { createRetrievedDocValidator } from '../validators/retrieved-doc.js';
export type {
  PerDocFailureMode,
  RetrievedDoc,
  RetrievedDocBatchResult,
  RetrievedDocValidator,
  RetrievedDocValidatorConfig
} from '../validators/retrieved-doc.js';

export { createMemoryWriteValidator } from '../validators/memory-write.js';
export type {
  MemoryWriteMetadata,
  MemoryWritePayload,
  MemoryWriteResult,
  MemoryWriteValidator,
  MemoryWriteValidatorConfig,
  MemoryWriteFailureMode
} from '../validators/memory-write.js';

export { createComposedContextValidator } from '../validators/composed-context.js';
export type {
  ComposedContextValidator,
  ComposedContextValidatorConfig,
  ComposedContextBatchResult
} from '../validators/composed-context.js';

// Provenance-gated indirect-injection (D-065 §7-step-2.b). Edge-safe: pure regex
// + types, no Node built-ins. The raw-upstream-cache primitive is intentionally
// NOT re-exported here — it uses `node:async_hooks` (see "What's NOT exported").
export { IndirectInjectionValidator, createIndirectInjectionValidator } from '../validators/indirect-injection.js';
export type { IndirectInjectionConfig } from '../validators/indirect-injection.js';
// Shared composer for the connector-boundary indirect-injection arm — the ONE
// place the surface tag + append-ordering live (used by the four composite
// factories and the connector inbound tool-result paths).
export { appendIndirectInjectionArm, appendToolResultInjectionArm } from '../validators/indirect-injection-arm.js';
export { hasToolResultProvenance } from '../validators/provenance.js';
export type { Provenance, ToolResultRef, ProvenanceBoundary, ProvenanceSource } from '../validators/provenance.js';

// Shared validator helpers.
export {
  VALIDATOR_ERROR_CATEGORIES,
  applyRedaction,
  hasRedactContent,
  maxSeverity,
  riskFromScore,
  runValidatorChain,
  type RedactingValidator,
  type ValidatorErrorCategory
} from '../validators/validator-utils.js';

// Guards (Buffer.from removed where present, RedactingValidator parity).
export { SecretGuard } from '../guards/secret.js';
export { PIIGuard, detectPii } from '../guards/pii/index.js';
export { BashSafetyGuard } from '../guards/bash-safety.js';
export { XSSGuard } from '../guards/xss-safety.js';

// Stream validator + release gate.
export {
  StreamValidator,
  BufferedReleaseGate,
  applyRetrievedDocValidatorToMatches,
  BATCH_POS_PREFIX
} from '../connector-utils/index.js';
export type {
  StreamValidationOptions,
  StreamValidatorEngine,
  StreamValidatorResult,
  StreamValidatorReleaseResult,
  StreamValidatorState,
  BufferedReleaseGateConfig,
  ApplyRetrievedDocValidatorOptions
} from '../connector-utils/index.js';
export {
  ConnectorValidationError,
  StreamValidationError,
  logValidationFailure,
  logTimeout,
  sanitizeLogMetadata,
  stripLogControlChars
} from '../connector-utils/index.js';

// Story 2.1 portable codec helpers (also useful for connector
// authors building their own edge wrappers).
export { base64DecodeToUtf8, hexDecodeToUtf8, utf8ByteLength, portableRandomUUID } from '../common/edge-codec.js';

// Story 2.1b-edge-core: function-only HookManager variant + ALS canary
// guard + envBindings injection contract.
export {
  EdgeHookManager,
  type EdgeExecutionContext,
  type EdgeExecutionResult,
  type EdgeHookStatistics
} from '../hooks/EdgeHookManager.js';
export { assertAsyncLocalStorageHealthy, AsyncLocalStorageCanaryError } from './als-canary.js';
export { isProductionEnvironment, isTestEnvironment, type EnvBindings } from '../guards/production.js';

// Story 1.3b — shadow log primitive (edge-portable, uses Web Crypto).
export {
  createShadowLog,
  createInMemoryShadowLogStorage,
  computeContentHash,
  computeChainLinkHash
} from '../shadow-log/index.js';
export type {
  CreateShadowLogOptions,
  EvictionPolicy,
  ReadByRoomOptions,
  ShadowLog,
  ShadowLogAppendInput,
  ShadowLogEntry,
  ShadowLogSourceTrust,
  ShadowLogStorageAdapter,
  VerifyChainResult
} from '../shadow-log/index.js';
