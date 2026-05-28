/**
 * BonkLM - GuardrailEngine
 * =================================
 * Main orchestration class for combining multiple validators and guards.
 *
 * @package @blackunicorn/bonklm
 */

import { createLogger, type Logger, LogLevel } from '../base/GenericLogger.js';
import { createResult, RiskLevel, Severity } from '../base/GuardrailResult.js';
import { hashContent, OverrideTokenValidator, parseOverrideTokenConfig } from '../security/override-token.js';
import { StreamValidationError } from '../connector-utils/errors.js';
import { sanitizeLogString, serializeError } from '../common/index.js';
import { CircuitBreaker, type CircuitBreakerMetrics } from './CircuitBreaker.js';

// Re-export so existing consumers importing StreamValidationError from this module
// continue to work without a path change.
export { StreamValidationError } from '../connector-utils/errors.js';
import type {
  EngineResult,
  ExecutionOrder,
  Guard,
  GuardrailEngineConfig,
  InterceptCallback,
  Validator,
  ValidatorInput,
  ValidatorResult
} from './GuardrailEngine.types.js';

// Re-export types for public API surface compatibility.
export type {
  ExecutionOrder,
  Guard,
  GuardrailEngineConfig,
  EngineResult,
  InterceptCallback,
  Validator,
  ValidatorResult
} from './GuardrailEngine.types.js';

/**
 * Maximum time (ms) to spend on pattern matching before timeout.
 * Prevents ReDoS and other regex-based DoS attacks.
 */
const MAX_PATTERN_TIME_MS = 100;

/**
 * Default maximum buffer size for streaming validation (1MB).
 * Prevents memory exhaustion through buffer overflow attacks.
 */
const DEFAULT_MAX_BUFFER_SIZE = 1024 * 1024; // 1MB

/**
 * Default circuit breaker threshold for buffer overflow violations.
 * Triggers circuit breaker after this many violations.
 */
const DEFAULT_CIRCUIT_BREAKER_THRESHOLD = 3;

// StreamValidationError + CircuitBreaker now live in dedicated modules
// (../connector-utils/errors.ts and ./CircuitBreaker.ts respectively) to keep
// this orchestration file under the 800-line size cap. They are imported above.

/**
 * GuardrailEngine - Main orchestration class for LLM guardrails.
 *
 * @example
 * ```typescript
 * const engine = new GuardrailEngine({
 *   validators: [
 *     new PromptInjectionValidator(),
 *     new JailbreakValidator()
 *   ],
 *   shortCircuit: true,
 * });
 *
 * const result = await engine.validate(userMessage);
 * if (!result.allowed) {
 *   console.log('Blocked:', result.reason);
 * }
 * ```
 *
 * @public Sprint 26/28 v1.0-RC1 API freeze. Class + ALL public method
 * signatures frozen until v2.0. New optional config keys are additive.
 * Removal/rename of any public method requires a major version bump.
 */
export class GuardrailEngine {
  /**
   * Story 2.7 — engine instance identifier. Random-per-construction so
   * two engines in the same process produce distinct IDs. Consumed by
   * `cached-validator.ts#createSaltedKeyFn(engine.getInstanceId())` to
   * prevent cross-instance cache poisoning when multiple engines share
   * one cache backend (Redis behind Inngest steps, Trigger.dev locals).
   *
   * Format: 16-byte random hex (32 chars). Sufficient entropy to make
   * collision probability negligible (10^-9 at ~10^11 engines in process).
   */
  private readonly instanceId: string;
  private readonly validators: Validator[];
  private readonly guards: Guard[];
  private readonly shortCircuit: boolean;
  private readonly executionOrder: ExecutionOrder;
  private readonly logger: Logger;
  private readonly includeIndividualResults: boolean;
  private readonly sensitivity: 'strict' | 'standard' | 'permissive';
  private readonly action: 'block' | 'sanitize' | 'log' | 'allow';
  private readonly overrideToken?: string; // Legacy plaintext token
  private readonly overrideTokenValidator?: OverrideTokenValidator; // S011-006: Secure validator
  private readonly validationTimeout: number;
  private readonly patternTimeout: number;
  private readonly maxBufferSize: number;
  private readonly circuitBreakerThreshold: number;
  private readonly circuitBreakerTimeout: number;
  private interceptCallbacks: InterceptCallback[] = [];

