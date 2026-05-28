/**
 * NestJS Guardrails Service
 * =========================
 * Service for validating content using the GuardrailEngine.
 *
 * @package @blackunicorn/bonklm-nestjs
 */

import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  createLogger,
  GuardrailEngine,
  GuardrailResult,
  isSessionEscalated,
  Logger,
  LogLevel,
  RiskLevel,
  sanitizeLogString,
  sanitizeMeta,
  Schema,
  serializeError,
  type SessionPatternFinding,
  Severity,
  updateSessionState,
  validateWithTimeoutSecure,
  Validators
} from '@blackunicorn/bonklm';
import type { GuardrailsModuleOptions } from './types.js';
import { DEFAULT_MAX_CONTENT_LENGTH, DEFAULT_VALIDATION_TIMEOUT, GUARDRAILS_OPTIONS } from './constants.js';

/**
 * S013-003: Configuration validation schema for NestJS module.
 * Validates module configuration at initialization time.
 */
// Sprint 29 fix: ALL fields wrapped in `Validators.optional(...)` — the
// module factory destructures with defaults for every field, so the
// schema must validate SHAPES when supplied without rejecting sparse
// configs. The validators/guards arrays use `validatorInstance` (accepts
// BOTH object-shape Validator instances AND bare callables).
const NESTJS_CONFIG_SCHEMA = new Schema({
  validators: Validators.optional(Validators.array(Validators.validatorInstance, 0, 100)),
  guards: Validators.optional(Validators.array(Validators.validatorInstance, 0, 100)),
  logger: Validators.optional(Validators.loggerInstance),
  productionMode: Validators.optional(Validators.boolean),
  validationTimeout: Validators.optional(Validators.timeout),
  maxContentLength: Validators.optional(Validators.positiveNumber(0)),
  bodyExtractor: Validators.optional(Validators.function),
  responseExtractor: Validators.optional(Validators.function),
  global: Validators.optional(Validators.boolean),
  // S013-004: AttackLogger is optional. Sprint 29: switched from
  // `function` to `attackLoggerInstance` — canonical AttackLogger is
  // a class instance, not a bare callable.
  attackLogger: Validators.optional(Validators.attackLoggerInstance),
  // S013-005: Session tracking options
  enableSessionTracking: Validators.optional(Validators.boolean),
  sessionIdExtractor: Validators.optional(Validators.function)
});

/**
 * S013-003: Validate module configuration at initialization.
 * Throws if configuration is invalid.
 */
function validateNestJsConfig(options: GuardrailsModuleOptions): void {
  NESTJS_CONFIG_SCHEMA.validateOrThrow(options as Record<string, unknown>);
}

/**
 * Default risk score for content size violations.
 */
const DEFAULT_SIZE_RISK_SCORE = 5;

/**
 * Injectable service for LLM guardrails validation.
 *
 * @example
 * ```typescript
 * @Controller('chat')
 * export class ChatController {
 *   constructor(private readonly guardrails: GuardrailsService) {}
 *
 *   @Post()
 *   async chat(@Body() body: { message: string }) {
 *     const results = await this.guardrails.validateInput(body.message);
 *     if (!this.guardrails.isAllowed(results)) {
 *       throw new BadRequestException('Content blocked');
 *     }
 *     // Process message
 *   }
 * }
 * ```
 */
@Injectable()
export class GuardrailsService {
  private readonly engine: GuardrailEngine;
  private readonly logger: Logger;
  private readonly productionMode: boolean;
  private readonly validationTimeout: number;
  private readonly maxContentLength: number;
  private readonly bodyExtractor?: (request: any) => string;
  private readonly responseExtractor?: (response: any) => string;

