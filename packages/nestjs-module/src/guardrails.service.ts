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
  Schema,
  type SessionPatternFinding,
  Severity,
  updateSessionState,
  Validators,
} from '@blackunicorn/bonklm';
import type {
  GuardrailsModuleOptions,
} from './types.js';
import {
  DEFAULT_MAX_CONTENT_LENGTH,
  DEFAULT_VALIDATION_TIMEOUT,
  GUARDRAILS_OPTIONS,
} from './constants.js';

/**
 * S013-003: Configuration validation schema for NestJS module.
 * Validates module configuration at initialization time.
 */
const NESTJS_CONFIG_SCHEMA = new Schema({
  validators: Validators.array(Validators.function, 0, 100),
  guards: Validators.array(Validators.function, 0, 100),
  logger: Validators.function,
  productionMode: Validators.boolean,
  validationTimeout: Validators.timeout,
  maxContentLength: Validators.positiveNumber(0),
  bodyExtractor: Validators.function,
  responseExtractor: Validators.function,
  global: Validators.boolean,
  // S013-004: AttackLogger is optional
  attackLogger: Validators.optional(Validators.function),
  // S013-005: Session tracking options
  enableSessionTracking: Validators.optional(Validators.boolean),
  sessionIdExtractor: Validators.optional(Validators.function),
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

  constructor(
    @Optional() @Inject(GUARDRAILS_OPTIONS) options?: GuardrailsModuleOptions,
  ) {
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
      sessionIdExtractor, // S013-005: Optional custom session ID extractor
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
      logger: this.logger,
    });

    // S013-004: Register AttackLogger intercept callback if provided
    if (attackLogger) {
      this.engine.onIntercept((attackLogger).getInterceptCallback());
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
      sessionTrackingEnabled: enableSessionTracking,
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
  private async validateWithTimeout(
    content: string,
    context: string
  ): Promise<GuardrailResult[]> {
    // SEC-010: Check content length before validation
    if (content.length > this.maxContentLength) {
      this.logger.warn('[Guardrails] Content too large', {
        length: content.length,
        max: this.maxContentLength,
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
              description: `Content exceeds maximum size of ${this.maxContentLength} bytes`,
            },
          ],
          timestamp: Date.now(),
        },
      ];
    }

    // SEC-008: Timeout wrapper using AbortController
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.validationTimeout);

    try {
      // DEV-001: Use correct API signature (string context, not object)
      const result = await this.engine.validate(content, context);
      clearTimeout(timeoutId);

      // Return individual results if available, otherwise wrap the engine result
      return 'results' in result && result.results.length > 0
        ? result.results
        : [result];
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === 'AbortError') {
        this.logger.error('[Guardrails] Validation timeout');
        return [
          {
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
                description: `Validation exceeded ${this.validationTimeout}ms timeout`,
              },
            ],
            timestamp: Date.now(),
          },
        ];
      }

      this.logger.error('[Guardrails] Validation error', { error });
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
              description: `Validation failed: ${String(error)}`,
            },
          ],
          timestamp: Date.now(),
        },
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
    return !results.some((r) => !r.allowed);
  }

  /**
   * Get the first blocked result from validation results.
   *
   * @param results - Validation results to check
   * @returns The first blocked result, or undefined if none
   */
  getBlockedResult(results: GuardrailResult[]): GuardrailResult | undefined {
    return results.find((r) => !r.allowed);
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
    return result.reason || 'Content blocked by guardrails';
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
      maxContentLength: this.maxContentLength,
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
    return isSessionEscalated(sessionId);
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
          weight: finding.weight ?? (finding.severity === Severity.CRITICAL ? 5 : finding.severity === Severity.BLOCKED ? 3 : 1),
          pattern_name: finding.pattern_name,
          timestamp: result.timestamp,
        });
      }
    }

    if (findings.length === 0) {
      return { shouldEscalate: false, reason: '', riskScore: 0 };
    }

    return updateSessionState(sessionId, findings);
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