  // S011-005: Circuit breaker for buffer overflow protection (lives in CircuitBreaker.ts)
  private readonly circuitBreaker: CircuitBreaker;

  constructor(config: GuardrailEngineConfig = {}) {
    // Story 2.7 — assign per-engine instance ID first so any throw
    // during construction still leaves the instance with a stable
    // identifier (defensive — useful for log correlation if we add
    // pre-throw diagnostic emits later).
    this.instanceId = generateEngineInstanceId();

    // Defensive copy (per Story 0.1 corrections PR 3 adversarial finding H1):
    // store a copy of the input arrays so external mutation of the caller's
    // array cannot silently drain the engine's protective layer after
    // construction. `addValidator` / `removeValidator` still mutate the
    // internal copy, but they go through methods we control.
    this.validators = [...(config.validators ?? [])];
    this.guards = [...(config.guards ?? [])];

    // Story 0.1 (R2-7) — empty-list fail-safe (spec-strict).
    // An engine with no validators has no primary protective layer; every
    // text input is silently allowed regardless of any guards. Refuse at
    // construction unless the caller explicitly opts in for testing
    // purposes via `allowEmptyForTesting: true`. Guards-only configurations
    // currently MUST also pass the opt-in flag; if that becomes a real
    // user need we'll add a separate `allowGuardsOnlyValidation` field.
    const isEmptyConfig = this.validators.length === 0;
    if (isEmptyConfig && config.allowEmptyForTesting !== true) {
      throw new Error(
        'Empty validator list is unsafe; use a no-op validator explicitly ' + 'or pass `allowEmptyForTesting: true`.'
      );
    }

    this.shortCircuit = config.shortCircuit ?? true;
    this.executionOrder = config.executionOrder ?? 'sequential';
    this.includeIndividualResults = config.includeIndividualResults ?? true;
    this.sensitivity = config.sensitivity ?? 'standard';
    this.action = config.action ?? 'block';
    this.validationTimeout = config.validationTimeout ?? 5000;
    this.patternTimeout = config.patternTimeout ?? MAX_PATTERN_TIME_MS;
    this.maxBufferSize = config.maxBufferSize ?? DEFAULT_MAX_BUFFER_SIZE;
    this.circuitBreakerThreshold = config.circuitBreakerThreshold ?? DEFAULT_CIRCUIT_BREAKER_THRESHOLD;
    this.circuitBreakerTimeout = config.circuitBreakerTimeout ?? 60000; // 1 minute
    this.logger = config.logger ?? createLogger('console', LogLevel.INFO);

    if (isEmptyConfig && config.allowEmptyForTesting === true) {
      // Wording note (audit-loop): say "no validator-layer checks" not
      // "no security checks" — when guards are wired (e.g. SecretGuard,
      // BashSafetyGuard) the engine DOES still run them on the guards
      // pipeline. Misleading users into thinking the engine is completely
      // inert would invite suppression of this warning in observability.
      const guardSuffix =
        this.guards.length > 0 ? ` ${this.guards.length} guard(s) ARE wired and will still run.` : ' No guards either.';
      this.logger.warn(
        `[CRITICAL] GuardrailEngine constructed with no validators ` +
          `(allowEmptyForTesting=true). This engine performs NO ` +
          `validator-layer checks and is intended for unit tests only.` +
          `${guardSuffix}` +
          ` Do NOT deploy to production.`
      );
    }

    this.circuitBreaker = new CircuitBreaker({
      threshold: this.circuitBreakerThreshold,
      timeoutMs: this.circuitBreakerTimeout,
      logger: this.logger
    });

    // S011-006: Initialize override token validator
    if (config.overrideToken) {
      if (typeof config.overrideToken === 'string') {
        // Legacy mode: plaintext token (INSECURE)
        this.overrideToken = config.overrideToken;
        this.logger.warn(
          '[SECURITY] Using legacy plaintext override token. Consider upgrading to cryptographic validation.'
        );
      } else {
        // New mode: cryptographic token validation
        const tokenConfig = parseOverrideTokenConfig(config.overrideToken);
        this.overrideTokenValidator = new OverrideTokenValidator(tokenConfig);
      }
    }

    this.logger.debug('GuardrailEngine initialized', {
      validatorCount: this.validators.length,
      guardCount: this.guards.length,
      shortCircuit: this.shortCircuit,
      executionOrder: this.executionOrder,
      validationTimeout: this.validationTimeout,
      patternTimeout: this.patternTimeout,
      maxBufferSize: this.maxBufferSize,
      circuitBreakerThreshold: this.circuitBreakerThreshold,
      overrideTokenEnabled: !!(this.overrideToken || this.overrideTokenValidator),
      overrideTokenType: this.overrideToken ? 'legacy' : this.overrideTokenValidator ? 'cryptographic' : 'none'
    });
  }

