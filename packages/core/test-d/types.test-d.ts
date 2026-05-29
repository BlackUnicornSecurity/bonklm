/**
 * tsd type-surface suite — @blackunicorn/bonklm (ST-04-251).
 *
 * The largest public surface in the repo. Imports by package name so it
 * resolves the package `types` entry exactly as a consumer would, and
 * proves every signature rejects misuse.
 *
 * Scope — locks the curated consumer-facing surface re-exported from the
 * main barrel (`dist/index.d.ts`): the result/logger primitives, the
 * engine + cached-validator surface, every first-class validator and
 * guard (classes + their `validate`/`analyze` returns + the standalone
 * fns), the batch-validator factories, the hook manager, the telemetry
 * trace + block-event guard, the fault-tolerance pair, the config-schema
 * surface, the monitoring logger, the security (override-token +
 * rate-limiter) surface, the connector-utils error/stream/timeout
 * surface, the edge ALS canary, the shadow-log surface, and
 * `serializeError`.
 *
 * Deliberately NOT locked (documented in the batch evidence doc) — the
 * `@internal` / long-tail surface that ships from the barrel but is not
 * part of the curated consumer contract: the TelemetryService family,
 * the low-level `detect*` / `check*` finding-array helpers, the
 * pattern-engine / text-normalizer internals, the connector-utils
 * stream-state mutators + standard loggers, the PII `validators` /
 * `patterns` sub-exports, `SecureCredential`, the session-tracker
 * family, the adapter registry/base plumbing, the validator-chain
 * utils, the edge hook-sandbox / hook-manager internals, and the
 * per-kind block-event interfaces (the union is locked structurally
 * instead).
 *
 * Run via `pnpm exec tsd`. Lives in test-d/ (tsd's default dir).
 */
import { expectType, expectError, expectAssignable, expectNotAssignable } from 'tsd';
import {
  // base — result + logger + config
  Severity,
  RiskLevel,
  createResult,
  mergeResults,
  LogLevel,
  ConsoleLogger,
  NullLogger,
  createLogger,
  DEFAULT_CONFIG,
  mergeConfig,
  getRiskThreshold,
  // engine
  GuardrailEngine,
  validateWithEngine,
  cachedValidate,
  canonicalJSONStringify,
  createSaltedKeyFn,
  createUnsaltedKeyFn,
  defaultKeyFn,
  DEFAULT_CACHE_NAMESPACE,
  DEFAULT_TTL_MS,
  IN_MEMORY_TTL_CEILING_MS,
  InMemoryLRUCache,
  // validators
  PromptInjectionValidator,
  validatePromptInjection,
  analyzePromptInjection,
  JailbreakValidator,
  validateJailbreak,
  analyzeJailbreak,
  ReformulationDetector,
  validateReformulation,
  analyzeReformulation,
  BoundaryDetector,
  detectBoundaryManipulation,
  detectBoundary,
  MultilingualDetector,
  detectMultilingualInjection,
  detectMultilingual,
  createToolCallArgsValidator,
  createRetrievedDocValidator,
  createMemoryWriteValidator,
  createComposedContextValidator,
  AudioStreamValidator,
  AUDIO_STREAM_SURFACE,
  MAX_AUDIO_STREAM_PATTERNS,
  MAX_AUDIO_STREAM_NEEDLE_LENGTH,
  DEFAULT_AUDIO_STREAM_PATTERNS,
  DEFAULT_COMPOSED_CONTEXT_SOFT_CAP_BYTES,
  DEFAULT_COMPOSED_CONTEXT_HARD_CAP_BYTES,
  CodeInjectionValidator,
  CodeInjectionCategory,
  PathTraversalValidator,
  // guards
  SecretGuard,
  validateSecrets,
  BashSafetyGuard,
  checkBashSafety,
  ProductionGuard,
  checkProduction,
  isProductionEnvironment,
  isTestEnvironment,
  XSSGuard,
  detectXSS,
  checkXSS,
  getXSSReport,
  PIIGuard,
  checkPII,
  // hooks
  HookManager,
  HookPhase,
  createBlockingHook,
  createTransformHook,
  DEFAULT_HOOK_SURFACE,
  // telemetry
  bonklmTrace,
  isBonklmBlockEvent,
  // fault-tolerance
  CircuitBreaker,
  createCircuitBreaker,
  CircuitBreakerOpenError,
  CircuitState,
  RetryPolicy,
  createRetryPolicy,
  // validation (config schema)
  Schema,
  Validators,
  ConfigValidationError,
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
  // logging
  MonitoringLogger,
  createMonitoringLogger,
  MonitoringLogLevel,
  // security
  OverrideTokenValidator,
  TokenScope,
  createOverrideTokenValidator,
  getOverrideTokenSecret,
  hashContent,
  parseOverrideTokenConfig,
  RateLimiter,
  createRateLimiter,
  CommonRateLimiters,
  DEFAULT_RATE_LIMIT,
  // connector-utils
  ConnectorValidationError,
  StreamValidationError,
  ConnectorConfigurationError,
  ConnectorTimeoutError,
  StreamValidator,
  DEFAULT_MAX_BUFFER_SIZE,
  DEFAULT_VALIDATION_INTERVAL,
  validateWithTimeoutSecure,
  // edge
  assertAsyncLocalStorageHealthy,
  AsyncLocalStorageCanaryError,
  // shadow-log
  createShadowLog,
  createInMemoryShadowLogStorage,
  computeContentHash,
  computeChainLinkHash,
  // common
  serializeError,
  // ---- types ----
  type Finding,
  type GuardrailResult,
  type ValidationResult,
  type Logger,
  type LogContext,
  type SensitivityLevel,
  type ActionMode,
  type ValidatorConfig,
  type PromptInjectionConfig,
  type JailbreakConfig,
  type HookSurface,
  type Validator,
  type ValidatorInput,
  type ValidatorResult,
  type Guard,
  type ExecutionOrder,
  type GuardrailEngineConfig,
  type EngineResult,
  type InterceptCallback,
  type ValidatorCache,
  type KeyFn,
  type CachedValidatorResult,
  type CachedValidateOptions,
  type InMemoryLRUCacheOptions,
  type CachedValidateLogger,
  type PromptInjectionAnalysisResult,
  type JailbreakAnalysisResult,
  type ReformulationAnalysisResult,
  type BoundaryFinding,
  type BoundaryDetectorConfig,
  type MultilingualFinding,
  type MultilingualDetectorConfig,
  type CodeInjectionValidatorConfig,
  type PathTraversalValidatorConfig,
  type AudioStreamValidatorConfig,
  type AudioStreamPartialResult,
  type AudioStreamResetReport,
  type AudioStreamPattern,
  type AudioStreamSeverity,
  type AudioStreamCategory,
  type ToolCallArgsValidatorConfig,
  type ToolCallSerializer,
  type RetrievedDoc,
  type RetrievedDocValidatorConfig,
  type RetrievedDocBatchResult,
  type RetrievedDocValidator,
  type PerDocFailureMode,
  type MemoryWritePayload,
  type MemoryWriteValidatorConfig,
  type MemoryWriteResult,
  type MemoryWriteValidator,
  type MemoryWriteFailureMode,
  type ComposedContextValidatorConfig,
  type ComposedContextBatchResult,
  type ComposedContextValidator,
  type BashSafetyConfig,
  type ProductionGuardConfig,
  type EnvBindings,
  type XSSGuardConfig,
  type XSSDetectionResult,
  type PIIGuardConfig,
  type PiiDetection,
  type PiiSeverity,
  type HookContext,
  type HookHandler,
  type HookExecution,
  type HookResult,
  type HookDefinition,
  type HookManagerConfig,
  type BonklmTraceSurface,
  type BonklmTraceAction,
  type BonklmTraceOptions,
  type BonklmTracer,
  type BonklmSpan,
  type BonklmSpanOptions,
  type BonklmBlockEvent,
  type BonklmBlockEventKind,
  type BonklmBlockEventBase,
  type CircuitBreakerConfig,
  type CircuitBreakerStats,
  type CircuitBreakerListeners,
  type RetryConfig,
  type RetryResult,
  type RetryAttemptOptions,
  type ConfigValidationResult,
  type ValidationRule,
  type LogEntry,
  type MetricsData,
  type MonitoringLoggerOptions,
  type OverrideTokenConfig,
  type TokenValidationResult,
  type TokenUsage,
  type OverrideTokenConfigString,
  type RateLimiterConfig,
  type RateLimitResult,
  type StreamValidationOptions,
  type StreamValidatorState,
  type StreamValidatorEngine,
  type StreamValidatorResult,
  type ValidateWithTimeoutOptions,
  type CreateShadowLogOptions,
  type EvictionPolicy,
  type ReadByRoomOptions,
  type ShadowLog,
  type ShadowLogAppendInput,
  type ShadowLogEntry,
  type ShadowLogSourceTrust,
  type ShadowLogStorageAdapter,
  type VerifyChainResult,
  type SerializedError
} from '@blackunicorn/bonklm';

