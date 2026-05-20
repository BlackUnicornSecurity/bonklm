/**
 * NestJS Module Types for BonkLM
 * ===========================================
 * Type definitions for the NestJS module with all security features.
 *
 * Security Features Applied:
 * - SEC-001: Path normalization via path.normalize()
 * - SEC-007: Production mode toggle for error messages
 * - SEC-008: Validation timeout with AbortController
 * - SEC-010: Request size limit option
 * - DEV-001: Correct GuardrailEngine API (string context)
 * - DEV-002: Logger type instead of GenericLogger
 */

import type { ExecutionContext } from '@nestjs/common';
import type { Guard, GuardrailResult, Logger, Validator } from '@blackunicorn/bonklm';
import type { AttackLogger } from '@blackunicorn/bonklm-logger';

/**
 * Configuration options for the GuardrailsModule.
 */
export interface GuardrailsModuleOptions {
  /**
   * Validators to run on incoming requests and outgoing responses.
   */
  validators?: Validator[];

  /**
   * Guards to run on incoming requests (with context).
   */
  guards?: Guard[];

  /**
   * Logger instance (DEV-002: Use Logger type, not GenericLogger).
   * Defaults to console logger.
   */
  logger?: Logger;

  /**
   * Whether to register the module globally.
   * When true, the GuardrailsInterceptor is available to all modules.
   * @default false
   */
  global?: boolean;

  /**
   * Production mode flag (SEC-007).
   * When true, error messages are generic to prevent information leakage.
   * When false, detailed error messages are returned.
   * @default process.env.NODE_ENV === 'production'
   */
  productionMode?: boolean;

  /**
   * Validation timeout in milliseconds (SEC-008).
   * Uses AbortController to enforce timeout.
   * @default 5000
   */
  validationTimeout?: number;

  /**
   * Maximum content length in bytes (SEC-010).
   * Requests/responses larger than this are rejected without validation.
   * @default 1048576 (1MB)
   */
  maxContentLength?: number;

  /**
   * Custom error handler.
   * Called when validation fails.
   */
  onError?: (result: GuardrailResult, executionContext: ExecutionContext) => void;

  /**
   * Custom extractor for request body content.
   * Should return a string for validation.
   */
  bodyExtractor?: (request: any) => string;

  /**
   * Custom extractor for response content.
   * Should return a string for validation.
   */
  responseExtractor?: (response: any) => string;

  /**
   * S013-004: Optional AttackLogger instance for logging validation failures.
   * If provided, all blocked requests will be logged as security events.
   */
  attackLogger?: AttackLogger;

  /**
   * S013-005: Enable session tracking for multi-request attack detection.
   * When true, tracks patterns across requests to detect gradual escalation attacks.
   * @default false
   */
  enableSessionTracking?: boolean;

  /**
   * S013-005: Custom extractor for session ID from request.
   * Defaults to extracting from `session.id`, `req.sessionID`, or a generated ID.
   */
  sessionIdExtractor?: (request: any) => string;
}

/**
 * Options for the @UseGuardrails() decorator.
 */
export interface UseGuardrailsDecoratorOptions {
  /**
   * Whether to validate incoming request bodies.
   * @default true
   */
  validateInput?: boolean;

  /**
   * Whether to validate outgoing response bodies.
   * @default false
   */
  validateOutput?: boolean;

  /**
   * Field name in request body to extract for validation.
   * Common values: 'message', 'prompt', 'content', 'text'
   * If not specified, the entire body is stringified.
   */
  bodyField?: string;

  /**
   * Field name in response to extract for validation.
   * If not specified, the entire response is stringified.
   */
  responseField?: string;

  /**
   * Maximum content length for this specific endpoint.
   * Overrides the module-level default.
   */
  maxContentLength?: number;

  /**
   * Custom error handler for this endpoint.
   * Overrides the module-level error handler.
   */
  onError?: (result: GuardrailResult, executionContext: ExecutionContext) => void;
}

/**
 * Async module factory options.
 */
export interface GuardrailsModuleAsyncOptions {
  /**
   * Function to dynamically provide module options.
   */
  useFactory: (
    ...args: any[]
  ) => Promise<GuardrailsModuleOptions> | GuardrailsModuleOptions;

  /**
   * Dependencies to inject into the factory function.
   */
  inject?: any[];

  /**
   * Whether to register the module globally.
   */
  global?: boolean;
}

/**
 * Internal request extension with guardrails metadata.
 */
export interface GuardrailsRequest extends Record<string, unknown> {
  /**
   * Flag indicating if this request has been validated.
   */
  _guardrailsValidated?: boolean;

  /**
   * Validation results from the last check.
   */
  _guardrailsResults?: GuardrailResult[];
}

/**
 * Interceptor execution context with guardrails metadata.
 */
export interface GuardrailsExecutionContext extends ExecutionContext {
  /**
   * Get the underlying request object.
   */
  getRequest(): GuardrailsRequest;
}