  /**
   * Story 2.7 — engine instance identifier accessor. Stable across the
   * engine's lifetime; distinct across engines in the same process.
   * Pass to `createSaltedKeyFn(engine.getInstanceId())` so cached
   * validator decisions don't cross-pollinate between engines that
   * share a cache backend.
   *
   * Returns: 32-char lowercase hex string (16 random bytes).
   */
  getInstanceId(): string {
    return this.instanceId;
  }

  /**
   * Check if pattern matching timeout has been exceeded.
   * Called by validators/guards to prevent ReDoS attacks.
   */
  isPatternTimeoutExpired(startTime: number): boolean {
    return Date.now() - startTime > this.patternTimeout;
  }

  /**
   * S011-005: Validate buffer size before accumulation.
   * Throws StreamValidationError if buffer would exceed max size.
   *
   * @param currentBufferSize - Current accumulated buffer size in bytes
   * @param chunkSize - Size of the chunk being added
   * @throws {StreamValidationError} If buffer would exceed max size
   */
  validateBufferSize(currentBufferSize: number, chunkSize: number): void {
    const newSize = currentBufferSize + chunkSize;

    if (newSize > this.maxBufferSize) {
      this.circuitBreaker.recordViolation();
      throw new StreamValidationError(
        `Stream buffer size (${newSize} bytes) would exceed maximum (${this.maxBufferSize} bytes)`,
        'buffer_exceeded',
        true
      );
    }
  }

  /**
   * S011-005: Check if circuit breaker is tripped (blocking requests).
   * Delegates to the CircuitBreaker class.
   */
  isCircuitBreakerOpen(): boolean {
    return this.circuitBreaker.isOpen();
  }

  /**
   * S011-005: Reset circuit breaker after successful validation (HALF_OPEN → CLOSED).
   */
  private resetCircuitBreaker(): void {
    this.circuitBreaker.resetIfRecovering();
  }

  /**
   * Get current circuit breaker state (for monitoring).
   */
  getCircuitBreakerState(): CircuitBreakerMetrics {
    return this.circuitBreaker.getState();
  }

  /**
   * Register a callback to be invoked when content is intercepted (validated).
   * Multiple callbacks can be registered and will be invoked in order.
   *
   * Callbacks receive the validation result and original content.
   * They are invoked after validation completes, before the result is returned.
   * Callbacks are invoked asynchronously and errors are caught and logged.
   *
   * @example
   * ```typescript
   * const logger = new AttackLogger();
   * engine.onIntercept(logger.getInterceptCallback());
   *
   * // Or with a custom callback
   * engine.onIntercept((result, context) => {
   *   if (result.blocked) {
   *     console.log('Blocked attack:', context.content);
   *   }
   * });
   * ```
   */
  onIntercept(callback: InterceptCallback): void {
    this.interceptCallbacks.push(callback);
    this.logger.debug('Intercept callback registered', {
      totalCallbacks: this.interceptCallbacks.length
    });
  }