declare const result: GuardrailResult;
declare const finding: Finding;
declare const validator: Validator;
declare const guard: Guard;
declare const logger: Logger;
declare const input: ValidatorInput;
declare const cache: ValidatorCache;
declare const keyFn: KeyFn;
declare const cachedLogger: CachedValidateLogger;
declare const cvr: CachedValidatorResult;
declare const tracer: BonklmTracer;
declare const blockEvent: BonklmBlockEvent;
declare const streamEngine: StreamValidatorEngine;
declare const adapter: ShadowLogStorageAdapter;
declare const piiDetection: PiiDetection;

// --- base: Severity / RiskLevel / Finding / GuardrailResult -----------------
expectAssignable<Severity>(Severity.INFO);
expectAssignable<Severity>(Severity.WARNING);
expectAssignable<Severity>(Severity.BLOCKED);
expectAssignable<Severity>(Severity.CRITICAL);
expectNotAssignable<Severity>('blocked'); // string-enum: raw string not assignable
expectAssignable<RiskLevel>(RiskLevel.LOW);
expectAssignable<RiskLevel>(RiskLevel.MEDIUM);
expectAssignable<RiskLevel>(RiskLevel.HIGH);
expectNotAssignable<RiskLevel>('LOW');

expectType<GuardrailResult>(createResult(true));
expectType<GuardrailResult>(createResult(false, Severity.BLOCKED, [finding]));
expectError(createResult()); // allowed required
expectType<GuardrailResult>(mergeResults());
expectType<GuardrailResult>(mergeResults(result, result));

expectAssignable<Finding>({ category: 'c', severity: Severity.INFO, description: 'd' });
expectAssignable<Finding>({
  category: 'c',
  severity: Severity.BLOCKED,
  description: 'd',
  pattern_name: 'p',
  weight: 1,
  match: 'm',
  line_number: 3,
  confidence: 'high'
});
expectNotAssignable<Finding>({ category: 'c', severity: Severity.INFO }); // description required
expectNotAssignable<Finding>({ category: 'c', severity: Severity.INFO, description: 'd', confidence: 'maybe' });

expectAssignable<GuardrailResult>({
  allowed: true,
  blocked: false,
  severity: Severity.INFO,
  risk_level: RiskLevel.LOW,
  risk_score: 0,
  findings: [],
  timestamp: 0
});
expectNotAssignable<GuardrailResult>({ allowed: true }); // missing required fields
expectAssignable<ValidationResult>({
  allowed: true,
  blocked: false,
  severity: Severity.INFO,
  risk_level: RiskLevel.LOW,
  risk_score: 0,
  findings: [],
  timestamp: 0,
  validator_name: 'v'
});
expectNotAssignable<ValidationResult>(result); // missing validator_name

// --- base: Logger surface ---------------------------------------------------
expectAssignable<LogLevel>(LogLevel.DEBUG);
expectAssignable<Logger>({ debug() {}, info() {}, warn() {}, error() {} });
expectNotAssignable<Logger>({ debug() {}, info() {}, warn() {} }); // error required
expectAssignable<LogContext>({ anything: 1, nested: { a: 'b' } });
const consoleLogger = new ConsoleLogger();
new ConsoleLogger(LogLevel.WARN);
expectAssignable<Logger>(consoleLogger);
expectType<void>(consoleLogger.info('msg'));
expectType<void>(consoleLogger.error('msg', { k: 'v' }));
expectAssignable<Logger>(new NullLogger());
expectType<Logger>(createLogger());
expectType<Logger>(createLogger('console', LogLevel.INFO));
expectType<Logger>(createLogger('custom', LogLevel.INFO, logger));
expectError(createLogger('bogus')); // 'console' | 'null' | 'custom'

