/**
 * Fastify Plugin Types for BonkLM
 * ============================================
 * Type definitions for the Fastify plugin with all security fixes applied.
 *
 * Security Fixes Applied:
 * - SEC-001: Path normalization via path.normalize()
 * - SEC-007: Production mode toggle for error messages
 * - SEC-008: Validation timeout via validateWithTimeoutSecure (Sprint 30)
 * - SEC-010: Request size limit option
 * - DEV-001: Correct GuardrailEngine API (string context)
 * - DEV-002: Logger type instead of GenericLogger
 * - DEV-003: Async/await on all validation calls
 * - DEV-006: bodyExtractor returns string (normalized from string[])
 *
 * @package @blackunicorn/bonklm-fastify
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Guard, GuardrailResult, Logger, Validator } from '@blackunicorn/bonklm';
import type { AttackLogger } from '@blackunicorn/bonklm-logger';

/**
 * Path matching function type.
 * Uses normalized path comparison for security (SEC-001).
 */
export type PathMatcher = (path: string) => boolean;

/**
 * Configuration options for the guardrails plugin.
 */
export interface GuardrailsPluginOptions {
  /**
   * Validators to run on incoming requests.
   */
  validators?: Validator[];

  /**
   * Guards to run on incoming requests (with context).
   */
  guards?: Guard[];

  /**
   * Whether to validate incoming request bodies.
   * @default true
   */
  validateRequest?: boolean;

  /**
   * Whether to validate outgoing response bodies.
   *
   * Fastify's onSend hook allows response validation before headers are sent.
   * @default false
   */
  validateResponse?: boolean;

  /**
   * Only process requests matching these paths.
   * Uses path normalization for security (SEC-001).
   * If empty, all paths are processed (except excludePaths).
   */
  paths?: string[];

  /**
   * Exclude these paths from validation.
   * Uses path normalization for security (SEC-001).
   */
  excludePaths?: string[];

  /**
   * Logger instance (DEV-002: Use Logger type, not GenericLogger).
   * Defaults to console logger.
   */
  logger?: Logger;

  /**
   * Production mode flag (SEC-007).
   * When true, error messages are generic to prevent information leakage.
   * When false, detailed error messages are returned.
   * @default process.env.NODE_ENV === 'production'
   */
  productionMode?: boolean;

  /**
   * Validation timeout in milliseconds (SEC-008).
   * Uses validateWithTimeoutSecure (canonical SEC-008 primitive) to enforce timeout.
   * @default 5000
   */
  validationTimeout?: number;

  /**
   * Maximum content length in bytes (SEC-010).
   * Requests larger than this are rejected without validation.
   * @default 1048576 (1MB)
   */
  maxContentLength?: number;

  /**
   * Custom error handler.
   * Called when validation fails.
   */
  onError?: (result: GuardrailResult, req: FastifyRequest, reply: FastifyReply) => void | Promise<void>;

  /**
   * @deprecated The plugin automatically extracts content from request body.
   * Common fields (message, prompt, content, text, input, query) are supported.
   */
  bodyExtractor?: never;

  /**
   * Custom extractor for response content.
   * Used in onSend hook for response validation.
   */
  responseExtractor?: (payload: unknown) => string;

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
  sessionIdExtractor?: (req: FastifyRequest) => string;
}

/**
 * Extended Request interface with guardrails metadata.
 */
export interface GuardrailsRequest extends FastifyRequest {
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
 * Error handler function type.
 */
export type ErrorHandler = (result: GuardrailResult, req: FastifyRequest, reply: FastifyReply) => void | Promise<void>;

/**
 * @deprecated Body extractor is no longer needed.
 * The plugin automatically extracts content from request body.
 */
export type BodyExtractor = never;

/**
 * Response extractor function type.
 */
export type ResponseExtractor = (payload: unknown) => string;