  /**
   * Sprint 14 carry-over closure (arch X3 part 2): public hook for
   * connectors that route through `cachedValidate` (Inngest / Trigger)
   * or that drive specialised validators outside the engine's
   * `validate()` path (Lance / Turbopuffer / qdrant / pinecone /
   * weaviate). Without this, validator decisions from those connectors
   * never reach `engine.onIntercept(...)` audit hooks — telemetry
   * coverage diverges silently across connectors.
   *
   * The method takes already-computed per-validator results
   * (typically the output of `cachedValidate(...)`) plus the original
   * content string, aggregates them into an `EngineResult` using the
   * same path `validate()` uses, then fires all registered intercept
   * callbacks. Calls are fire-and-forget: errors in callbacks are
   * logged but do not propagate.
   *
   * Connectors should call this AFTER their per-call validation,
   * passing the structurally-validated results. The aggregator is
   * resilient to cached-result enrichment (`fromCache: true` flag is
   * dropped during aggregation; only `ValidatorResult` fields are
   * consumed).
   *
   * @param results - per-validator results to aggregate + dispatch.
   *   Pass an empty array to fire callbacks for an all-allow no-op
   *   (rare; consumers typically have at least one validator result).
   * @param content - the validated content string used as the
   *   `context.content` field in the intercept callback. Pass the
   *   original input (post-canonical-serialization is acceptable for
   *   non-text inputs).
   * @param validationContext - optional context tag forwarded to the
   *   callback's `context.validation_context` field. Useful for
   *   distinguishing connector surfaces ("inngest:validateInput",
   *   "lance:add", etc.).
   *
   * @example
   * ```ts
   * // Inside an Inngest middleware after cachedValidate(...):
   * const results = await cachedValidate(validators, input, opts);
   * await engine.notifyCachedResult(results, contentString, 'inngest:validateInput');
   * ```
   */
  async notifyCachedResult(results: ValidatorResult[], content: string, validationContext?: string): Promise<void> {
    if (this.interceptCallbacks.length === 0) {
      return;
    }
    // Aggregate via the same path `validate()` uses so callback
    // consumers see a uniform EngineResult shape regardless of which
    // connector fired the call. Pass `startTime = Date.now()` so the
    // resulting executionTime is ~0 (connectors that want per-call
    // timing should record it themselves at the call site).
    const aggregated = this.aggregateResults(results, Date.now());
    await this.invokeInterceptCallbacks(aggregated, content, validationContext);
  }

  /**
   * Invoke all registered intercept callbacks.
   * Callbacks are invoked asynchronously and errors are caught and logged.
   */
  private async invokeInterceptCallbacks(
    result: EngineResult,
    content: string,
    validationContext?: string
  ): Promise<void> {
    if (this.interceptCallbacks.length === 0) {
      return;
    }

    // Fire callbacks asynchronously without blocking validation
    const promises = this.interceptCallbacks.map(callback =>
      Promise.resolve().then(async () => {
        try {
          await callback(result, { content, validation_context: validationContext });
        } catch (error) {
          // Log error but don't fail validation
          this.logger.warn('Intercept callback failed', { error: serializeError(error) });
        }
      })
    );

    // Don't await - let callbacks run in background
    void Promise.all(promises);
  }

  /**
   * S011-006: Check for valid override token
   *
   * Supports both legacy plaintext tokens (INSECURE) and new cryptographic validation.
   *
   * @param content - Content to check for override token
   * @returns Token validation result
   */
  private checkOverrideToken(content: string): { valid: boolean; scope?: string; timestamp?: number } {
    // New: Cryptographic validation
    if (this.overrideTokenValidator) {
      const result = this.overrideTokenValidator.validateContent(content);
      if (result.valid) {
        return {
          valid: true,
          scope: result.scope,
          timestamp: result.timestamp
        };
      }
      // Log failed validation attempts for audit
      const contentHash = hashContent(content);
      this.logger.warn('Override token validation failed', {
        error: result.error,
        contentHash
      });
      return { valid: false };
    }

    // Legacy: Plaintext token (INSECURE)
    if (this.overrideToken && content.includes(this.overrideToken)) {
      return { valid: true, scope: 'legacy', timestamp: Date.now() };
    }

    return { valid: false };
  }