// --- base: ValidatorConfig + DEFAULT_CONFIG + mergeConfig --------------------
expectAssignable<SensitivityLevel>('strict');
expectAssignable<SensitivityLevel>('standard');
expectAssignable<SensitivityLevel>('permissive');
expectNotAssignable<SensitivityLevel>('paranoid');
expectAssignable<ActionMode>('block');
expectAssignable<ActionMode>('sanitize');
expectAssignable<ActionMode>('log');
expectAssignable<ActionMode>('allow');
expectNotAssignable<ActionMode>('warn');
expectAssignable<ValidatorConfig>({});
expectAssignable<ValidatorConfig>({ sensitivity: 'strict', action: 'block', enabled: true });
expectNotAssignable<ValidatorConfig>({ sensitivity: 'bogus' });
expectAssignable<PromptInjectionConfig>({});
expectAssignable<JailbreakConfig>({});
expectType<number>(getRiskThreshold('strict'));
expectError(getRiskThreshold('bogus')); // SensitivityLevel only
expectAssignable<ValidatorConfig>(mergeConfig({ sensitivity: 'strict' }));
expectType<Required<Pick<ValidatorConfig, 'sensitivity' | 'action' | 'enabled' | 'logLevel' | 'includeFindings'>>>(
  DEFAULT_CONFIG
);

// --- engine: GuardrailEngine class ------------------------------------------
const engine = new GuardrailEngine();
new GuardrailEngine({
  validators: [validator],
  guards: [guard],
  shortCircuit: true,
  executionOrder: 'parallel',
  logger
});
expectType<string>(engine.getInstanceId());
expectType<Promise<EngineResult>>(engine.validate('content'));
expectType<Promise<EngineResult>>(engine.validate('content', 'context'));
expectType<Promise<EngineResult>>(engine.validateInput(input));
expectType<void>(engine.addValidator(validator));
expectType<void>(engine.addGuard(guard));
expectType<boolean>(engine.removeValidator('name'));
expectType<boolean>(engine.removeGuard('name'));
expectType<Validator[]>(engine.getValidators());
expectType<Guard[]>(engine.getGuards());
expectType<boolean>(engine.isCircuitBreakerOpen());
expectType<void>(engine.onIntercept((_res, _ctx) => {}));
expectType<{
  validatorCount: number;
  guardCount: number;
  shortCircuit: boolean;
  executionOrder: ExecutionOrder;
  sensitivity: string;
  action: string;
}>(engine.getStats());
expectType<Promise<EngineResult>>(validateWithEngine('content'));
expectType<Promise<EngineResult>>(validateWithEngine('content', { sensitivity: 'strict' }));
expectError(validateWithEngine()); // content required

// --- engine: shared types ---------------------------------------------------
expectAssignable<HookSurface>('text_input');
expectAssignable<HookSurface>('audio_partial');
expectAssignable<HookSurface>('composed_context');
expectNotAssignable<HookSurface>('bogus');
expectAssignable<ExecutionOrder>('sequential');
expectAssignable<ExecutionOrder>('parallel');
expectNotAssignable<ExecutionOrder>('random');
expectAssignable<Validator>({ validate: () => result });
expectAssignable<Validator>({ validate: async () => result, name: 'v' });
expectNotAssignable<Validator>({}); // validate required
expectAssignable<Guard>({ validate: () => result });
expectAssignable<Guard>({ validate: (_content: string, _context?: string) => result, name: 'g' });

expectAssignable<ValidatorInput>({ kind: 'text', content: 'x' });
expectAssignable<ValidatorInput>({ kind: 'tool_call', toolName: 't', args: {} });
expectAssignable<ValidatorInput>({ kind: 'retrieved_docs', docs: [{ content: 'd' }] });
expectAssignable<ValidatorInput>({ kind: 'memory_write', payload: { content: 'c' } });
expectAssignable<ValidatorInput>({ kind: 'composed_context', entries: ['a'] });
expectAssignable<ValidatorInput>({ kind: 'audio_partial', content: 'a', isFinal: true });
expectNotAssignable<ValidatorInput>({ kind: 'text' }); // content required
expectNotAssignable<ValidatorInput>({ kind: 'bogus' }); // not a kind

expectAssignable<GuardrailEngineConfig>({});
expectAssignable<GuardrailEngineConfig>({
  validators: [validator],
  guards: [guard],
  shortCircuit: true,
  executionOrder: 'parallel',
  logger,
  sensitivity: 'strict',
  action: 'block',
  validationTimeout: 1000
});
expectNotAssignable<GuardrailEngineConfig>({ executionOrder: 'bogus' });
expectNotAssignable<GuardrailEngineConfig>({ shortCircuit: 'yes' });

expectNotAssignable<ValidatorResult>(result); // missing validatorName
expectAssignable<ValidatorResult>({
  allowed: true,
  blocked: false,
  severity: Severity.INFO,
  risk_level: RiskLevel.LOW,
  risk_score: 0,
  findings: [],
  timestamp: 0,
  validatorName: 'v'
});
expectNotAssignable<EngineResult>(result); // missing engine fields
expectAssignable<EngineResult>({
  allowed: true,
  blocked: false,
  severity: Severity.INFO,
  risk_level: RiskLevel.LOW,
  risk_score: 0,
  findings: [],
  timestamp: 0,
  results: [],
  validatorCount: 0,
  guardCount: 0,
  executionTime: 0
});
expectAssignable<InterceptCallback>((_res, _ctx) => {});
expectAssignable<InterceptCallback>(async (_res, _ctx) => {});