  constructor(@Optional() @Inject(GUARDRAILS_OPTIONS) options?: GuardrailsModuleOptions) {
    // S013-003: Validate configuration at initialization
    if (options) {
      validateNestJsConfig(options);
    }

    const {
      validators = [],
      guards = [],
      logger,
      productionMode = process.env.NODE_ENV === 'production',
      validationTimeout = DEFAULT_VALIDATION_TIMEOUT,
      maxContentLength = DEFAULT_MAX_CONTENT_LENGTH,
      bodyExtractor,
      responseExtractor,
      attackLogger, // S013-004: Optional AttackLogger instance
      enableSessionTracking = false, // S013-005: Session tracking disabled by default
      sessionIdExtractor // S013-005: Optional custom session ID extractor
    } = options || {};

    this.productionMode = productionMode;
    this.validationTimeout = validationTimeout;
    this.maxContentLength = maxContentLength;
    this.bodyExtractor = bodyExtractor;
    this.responseExtractor = responseExtractor;

    // DEV-002: Use proper logger
    this.logger = logger ?? createLogger('console', LogLevel.INFO);

    this.engine = new GuardrailEngine({
      validators,
      guards,
      logger: this.logger
    });

    // S013-004: Register AttackLogger intercept callback if provided
    if (attackLogger) {
      this.engine.onIntercept(attackLogger.getInterceptCallback());
    }

    // S013-005: Set up session tracking
    this.enableSessionTracking = enableSessionTracking;
    this.sessionIdExtractor = sessionIdExtractor;

    this.logger.debug('GuardrailsService initialized', {
      validatorCount: validators.length,
      guardCount: guards.length,
      productionMode,
      validationTimeout,
      maxContentLength,
      hasAttackLogger: !!attackLogger,
      sessionTrackingEnabled: enableSessionTracking
    });
  }

  private readonly enableSessionTracking: boolean;
  private readonly sessionIdExtractor?: (request: any) => string;

  /**
   * Validate input content.
   *
   * @param content - The content to validate
   * @param context - Optional context (e.g., 'input', 'output')
   * @returns Validation results
   */
  async validateInput(content: string, context?: string): Promise<GuardrailResult[]> {
    return this.validateWithTimeout(content, context ?? 'input');
  }

  /**
   * Validate output content.
   *
   * @param content - The content to validate
   * @param context - Optional context
   * @returns Validation results
   */
  async validateOutput(content: string, context?: string): Promise<GuardrailResult[]> {
    return this.validateWithTimeout(content, context ?? 'output');
  }