  /**
   * Validate content against all registered validators and guards.
   *
   * @param content - The content to validate
   * @param context - Optional context (e.g., file path for guards)
   * @returns Aggregated validation result
   */
  async validate(content: string, context?: string): Promise<EngineResult> {
    const startTime = Date.now();

    // S011-005: Check circuit breaker state
    if (this.isCircuitBreakerOpen()) {
      this.logger.warn('Circuit breaker is open - blocking request');

      const blockedResult: EngineResult = {
        allowed: false,
        blocked: true,
        severity: Severity.CRITICAL,
        risk_level: RiskLevel.HIGH,
        risk_score: 50,
        reason: 'Circuit breaker is open due to repeated buffer overflow violations',
        findings: [
          {
            category: 'circuit_breaker',
            severity: Severity.CRITICAL,
            description: 'Request blocked: Circuit breaker is open',
            weight: 50
          }
        ],
        results: [],
        validatorCount: this.validators.length,
        guardCount: this.guards.length,
        executionTime: Date.now() - startTime,
        timestamp: Date.now()
      };

      await this.invokeInterceptCallbacks(blockedResult, content, context);
      return blockedResult;
    }

    // S011-006: Check for override token with cryptographic validation
    const overrideResult = this.checkOverrideToken(content);
    if (overrideResult.valid) {
      // Log successful override usage for audit
      const contentHash = hashContent(content);
      this.logger.warn('Validation bypassed via override token', {
        scope: overrideResult.scope,
        contentHash,
        timestamp: new Date(overrideResult.timestamp!).toISOString()
      });

      return {
        allowed: true,
        blocked: false,
        severity: Severity.INFO,
        risk_level: RiskLevel.LOW,
        risk_score: 0,
        findings: [],
        results: [],
        validatorCount: this.validators.length,
        guardCount: this.guards.length,
        executionTime: Date.now() - startTime,
        timestamp: Date.now()
      };
    }

    const allResults: ValidatorResult[] = [];

    // Run validators
    const validatorResults = await this.runValidators(content);
    allResults.push(...validatorResults);

    // Check if we should short-circuit
    if (this.shortCircuit && allResults.some(r => r.blocked)) {
      // Sprint 42 CWE-117 sweep — surfaced by mcp integration test:
      // validator-output `reason` can carry attacker-influenced text
      // (matched-pattern slice with embedded `\n` etc.). Sprint 38 swept
      // connector-utils sink patterns; the engine's short-circuit log
      // was missed because it's in core/engine, outside the
      // connector-utils enumeration scope. Wrap with the canonical
      // `sanitizeLogString` primitive per ADR-0001.
      const blockedReason = allResults.find(r => r.blocked)?.reason;
      this.logger.warn('Validation blocked (short-circuit)', {
        reason: blockedReason !== undefined ? sanitizeLogString(blockedReason) : undefined
      });

      const result = this.aggregateResults(allResults, startTime);
      // Invoke intercept callbacks
      await this.invokeInterceptCallbacks(result, content, context);
      return result;
    }

    // Run guards
    const guardResults = await this.runGuards(content, context);
    allResults.push(...guardResults);

    const result = this.aggregateResults(allResults, startTime);

    // S011-005: Reset circuit breaker on successful validation (no-op unless HALF_OPEN)
    if (result.allowed) {
      this.resetCircuitBreaker();
    }

    // Invoke intercept callbacks
    await this.invokeInterceptCallbacks(result, content, context);
    return result;
  }