// --- engine: cached-validator -----------------------------------------------
expectType<Promise<CachedValidatorResult[]>>(cachedValidate([validator], input));
expectType<Promise<CachedValidatorResult[]>>(cachedValidate([validator], input, cache));
expectType<Promise<CachedValidatorResult[]>>(cachedValidate([validator], input, { cache, defaultTtlMs: 1000 }));
expectError(cachedValidate([validator])); // input required
expectType<KeyFn>(defaultKeyFn);
expectType<KeyFn>(createSaltedKeyFn('instance-id'));
expectType<KeyFn>(createUnsaltedKeyFn());
expectType<string>(canonicalJSONStringify({ a: 1 }));
expectType<'@blackunicorn/bonklm@0.4'>(DEFAULT_CACHE_NAMESPACE);
expectType<number>(DEFAULT_TTL_MS);
expectType<number>(IN_MEMORY_TTL_CEILING_MS);
const lru = new InMemoryLRUCache();
new InMemoryLRUCache({ maxEntries: 100, maxTtlMs: 1000 });
expectAssignable<ValidatorCache>(lru);
expectType<GuardrailResult | undefined>(lru.get('k'));
expectType<void>(lru.set('k', result));
expectType<boolean>(lru.has('k'));
expectType<number>(lru.size());
expectAssignable<ValidatorCache>({ get: () => undefined, set: () => {} });
expectAssignable<CachedValidateOptions>({});
expectAssignable<CachedValidateOptions>({ cache, defaultTtlMs: 1, blockedTtlMs: 2, cacheNamespace: 'ns' });
expectAssignable<InMemoryLRUCacheOptions>({});
expectType<string | Promise<string>>(keyFn(input, 'v'));
expectType<void>(cachedLogger.warn('msg'));
expectType<boolean>(cvr.fromCache);

// --- validators: prompt-injection -------------------------------------------
const piv = new PromptInjectionValidator();
new PromptInjectionValidator({ sensitivity: 'strict' });
expectType<'prompt-injection'>(piv.name);
expectType<GuardrailResult>(piv.validate('content'));
expectType<PromptInjectionAnalysisResult>(piv.analyze('content'));
expectType<GuardrailResult>(validatePromptInjection('content'));
expectType<GuardrailResult>(validatePromptInjection('content', { sensitivity: 'strict' }));
expectType<PromptInjectionAnalysisResult>(analyzePromptInjection('content'));
expectError(validatePromptInjection()); // content required

// --- validators: jailbreak --------------------------------------------------
const jbv = new JailbreakValidator();
expectType<'jailbreak'>(jbv.name);
expectType<GuardrailResult>(jbv.validate('content'));
expectType<GuardrailResult>(jbv.validate('content', 'session-1'));
expectType<JailbreakAnalysisResult>(jbv.analyze('content'));
expectType<JailbreakAnalysisResult>(jbv.analyze('content', 'session-1'));
expectType<GuardrailResult>(validateJailbreak('content'));
expectType<JailbreakAnalysisResult>(analyzeJailbreak('content'));
expectType<JailbreakAnalysisResult>(analyzeJailbreak('content', {}, 'session-1'));
expectError(validateJailbreak()); // content required

// --- validators: reformulation ----------------------------------------------
const ref = new ReformulationDetector();
expectType<GuardrailResult>(ref.validate('content'));
expectType<GuardrailResult>(ref.validate('content', 'session-1'));
expectType<ReformulationAnalysisResult>(ref.analyze('content'));
expectType<GuardrailResult>(validateReformulation('content'));
expectType<ReformulationAnalysisResult>(analyzeReformulation('content'));
expectError(validateReformulation()); // content required

// --- validators: boundary ---------------------------------------------------
const bd = new BoundaryDetector();
expectType<GuardrailResult>(bd.validate('content'));
expectType<GuardrailResult>(bd.validate('content', 'normalized'));
expectType<BoundaryDetectorConfig>(bd.getConfig());
expectType<BoundaryFinding[]>(detectBoundaryManipulation('raw'));
expectType<BoundaryFinding[]>(detectBoundaryManipulation('raw', 'normalized'));
expectType<GuardrailResult>(detectBoundary('content'));
expectError(detectBoundaryManipulation()); // rawContent required
expectAssignable<BoundaryDetectorConfig>({});
expectAssignable<BoundaryDetectorConfig>({ detectConfusableVariants: true });

// --- validators: multilingual -----------------------------------------------
const ml = new MultilingualDetector();
expectType<'multilingual'>(ml.name);
expectType<GuardrailResult>(ml.validate('content'));
expectType<GuardrailResult>(ml.validate(input));
expectType<number>(ml.getLanguageCount());
expectType<Record<string, number>>(ml.getPatternCountByLanguage());
expectType<string[]>(ml.getSupportedLanguages());
expectType<MultilingualFinding[]>(detectMultilingualInjection('content'));
expectType<MultilingualFinding[]>(detectMultilingualInjection('content', ['es'], true));
expectType<GuardrailResult>(detectMultilingual('content'));
expectAssignable<MultilingualDetectorConfig>({});
expectAssignable<MultilingualDetectorConfig>({ languages: ['es'], includeRomanized: true });

// --- validators: code-injection (async, union input) ------------------------
const cinj = new CodeInjectionValidator();
new CodeInjectionValidator({ allowlistedHosts: ['example.com'], allowlistedPatterns: [/x/] });
expectType<'code_injection'>(cinj.name);
expectType<Promise<GuardrailResult>>(cinj.validate('content'));
expectType<Promise<GuardrailResult>>(cinj.validate(input));
expectAssignable<Validator>(cinj);
expectAssignable<CodeInjectionCategory>(CodeInjectionCategory.PYTHON_DYNAMIC_EXEC);
expectAssignable<CodeInjectionCategory>(CodeInjectionCategory.SHELL_METACHAR);
expectAssignable<CodeInjectionValidatorConfig>({});
expectAssignable<CodeInjectionValidatorConfig>({ allowlistedHosts: ['h'] });

// --- validators: path-traversal (cwd required) ------------------------------
const ptv = new PathTraversalValidator({ cwd: '/tmp' });
new PathTraversalValidator({ cwd: '/tmp', checkSymlinks: true });
expectType<'path_traversal'>(ptv.name);
expectType<Promise<GuardrailResult>>(ptv.validate('content'));
expectType<Promise<GuardrailResult>>(ptv.validate(input));
expectAssignable<Validator>(ptv);
expectError(new PathTraversalValidator()); // config required
expectError(new PathTraversalValidator({})); // cwd required
expectAssignable<PathTraversalValidatorConfig>({ cwd: '/tmp' });
expectNotAssignable<PathTraversalValidatorConfig>({}); // cwd required