  /**
   * Validate content with timeout enforcement (SEC-008).
   *
   * @param content - The content to validate
   * @param context - Optional context string (DEV-001: Use string context)
   * @returns Validation results
   */
  private async validateWithTimeout(content: string, context: string): Promise<GuardrailResult[]> {
    // SEC-010: Check content length before validation
    if (content.length > this.maxContentLength) {
      this.logger.warn('[Guardrails] Content too large', {
        length: content.length,
        max: this.maxContentLength
      });
      return [
        {
          allowed: false,
          blocked: true,
          severity: Severity.WARNING,
          risk_level: RiskLevel.LOW,
          risk_score: DEFAULT_SIZE_RISK_SCORE,
          reason: 'Content too large',
          findings: [
            {
              category: 'size_limit',
              severity: Severity.WARNING,
              description: `Content exceeds maximum size of ${this.maxContentLength} bytes`
            }
          ],
          timestamp: Date.now()
        }
      ];
    }

    // SEC-008: Timeout wrapper.
    //
    // Sprint 30: routes through the shared `validateWithTimeoutSecure`
    // primitive from core/connector-utils. The helper handles
    // Promise.race + post-timeout-rejection absorption internally.
    const buildTimeoutSentinel = (): GuardrailResult => ({
      allowed: false,
      blocked: true,
      severity: Severity.CRITICAL,
      risk_level: RiskLevel.HIGH,
      risk_score: 20,
      reason: 'Validation timeout',
      findings: [
        {
          category: 'timeout',
          severity: Severity.CRITICAL,
          description: `Validation exceeded ${this.validationTimeout}ms timeout`
        }
      ],
      timestamp: Date.now()
    });
    try {
      // DEV-001: Use correct API signature (string context, not object)
      const result = await validateWithTimeoutSecure({
        operation: () => this.engine.validate(content, context),
        timeoutMs: this.validationTimeout,
        timeoutSentinel: buildTimeoutSentinel,
        logger: this.logger
      });

      // Return individual results if available, otherwise wrap the engine result
      return 'results' in result &&
        (result as { results?: unknown[] }).results !== undefined &&
        (result as { results: unknown[] }).results.length > 0
        ? (result as { results: GuardrailResult[] }).results
        : [result];
    } catch (error) {
      // Sprint 40 audit closure (architect HIGH-1 + security S40-3):
      // bare `{ error }` renders as `error={}` because Error fields
      // are non-enumerable. Use the canonical Sprint 33 primitive.
      this.logger.error('[Guardrails] Validation error', { error: serializeError(error) });
      return [
        {
          allowed: false,
          blocked: true,
          severity: Severity.CRITICAL,
          risk_level: RiskLevel.HIGH,
          risk_score: 25,
          reason: 'Validation error',
          findings: [
            {
              category: 'validation_error',
              severity: Severity.CRITICAL,
              // Sprint 42 architect HIGH + security MEDIUM closure
              // (sister site #5 of 5): `error.message` may carry
              // attacker-influenced text when a validator wraps remote
              // input. Description flows into the finding array,
              // surfaces to any consumer logging the result. Sanitize
              // via the canonical primitive per ADR-0001.
              description: `Validation failed: ${sanitizeLogString(String(error))}`
            }
          ],
          timestamp: Date.now()
        }
      ];
    }
  }

  /**
   * Check if validation results allow the content to proceed.
   *
   * @param results - Validation results to check
   * @returns true if content is allowed, false otherwise
   */
  isAllowed(results: GuardrailResult[]): boolean {
    return !results.some(r => !r.allowed);
  }

  /**
   * Get the first blocked result from validation results.
   *
   * @param results - Validation results to check
   * @returns The first blocked result, or undefined if none
   */
  getBlockedResult(results: GuardrailResult[]): GuardrailResult | undefined {
    return results.find(r => !r.allowed);
  }

  /**
   * Get a user-friendly error message for a blocked result.
   * Respects production mode setting (SEC-007).
   *
   * @param result - The blocked result
   * @returns Error message
   */
  getErrorMessage(result: GuardrailResult): string {
    if (this.productionMode) {
      return 'Content blocked by security policy';
    }
    // Sprint 42 CWE-117 sweep — surfaced by integration test:
    // `result.reason` is built from validator output and may carry
    // attacker-influenced text (matched-pattern slice with embedded
    // `\n`). Pre-Sprint-42, dev-mode `getErrorMessage` returned the
    // raw value, which the interceptor embeds into a
    // `BadRequestException` body that NestJS serializes into the HTTP
    // response. If a downstream aggregator logs the response body,
    // the raw CR/LF forges phantom log lines. Per Sprint 41
    // defensive-by-default policy: sanitize at the connector
    // boundary regardless of downstream rendering context.
    //
    // Sprint 42 code-review SHOULD-FIX closure: use `.trim()` so a
    // whitespace-only `reason` (e.g. validator surfaces `'  '`) is
    // treated as empty and falls back to the static label rather than
    // a sanitized-but-blank string. `sanitizeMeta` preserves plain
    // whitespace verbatim, so without trim the consumer would see a
    // blank reason field.
    return result.reason?.trim() ? sanitizeMeta(result.reason) : 'Content blocked by guardrails';
  }

  /**
   * Get the underlying GuardrailEngine instance.
   * Use this for advanced operations.
   *
   * @returns The GuardrailEngine instance
   */
  getEngine(): GuardrailEngine {
    return this.engine;
  }