  /**
   * Story 2.3 audit BLOCK-3 — `validateInput` is the discriminated-union
   * counterpart of `validate(content: string)`. Accepts a structured
   * `ValidatorInput` (text / tool_call / retrieved_docs / memory_write /
   * composed_context) and preserves shape through the validator
   * pipeline so structured-input validators receive the right kind
   * instead of a stringified blob.
   *
   * Fires the SAME `aggregateResults` + `invokeInterceptCallbacks`
   * path as `validate()` so consumers wiring `engine.onIntercept(...)`
   * for telemetry / audit get hits from browser-agent + Inngest + any
   * other structured-input surface — no silent observability gap.
   *
   * Guards are NOT run here (they take `(content: string, context?: string)`
   * which doesn't map cleanly to a discriminated union). Consumers
   * needing guards on structured surfaces should derive a string
   * representation themselves and call `validate(content)` in addition.
   */
  async validateInput(input: ValidatorInput): Promise<EngineResult> {
    const startTime = Date.now();
    // Stringified form fed to intercept callbacks (their signature
    // takes `content: string`). Use a minimal canonical form: text
    // input passes through verbatim; structured inputs JSON-encode.
    const contentForCallback = input.kind === 'text' ? input.content : JSON.stringify(input);

    // Circuit breaker shortcut (same protective layer as validate()).
    if (this.isCircuitBreakerOpen()) {
      this.logger.warn('Circuit breaker is open - blocking request (validateInput)');
      const blockedResult: EngineResult = {
        allowed: false,
        blocked: true,
        severity: Severity.CRITICAL,
        risk_level: RiskLevel.HIGH,
        risk_score: 50,
        reason: 'Circuit breaker is open due to repeated buffer overflow violations',
        findings: [
          {
            category: 'circuit_breaker',
            severity: Severity.CRITICAL,
            description: 'Request blocked: Circuit breaker is open',
            weight: 50
          }
        ],
        results: [],
        validatorCount: this.validators.length,
        guardCount: this.guards.length,
        executionTime: Date.now() - startTime,
        timestamp: Date.now()
      };
      await this.invokeInterceptCallbacks(blockedResult, contentForCallback);
      return blockedResult;
    }

    // Run validators with the structured input.
    const allResults: ValidatorResult[] = [];
    for (const validator of this.validators) {
      const name = validator.name ?? validator.constructor.name;
      try {
        const result = await validator.validate(input);
        allResults.push({ ...result, validatorName: name });
        if (this.shortCircuit && result.blocked) break;
      } catch (error) {
        this.logger.error(`Error in validator ${name} (validateInput)`, { error: serializeError(error) });
        allResults.push({
          ...createResult(false, Severity.CRITICAL, [
            {
              category: 'validator_error',
              severity: Severity.CRITICAL,
              // Sprint 42 architect HIGH closure (sister site #1 of 4):
              // `error.message` is attacker-influenceable when a validator
              // wraps remote input in its error. The description flows
              // into `aggregateResults` → `EngineResult.findings` →
              // consumer log surfaces. Sanitize per ADR-0001.
              description: `Validator ${name} threw an error: ${sanitizeLogString(String(error))}`
            }
          ]),
          validatorName: name
        });
        if (this.shortCircuit) break;
      }
    }

    const result = this.aggregateResults(allResults, startTime);
    if (result.allowed) this.resetCircuitBreaker();
    await this.invokeInterceptCallbacks(result, contentForCallback);
    return result;
  }

  /**
   * Run all validators.
   */
  private async runValidators(content: string): Promise<ValidatorResult[]> {
    if (this.validators.length === 0) {
      return [];
    }

    if (this.executionOrder === 'parallel') {
      return this.runValidatorsParallel(content);
    }

    return this.runValidatorsSequential(content);
  }

  /**
   * Run validators sequentially.
   */
  private async runValidatorsSequential(content: string): Promise<ValidatorResult[]> {
    const results: ValidatorResult[] = [];

    for (const validator of this.validators) {
      const name = validator.name ?? validator.constructor.name;
      this.logger.debug(`Running validator: ${name}`);

      try {
        const result = await validator.validate(content);
        results.push({
          ...result,
          validatorName: name
        });

        // Log findings
        if (result.findings.length > 0) {
          this.logger.debug(`${name} found ${result.findings.length} issue(s)`);
        }

        // Short-circuit if blocked
        if (this.shortCircuit && result.blocked) {
          break;
        }
      } catch (error) {
        this.logger.error(`Error in validator ${name}`, { error: serializeError(error) });
        results.push({
          ...createResult(false, Severity.CRITICAL, [
            {
              category: 'validator_error',
              severity: Severity.CRITICAL,
              // Sprint 42 architect HIGH closure (sister site #2 of 4):
              // see #1 rationale above (validateInput catch).
              description: `Validator ${name} threw an error: ${sanitizeLogString(String(error))}`
            }
          ]),
          validatorName: name
        });
      }
    }

    return results;
  }