// --- validators: audio-stream -----------------------------------------------
const asv = new AudioStreamValidator();
new AudioStreamValidator({ minBufferBeforeRelease: 10, patterns: [] });
expectType<'audio_stream'>(asv.name);
expectType<AudioStreamPartialResult>(asv.validatePartial('chunk'));
expectType<Promise<GuardrailResult>>(asv.validateFinal('final'));
expectType<Promise<GuardrailResult>>(asv.validate('content'));
expectType<Promise<GuardrailResult>>(asv.validate(input));
expectType<boolean>(asv.peekEarlyBlock());
expectType<boolean>(asv.getSignalEarlyBlock());
expectType<boolean>(asv.consumeEarlyBlock());
expectType<AudioStreamResetReport>(asv.resetSession());
expectType<AudioStreamValidator>(asv.fork());
expectType<HookSurface>(AUDIO_STREAM_SURFACE);
expectType<500>(MAX_AUDIO_STREAM_PATTERNS);
expectType<512>(MAX_AUDIO_STREAM_NEEDLE_LENGTH);
expectType<AudioStreamPattern[]>(DEFAULT_AUDIO_STREAM_PATTERNS);
expectAssignable<AudioStreamSeverity>('critical');
expectAssignable<AudioStreamSeverity>('warning');
expectNotAssignable<AudioStreamSeverity>('info');
expectAssignable<AudioStreamCategory>('injection');
expectAssignable<AudioStreamCategory>('data_exfil');
expectNotAssignable<AudioStreamCategory>('bogus');
expectAssignable<AudioStreamValidatorConfig>({});

// --- validators: batch factories --------------------------------------------
expectType<Validator>(createToolCallArgsValidator({ validators: [validator] }));
expectType<Validator>(
  createToolCallArgsValidator({ validators: [validator], perFieldDepth: 2, serializer: (_n, _a, _d) => 'x' })
);
expectError(createToolCallArgsValidator({})); // validators required
expectAssignable<ToolCallArgsValidatorConfig>({ validators: [validator] });
expectAssignable<ToolCallSerializer>((_toolName, _args, _depth) => 'x');
expectAssignable<ToolCallSerializer>((_t, _a, _d) => ['a', 'b']);
expectAssignable<ToolCallSerializer>((_t, _a, _d) => [{ key: 'k', value: 'v' }]);

const rdv = createRetrievedDocValidator({ validators: [validator] });
expectType<RetrievedDocValidator>(rdv);
expectAssignable<Validator>(rdv);
expectType<Promise<RetrievedDocBatchResult>>(rdv.validateBatch([{ content: 'd' }]));
expectError(createRetrievedDocValidator({})); // validators required
expectAssignable<PerDocFailureMode>('drop');
expectAssignable<PerDocFailureMode>('block-all');
expectAssignable<PerDocFailureMode>('redact');
expectNotAssignable<PerDocFailureMode>('ignore');
expectAssignable<RetrievedDoc>({ content: 'd' });
expectNotAssignable<RetrievedDoc>({}); // content required
expectAssignable<RetrievedDocValidatorConfig>({ validators: [validator] });
expectAssignable<RetrievedDocValidatorConfig>({
  validators: [validator],
  onPerDocFailure: 'redact',
  redactReplacement: '***'
});

const mwv = createMemoryWriteValidator({ validators: [validator] });
expectType<MemoryWriteValidator>(mwv);
expectAssignable<Validator>(mwv);
expectType<Promise<MemoryWriteResult>>(mwv.validateWrite({ content: 'c' }));
expectAssignable<MemoryWriteFailureMode>('block-write');
expectAssignable<MemoryWriteFailureMode>('redact');
expectNotAssignable<MemoryWriteFailureMode>('drop');
expectAssignable<MemoryWritePayload>({ content: 'c' });
expectNotAssignable<MemoryWritePayload>({}); // content required
expectAssignable<MemoryWriteValidatorConfig>({ validators: [validator] });

const ccv = createComposedContextValidator({ validators: [validator] });
expectType<ComposedContextValidator>(ccv);
expectAssignable<Validator>(ccv);
expectType<Promise<ComposedContextBatchResult>>(ccv.validateEntries(['a', 'b']));
expectError(createComposedContextValidator({})); // validators required
expectType<number>(DEFAULT_COMPOSED_CONTEXT_SOFT_CAP_BYTES);
expectType<number>(DEFAULT_COMPOSED_CONTEXT_HARD_CAP_BYTES);
expectAssignable<ComposedContextValidatorConfig>({ validators: [validator] });
expectAssignable<ComposedContextValidatorConfig>({ validators: [validator], softCapBytes: 1, hardCapBytes: 2, logger });

// --- guards: secret ---------------------------------------------------------
const sg = new SecretGuard();
expectType<GuardrailResult>(sg.validate('content'));
expectType<GuardrailResult>(sg.validate('content', 'file.ts'));
expectType<string>(sg.redactContent('content'));
expectType<string>(sg.redactContent('content', '***'));
expectType<GuardrailResult>(validateSecrets('content'));
expectType<GuardrailResult>(validateSecrets('content', 'file.ts', {}));
expectError(validateSecrets()); // content required

// --- guards: bash-safety ----------------------------------------------------
const bsg = new BashSafetyGuard();
expectType<GuardrailResult>(bsg.validate('rm -rf /'));
expectType<BashSafetyConfig>(bsg.getConfig());
expectType<GuardrailResult>(checkBashSafety('ls'));
expectType<GuardrailResult>(checkBashSafety('ls', '/tmp'));
expectAssignable<BashSafetyConfig>({});
expectAssignable<BashSafetyConfig>({ cwd: '/tmp', detectSqlInjection: true, detectCommandSubstitution: false });

// --- guards: production ------------------------------------------------------
const pg = new ProductionGuard();
expectType<GuardrailResult>(pg.validate('content'));
expectType<GuardrailResult>(pg.validate('content', 'file.ts'));
expectType<ProductionGuardConfig>(pg.getConfig());
expectType<GuardrailResult>(checkProduction('content'));
expectType<boolean>(isProductionEnvironment());
expectType<boolean>(isProductionEnvironment({ NODE_ENV: 'production' }));
expectType<boolean>(isTestEnvironment());
expectAssignable<EnvBindings>({ NODE_ENV: 'test' });
expectAssignable<EnvBindings>({ FOO: undefined });
expectAssignable<ProductionGuardConfig>({});
expectAssignable<ProductionGuardConfig>({
  filePath: 'f',
  allowDocumentationFiles: true,
  envBindings: { NODE_ENV: 'production' }
});