  /**
   * Get service configuration.
   *
   * @returns Service configuration
   */
  getConfig(): {
    productionMode: boolean;
    validationTimeout: number;
    maxContentLength: number;
  } {
    return {
      productionMode: this.productionMode,
      validationTimeout: this.validationTimeout,
      maxContentLength: this.maxContentLength
    };
  }

  /**
   * Get the custom body extractor if configured.
   *
   * @returns The custom body extractor or undefined
   */
  getBodyExtractor(): ((request: any) => string) | undefined {
    return this.bodyExtractor;
  }

  /**
   * Get the custom response extractor if configured.
   *
   * @returns The custom response extractor or undefined
   */
  getResponseExtractor(): ((response: any) => string) | undefined {
    return this.responseExtractor;
  }

  /**
   * S013-005: Check if a session is escalated (should be blocked).
   * This is useful for pre-validation checks.
   *
   * @param request - The request object
   * @returns Escalation status
   */
  checkSessionEscalation(request: any): {
    escalated: boolean;
    reason: string;
    riskScore: number;
  } {
    if (!this.enableSessionTracking) {
      return { escalated: false, reason: '', riskScore: 0 };
    }

    const sessionId = this.getSessionId(request);
    // Sprint 49 closure (Sprint 44 INFO #5 open): nestjs parity with
    // fastify Sprint 44 fix. `SessionTracker.ts:321` embeds
    // `finding.category` verbatim into the reason string
    // (`Category "X" detected N times`). Custom validators set
    // arbitrary category strings → attacker-influence chain. Sanitize
    // at the service-boundary return site so consumers (controllers,
    // logs, response bodies) inherit safety per Sprint 44
    // sanitize-at-variable-binding lesson.
    const result = isSessionEscalated(sessionId);
    return { ...result, reason: sanitizeMeta(result.reason) };
  }

  /**
   * S013-005: Update session state with validation findings.
   * Call this after validation to track patterns across requests.
   *
   * @param request - The request object
   * @param results - Validation results to track
   * @returns Session update result
   */
  updateSessionWithFindings(
    request: any,
    results: GuardrailResult[]
  ): {
    shouldEscalate: boolean;
    reason: string;
    riskScore: number;
  } {
    if (!this.enableSessionTracking) {
      return { shouldEscalate: false, reason: '', riskScore: 0 };
    }

    const sessionId = this.getSessionId(request);
    const findings: SessionPatternFinding[] = [];

    for (const result of results) {
      for (const finding of result.findings || []) {
        findings.push({
          category: finding.category,
          weight:
            finding.weight ??
            (finding.severity === Severity.CRITICAL ? 5 : finding.severity === Severity.BLOCKED ? 3 : 1),
          pattern_name: finding.pattern_name,
          timestamp: result.timestamp
        });
      }
    }

    if (findings.length === 0) {
      return { shouldEscalate: false, reason: '', riskScore: 0 };
    }

    // Sprint 49 closure (sister to checkSessionEscalation):
    // `updateSessionState` returns `{ shouldEscalate, reason,
    // riskScore, ... }` where `reason` may embed validator-supplied
    // `category` strings verbatim. Sanitize at boundary.
    const result = updateSessionState(sessionId, findings);
    return { ...result, reason: sanitizeMeta(result.reason) };
  }

  /**
   * S013-005: Get the session ID for a request.
   *
   * @param request - The request object
   * @returns Session ID string
   */
  private getSessionId(request: any): string {
    if (this.sessionIdExtractor) {
      return this.sessionIdExtractor(request);
    }

    // Default session ID extraction logic
    if (request.session?.id) return request.session.id;
    if (request.sessionID) return request.sessionID;
    if (request.sessionId) return request.sessionId;
    if (request.headers?.['x-session-id']) return request.headers['x-session-id'] as string;

    // Fall back to IP-based session
    return `ip-${request.ip || request.socket?.remoteAddress || 'unknown'}`;
  }
}