  /**
   * Run validators in parallel.
   */
  private async runValidatorsParallel(content: string): Promise<ValidatorResult[]> {
    const promises = this.validators.map(async validator => {
      const name = validator.name ?? validator.constructor.name;
      this.logger.debug(`Running validator: ${name}`);

      try {
        const result = await validator.validate(content);
        return {
          ...result,
          validatorName: name
        };
      } catch (error) {
        this.logger.error(`Error in validator ${name}`, { error: serializeError(error) });
        return {
          ...createResult(false, Severity.CRITICAL, [
            {
              category: 'validator_error',
              severity: Severity.CRITICAL,
              // Sprint 42 architect HIGH closure (sister site #3 of 4):
              // parallel-validator catch path.
              description: `Validator ${name} threw an error: ${sanitizeLogString(String(error))}`
            }
          ]),
          validatorName: name
        };
      }
    });

    return Promise.all(promises);
  }

  /**
   * Run all guards.
   */
  private async runGuards(content: string, context?: string): Promise<ValidatorResult[]> {
    if (this.guards.length === 0) {
      return [];
    }

    const results: ValidatorResult[] = [];

    for (const guard of this.guards) {
      const name = guard.name ?? guard.constructor.name;
      this.logger.debug(`Running guard: ${name}`);

      try {
        const result = await guard.validate(content, context);
        results.push({
          ...result,
          validatorName: name
        });

        if (result.findings.length > 0) {
          this.logger.debug(`${name} found ${result.findings.length} issue(s)`);
        }

        // Short-circuit if blocked
        if (this.shortCircuit && result.blocked) {
          break;
        }
      } catch (error) {
        this.logger.error(`Error in guard ${name}`, { error: serializeError(error) });
        results.push({
          ...createResult(false, Severity.CRITICAL, [
            {
              category: 'guard_error',
              severity: Severity.CRITICAL,
              // Sprint 42 architect HIGH closure (sister site #4 of 4):
              // guard catch path mirrors validator catch.
              description: `Guard ${name} threw an error: ${sanitizeLogString(String(error))}`
            }
          ]),
          validatorName: name
        });
      }
    }

    return results;
  }

  /**
   * Aggregate individual results into a final result.
   */
  private aggregateResults(results: ValidatorResult[], startTime: number): EngineResult {
    const allFindings = results.flatMap(r => r.findings);
    const totalRiskScore = results.reduce((sum, r) => sum + r.risk_score, 0);
    const anyBlocked = results.some(r => r.blocked);

    // Determine max severity
    const maxSeverity = results.reduce((max, r) => {
      const severityOrder: Record<Severity, number> = {
        [Severity.INFO]: 0,
        [Severity.WARNING]: 1,
        [Severity.BLOCKED]: 2,
        [Severity.CRITICAL]: 3
      };
      return severityOrder[r.severity] > severityOrder[max] ? r.severity : max;
    }, Severity.INFO);

    // Determine risk level
    let riskLevel: RiskLevel = RiskLevel.LOW;
    if (totalRiskScore >= 25) {
      riskLevel = RiskLevel.HIGH;
    } else if (totalRiskScore >= 10) {
      riskLevel = RiskLevel.MEDIUM;
    }

    // Apply global action mode
    let allowed = !anyBlocked;
    if (this.action === 'allow') {
      allowed = true;
    } else if (this.action === 'log') {
      allowed = true;
      this.logger.info('Content logged (action: log)', { findings: allFindings.length });
    }

    // Story 1.3 (audit-loop fix) — merge per-validator metadata into the
    // aggregate so surface-specific context (e.g. memory_write's
    // memorySessionId / userId) survives the engine boundary.
    //
    // **Last-writer-wins merge** (cumulative-audit BLOCK fix):
    // composite validators MUST follow the metadata-key naming
    // convention documented on `GuardrailResult.metadata` (each
    // surface prefixes its keys with the surface name) to prevent
    // silent collisions. The `memory_write` surface's `sourceMetadata`
    // carries USER-SUPPLIED values and is namespaced into a nested
    // object precisely so it can't collide with sibling engine-internal
    // keys at the top level.
    let mergedMetadata: Record<string, unknown> | undefined;
    for (const r of results) {
      if (r.metadata) {
        mergedMetadata = { ...(mergedMetadata ?? {}), ...r.metadata };
      }
    }

    return {
      allowed,
      blocked: !allowed,
      reason: anyBlocked ? results.find(r => r.blocked)?.reason : undefined,
      severity: maxSeverity,
      risk_level: riskLevel,
      risk_score: totalRiskScore,
      findings: allFindings,
      ...(mergedMetadata !== undefined ? { metadata: mergedMetadata } : {}),
      results: this.includeIndividualResults ? results : [],
      validatorCount: this.validators.length,
      guardCount: this.guards.length,
      executionTime: Date.now() - startTime,
      timestamp: Date.now()
    };
  }