// --- guards: xss-safety -----------------------------------------------------
const xss = new XSSGuard();
expectType<GuardrailResult>(xss.validate('<script>'));
expectType<string>(xss.getXSSReport('<script>'));
expectType<XSSGuardConfig>(xss.getConfig());
expectType<XSSDetectionResult>(detectXSS('<script>'));
expectType<XSSDetectionResult>(detectXSS('<script>', 'html'));
expectType<GuardrailResult>(checkXSS('<script>'));
expectType<GuardrailResult>(checkXSS('<script>', 'html'));
expectType<string>(getXSSReport('<script>'));
expectAssignable<XSSGuardConfig>({});
expectAssignable<XSSGuardConfig>({ context: 'html', mode: 'strict' });
expectNotAssignable<XSSGuardConfig>({ mode: 'bogus' });
expectAssignable<XSSDetectionResult>({ hasXSS: true, severity: Severity.BLOCKED, patterns: [], message: 'm' });
expectNotAssignable<XSSDetectionResult>({ hasXSS: true, severity: Severity.BLOCKED, patterns: [] }); // message required

// --- guards: pii ------------------------------------------------------------
const pii = new PIIGuard();
expectType<GuardrailResult>(pii.validate('content'));
expectType<GuardrailResult>(pii.validate('content', 'file.ts'));
expectType<PiiDetection[]>(pii.detect('content'));
expectType<string>(pii.redactContent('content'));
expectType<string>(pii.redactContent('content', '***'));
expectType<PIIGuardConfig>(pii.getConfig());
expectType<GuardrailResult>(checkPII('content'));
expectAssignable<PIIGuardConfig>({});
expectAssignable<PIIGuardConfig>({ filePath: 'f', allowTestFiles: true, minSeverity: 'critical' });
expectAssignable<PiiSeverity>('critical');
expectAssignable<PiiSeverity>('warning');
expectAssignable<PiiSeverity>('info');
expectNotAssignable<PiiSeverity>('low');
expectType<PiiSeverity>(piiDetection.severity);
expectType<string>(piiDetection.patternName);

// --- hooks ------------------------------------------------------------------
const hm = new HookManager();
new HookManager({ defaultTimeout: 100 });
expectType<string>(
  hm.registerHook({
    name: 'h',
    phase: HookPhase.BEFORE_VALIDATION,
    handler: () => ({ success: true }),
    priority: 1,
    enabled: true
  })
);
expectType<boolean>(hm.unregisterHook('id'));
expectType<Promise<HookResult[]>>(
  hm.executeHooks(HookPhase.AFTER_VALIDATION, { phase: HookPhase.AFTER_VALIDATION, content: 'x' })
);
expectType<void>(hm.clearHooks());
expectType<HookDefinition>(createBlockingHook('h', HookPhase.BEFORE_BLOCK, () => true));
expectType<HookDefinition>(createTransformHook('h', HookPhase.BEFORE_VALIDATION, c => c));
expectType<HookSurface>(DEFAULT_HOOK_SURFACE);
expectAssignable<HookPhase>(HookPhase.AFTER_ALLOW);
expectAssignable<HookContext>({ phase: HookPhase.BEFORE_VALIDATION, content: 'x' });
expectNotAssignable<HookContext>({ content: 'x' }); // phase required
expectAssignable<HookResult>({ success: true });
expectNotAssignable<HookResult>({}); // success required
expectAssignable<HookExecution>({ hookId: 'i', timestamp: 0, attemptNumber: 1 });
expectAssignable<HookHandler>((_ctx, _exec) => ({ success: true }));
expectAssignable<HookHandler>(async (_ctx, _exec) => ({ success: true }));
expectAssignable<HookDefinition>({
  id: 'i',
  name: 'n',
  phase: HookPhase.BEFORE_VALIDATION,
  handler: () => ({ success: true }),
  priority: 1,
  enabled: true
});
expectAssignable<HookManagerConfig>({});
expectAssignable<HookManagerConfig>({ logger, defaultTimeout: 100 });

// --- telemetry --------------------------------------------------------------
expectType<GuardrailResult>(bonklmTrace(result, { tracer, validator: 'v', surface: 'text_input' }));
expectError(bonklmTrace(result, { validator: 'v', surface: 'text_input' })); // tracer required
expectType<boolean>(isBonklmBlockEvent({}));
expectType<boolean>(isBonklmBlockEvent(blockEvent));
// type-predicate narrowing: a passing guard must narrow `unknown` to BonklmBlockEvent
declare const maybeBlockEvent: unknown;
if (isBonklmBlockEvent(maybeBlockEvent)) {
  expectType<BonklmBlockEvent>(maybeBlockEvent);
}
expectAssignable<BonklmTraceSurface>('text_input');
expectAssignable<BonklmTraceSurface>('composed_context');
expectNotAssignable<BonklmTraceSurface>('bogus');
expectAssignable<BonklmTraceAction>('allow');
expectAssignable<BonklmTraceAction>('block');
expectNotAssignable<BonklmTraceAction>('sanitize');
expectAssignable<BonklmTracer>({ startActiveSpan: (_n, _o, fn) => fn({ setAttribute: () => {}, end: () => {} }) });
expectAssignable<BonklmSpan>({ setAttribute: () => {}, end: () => {} });
expectAssignable<BonklmSpanOptions>({});
expectAssignable<BonklmSpanOptions>({ attributes: { a: 1, b: 'x', c: true } });
expectAssignable<BonklmTraceOptions>({ tracer, validator: 'v', surface: 'tool_call' });
expectAssignable<BonklmBlockEventBase>({ kind: 'voice', reason: 'r' });
expectAssignable<BonklmBlockEventKind>('sandbox');
expectAssignable<BonklmBlockEventKind>('web-middleware');
expectNotAssignable<BonklmBlockEventKind>('bogus');