  /**
   * Add a validator to the engine.
   */
  addValidator(validator: Validator): void {
    this.validators.push(validator);
    this.logger.debug('Validator added', {
      name: validator.name ?? validator.constructor.name,
      totalValidators: this.validators.length
    });
  }

  /**
   * Add a guard to the engine.
   */
  addGuard(guard: Guard): void {
    this.guards.push(guard);
    this.logger.debug('Guard added', {
      name: guard.name ?? guard.constructor.name,
      totalGuards: this.guards.length
    });
  }

  /**
   * Remove a validator by name.
   */
  removeValidator(name: string): boolean {
    const index = this.validators.findIndex(v => (v.name ?? v.constructor.name) === name);
    if (index !== -1) {
      this.validators.splice(index, 1);
      this.logger.debug('Validator removed', { name, totalValidators: this.validators.length });
      return true;
    }
    return false;
  }

  /**
   * Remove a guard by name.
   */
  removeGuard(name: string): boolean {
    const index = this.guards.findIndex(g => (g.name ?? g.constructor.name) === name);
    if (index !== -1) {
      this.guards.splice(index, 1);
      this.logger.debug('Guard removed', { name, totalGuards: this.guards.length });
      return true;
    }
    return false;
  }

  /**
   * Get all registered validators.
   */
  getValidators(): Validator[] {
    return [...this.validators];
  }

  /**
   * Get all registered guards.
   */
  getGuards(): Guard[] {
    return [...this.guards];
  }

  /**
   * Get engine statistics.
   */
  getStats(): {
    validatorCount: number;
    guardCount: number;
    shortCircuit: boolean;
    executionOrder: ExecutionOrder;
    sensitivity: string;
    action: string;
  } {
    return {
      validatorCount: this.validators.length,
      guardCount: this.guards.length,
      shortCircuit: this.shortCircuit,
      executionOrder: this.executionOrder,
      sensitivity: this.sensitivity,
      action: this.action
    };
  }
}

/**
 * Convenience function to create and run a GuardrailEngine in one call.
 *
 * @example
 * ```typescript
 * const result = await validateWithEngine(userMessage, {
 *   validators: [new PromptInjectionValidator()],
 * });
 * ```
 */
export async function validateWithEngine(content: string, config?: GuardrailEngineConfig): Promise<EngineResult> {
  const engine = new GuardrailEngine(config);
  return engine.validate(content);
}

/**
 * Story 2.7 — generate a per-engine random instance ID. Uses Web Crypto
 * `getRandomValues` so it works across every BonkLM-supported runtime
 * (Node 19+, Workerd, Deno, Bun, Vercel Edge) without `node:crypto`.
 * 16 random bytes → 32-char lowercase hex.
 *
 * Module-private — kept out of the public surface so consumers go
 * through `engine.getInstanceId()` for the value (single source of
 * truth) and the salting helper lives in `cached-validator.ts`.
 */
function generateEngineInstanceId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}