// --- fault-tolerance: circuit breaker + retry -------------------------------
const cb = new CircuitBreaker();
new CircuitBreaker({ timeout: 1000, logger }, { onOpen: () => {}, onFailure: () => {} });
expectType<Promise<number>>(cb.execute(() => 1));
expectType<Promise<string>>(cb.execute(async () => 'x'));
expectType<CircuitState>(cb.getState());
expectType<CircuitBreakerStats>(cb.getStats());
expectType<void>(cb.reset());
expectType<void>(cb.open());
expectType<void>(cb.close());
expectType<void>(cb.destroy());
expectType<CircuitBreaker>(createCircuitBreaker());
expectAssignable<CircuitState>(CircuitState.CLOSED);
expectAssignable<CircuitState>(CircuitState.OPEN);
expectAssignable<CircuitState>(CircuitState.HALF_OPEN);
expectNotAssignable<CircuitState>('closed'); // string-enum
const cbErr = new CircuitBreakerOpenError(CircuitState.OPEN, new Date());
expectAssignable<Error>(cbErr);
expectType<CircuitState>(cbErr.state);
expectType<Date>(cbErr.nextAttemptTime);
expectError(new CircuitBreakerOpenError(CircuitState.OPEN)); // nextAttemptTime required
expectAssignable<CircuitBreakerConfig>({});
expectAssignable<CircuitBreakerConfig>({ timeout: 1, recoveryTimeout: 2, logger, enabled: true });
expectAssignable<CircuitBreakerListeners>({ onOpen: () => {} });

const rp = new RetryPolicy();
new RetryPolicy({ maxAttempts: 3, initialDelay: 10 });
expectType<Promise<RetryResult<number>>>(rp.execute(() => 1));
expectType<Promise<RetryResult<string>>>(rp.execute(async _opts => 'x'));
expectType<RetryPolicy>(createRetryPolicy());
expectAssignable<RetryConfig>({});
expectAssignable<RetryConfig>({ maxAttempts: 3, backoffMultiplier: 2, jitter: 0.5 });
expectAssignable<RetryResult<number>>({ success: true, attempts: 1, totalDelay: 0 });
expectAssignable<RetryAttemptOptions>({ attemptNumber: 1, delay: 0, remainingAttempts: 2 });

// --- validation: schema + rules ---------------------------------------------
expectAssignable<ValidationRule>(new NumberRangeRule());
expectAssignable<ValidationRule>(new NumberRangeRule(0, 10, true));
expectAssignable<ValidationRule>(new TypeRule('string'));
expectError(new TypeRule()); // expectedType required
expectAssignable<ValidationRule>(new EnumRule(['a', 'b']));
expectError(new EnumRule()); // allowedValues required
expectAssignable<ValidationRule>(new ValidatorInstanceRule());
expectAssignable<ValidationRule>(new LoggerInstanceRule());
expectAssignable<ValidationRule>(new AttackLoggerInstanceRule());
expectAssignable<ValidationRule>(new ArrayRule());
expectAssignable<ValidationRule>(new ArrayRule(new TypeRule('string'), 1, 5));
expectAssignable<ValidationRule>(new ObjectRule());
expectAssignable<ValidationRule>(new OptionalRule(new TypeRule('string')));
expectError(new OptionalRule()); // rule required
expectAssignable<ValidationRule>(new CustomRule(() => undefined));
expectError(new CustomRule()); // validator required
expectAssignable<ValidationRule>({ validate: () => undefined });

const schema = new Schema({ name: new TypeRule('string') });
expectType<ConfigValidationResult>(schema.validate({}));
expectType<void>(schema.validateOrThrow({}));
expectError(new Schema()); // rules required
expectType<NumberRangeRule>(Validators.positiveNumber());
expectType<NumberRangeRule>(Validators.positiveNumber(1));
expectType<TypeRule>(Validators.string);
expectType<FunctionRule>(Validators.function);
expectAssignable<ValidationRule>(Validators.function);
expectType<EnumRule>(Validators.enum(['a']));
expectType<OptionalRule>(Validators.optional(new TypeRule('string')));

const cfgErr = new ConfigValidationError('bad');
expectAssignable<Error>(cfgErr);
expectType<string | undefined>(cfgErr.field);
new ConfigValidationError('bad', 'fieldName', 42);
expectError(new ConfigValidationError()); // message required
expectAssignable<ConfigValidationResult>({ valid: true, errors: [] });
expectNotAssignable<ConfigValidationResult>({ valid: true }); // errors required

// --- logging: MonitoringLogger ----------------------------------------------
const mon = new MonitoringLogger();
new MonitoringLogger({ level: MonitoringLogLevel.INFO, json: true });
expectAssignable<Logger>(mon);
expectType<void>(mon.debug('msg'));
expectType<void>(mon.info('msg', { k: 'v' }));
expectType<void>(mon.incrementCounter('c'));
expectType<MetricsData>(mon.getMetrics());
expectType<void>(mon.resetMetrics());
expectType<LogEntry[]>(mon.getAuditLog());
expectType<MonitoringLogger>(mon.child({ k: 'v' }));
expectType<MonitoringLogger>(createMonitoringLogger());
expectAssignable<MonitoringLogLevel>(MonitoringLogLevel.ERROR);
expectAssignable<MonitoringLoggerOptions>({});
expectAssignable<MonitoringLoggerOptions>({ level: MonitoringLogLevel.WARN, json: true, logger });
expectAssignable<MetricsData>({ counters: {}, gauges: {}, histograms: {}, timestamps: {} });
expectAssignable<LogEntry>({ level: MonitoringLogLevel.INFO, timestamp: 0, message: 'm' });

// --- security: override-token -----------------------------------------------
const otv = new OverrideTokenValidator({ secret: 's' });
expectType<string>(otv.generateToken());
expectType<string>(otv.generateToken(TokenScope.ADMIN));
expectType<TokenValidationResult>(otv.validateToken('tok'));
expectType<TokenValidationResult>(otv.validateContent('content'));
expectType<void>(otv.clearReplayCache());
expectError(new OverrideTokenValidator()); // config required
expectType<OverrideTokenValidator>(createOverrideTokenValidator());
expectType<string>(getOverrideTokenSecret());
expectType<string>(hashContent('content'));
expectType<OverrideTokenConfig>(parseOverrideTokenConfig('secret-string'));
expectType<OverrideTokenConfig>(parseOverrideTokenConfig({ secret: 's' }));
expectAssignable<TokenScope>(TokenScope.EMERGENCY);
expectAssignable<TokenScope>(TokenScope.READONLY);
expectAssignable<OverrideTokenConfigString>('s');
expectAssignable<OverrideTokenConfigString>({ secret: 's' });
expectAssignable<OverrideTokenConfig>({ secret: 's' });
expectNotAssignable<OverrideTokenConfig>({}); // secret required
expectAssignable<TokenValidationResult>({ valid: true });
expectAssignable<TokenUsage>({ timestamp: 0, scope: TokenScope.ADMIN, contentHash: 'h', success: true });

// --- security: rate-limiter -------------------------------------------------
const rl = new RateLimiter({ maxRequests: 10, windowMs: 1000 });
expectType<RateLimitResult>(rl.checkLimit('key'));
expectType<RateLimitResult>(rl.checkLimit('key', 123));
expectType<void>(rl.reset('key'));
expectType<number>(rl.getCount('key'));
expectType<RateLimiter>(createRateLimiter());
expectType<RateLimiter>(CommonRateLimiters.default());
expectType<RateLimiter>(CommonRateLimiters.strict());
expectType<RateLimiterConfig>(DEFAULT_RATE_LIMIT);
expectAssignable<RateLimiterConfig>({ maxRequests: 1, windowMs: 1 });
expectNotAssignable<RateLimiterConfig>({ maxRequests: 1 }); // windowMs required
expectAssignable<RateLimitResult>({ allowed: true, count: 1, remaining: 9, resetTime: 0 });

// --- connector-utils: errors + stream + timeout -----------------------------
const cve = new ConnectorValidationError('m');
expectAssignable<Error>(cve);
expectType<string>(cve.category);
expectType<number | undefined>(cve.statusCode);
new ConnectorValidationError('m', 'invalid', 400);
const sve = new StreamValidationError('m');
expectType<string>(sve.reason);
expectType<boolean>(sve.blocked);
const cce = new ConnectorConfigurationError('m');
expectType<string | undefined>(cce.field);
const cte = new ConnectorTimeoutError('m', 5000);
expectType<number>(cte.timeout);
expectError(new ConnectorTimeoutError('m')); // timeout required
// StreamValidator has a private constructor — construct only via the static
// `create` factory (the private-ctor diagnostic ts2673 is unsupported by tsd).
const sv = StreamValidator.create(streamEngine);
StreamValidator.create(streamEngine, { maxBufferSize: 1024 });
expectType<string>(sv.accumulated);
expectType<boolean>(sv.blocked);
expectType<number>(DEFAULT_MAX_BUFFER_SIZE);
expectType<10>(DEFAULT_VALIDATION_INTERVAL);
expectType<Promise<{ allowed: boolean }>>(
  validateWithTimeoutSecure<{ allowed: boolean }>({
    operation: () => ({ allowed: true }),
    timeoutMs: 100,
    timeoutSentinel: () => ({ allowed: false })
  })
);
expectError(validateWithTimeoutSecure<{ allowed: boolean }>({ operation: () => ({ allowed: true }), timeoutMs: 100 })); // timeoutSentinel required
expectAssignable<StreamValidationOptions>({});
expectAssignable<StreamValidationOptions>({ maxBufferSize: 1, validationInterval: 2, logger });
expectAssignable<StreamValidatorState>({ accumulated: '', chunkCount: 0, blocked: false, byteSize: 0 });
expectAssignable<StreamValidatorEngine>({ validate: () => ({ allowed: true }) });
expectAssignable<StreamValidatorEngine>({ validate: async () => ({ allowed: true, reason: 'r' }) });
expectAssignable<StreamValidatorResult>({ allowed: true, accumulated: '' });
expectAssignable<ValidateWithTimeoutOptions<{ allowed: boolean }>>({
  operation: () => ({ allowed: true }),
  timeoutMs: 1,
  timeoutSentinel: () => ({ allowed: false })
});

// --- edge: ALS canary -------------------------------------------------------
expectType<void>(assertAsyncLocalStorageHealthy());
const alsErr = new AsyncLocalStorageCanaryError('msg');
expectAssignable<Error>(alsErr);
expectError(new AsyncLocalStorageCanaryError()); // message required

// --- shadow-log -------------------------------------------------------------
expectType<ShadowLog>(createShadowLog(adapter));
expectType<ShadowLog>(createShadowLog(adapter, { maxEntriesPerRoom: 10, evictionPolicy: 'drop-oldest' }));
expectError(createShadowLog()); // adapter required
expectType<ShadowLogStorageAdapter>(createInMemoryShadowLogStorage());
expectType<Promise<string>>(computeContentHash('t', 'authenticated', 'e'));
expectType<Promise<string>>(computeChainLinkHash('h', null));
expectError(computeContentHash('t')); // sourceTrust + entityId required
expectError(computeContentHash('t', 'authenticated')); // entityId still required
expectAssignable<ShadowLogSourceTrust>('authenticated');
expectAssignable<ShadowLogSourceTrust>('unauthenticated_http');
expectAssignable<ShadowLogSourceTrust>('agent_internal');
expectNotAssignable<ShadowLogSourceTrust>('trusted');
expectAssignable<EvictionPolicy>('refuse-write');
expectAssignable<EvictionPolicy>('drop-oldest');
expectNotAssignable<EvictionPolicy>('evict');
expectAssignable<VerifyChainResult>({ ok: true });
expectAssignable<VerifyChainResult>({ ok: false, brokenAt: 3 });
expectNotAssignable<VerifyChainResult>({ ok: false }); // brokenAt required when not ok
expectAssignable<ShadowLogEntry>({
  messageId: 'm',
  roomId: 'r',
  entityId: 'e',
  text: 't',
  contentHash: 'h',
  prevEntryHash: null,
  createdAt: 0,
  sourceTrust: 'authenticated'
});
expectAssignable<ShadowLogAppendInput>({
  messageId: 'm',
  roomId: 'r',
  entityId: 'e',
  text: 't',
  sourceTrust: 'authenticated'
});
expectNotAssignable<ShadowLogAppendInput>({ messageId: 'm', roomId: 'r', entityId: 'e', text: 't' }); // sourceTrust required
expectAssignable<ReadByRoomOptions>({});
expectAssignable<ReadByRoomOptions>({ sourceTrust: 'authenticated', limit: 10, since: 0 });
expectAssignable<CreateShadowLogOptions>({});
expectAssignable<CreateShadowLogOptions>({ maxEntriesPerRoom: 1, maxTotalEntries: 2, evictionPolicy: 'refuse-write' });

// --- common: serializeError -------------------------------------------------
expectType<SerializedError>(serializeError(new Error('x')));
expectType<SerializedError>(serializeError('not an error'));
expectError(serializeError()); // error arg required
expectAssignable<SerializedError>({ message: 'm' });
expectAssignable<SerializedError>({ message: 'm', name: 'n', stack: 's', raw: 'r' });
expectNotAssignable<SerializedError>({}); // message required
