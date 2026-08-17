/**
 * Express Middleware Types for BonkLM
 * ============================================
 * Type definitions for the Express middleware with all security fixes applied.
 *
 * Security Fixes Applied:
 * - Path normalization via path.normalize()
 * - Buffer mode for response validation
 * - Production mode toggle for error messages
 * - Validation timeout via validateWithTimeoutSecure
 * - Request size limit option
 * - regression: Correct GuardrailEngine API (string context)
 * - regression: Logger type instead of GenericLogger
 * - regression: bodyExtractor returns string (normalized from string[])
 */

import type { Request, Response } from 'express';
import type { Guard, GuardrailResult, Logger, Validator } from '@blackunicorn/bonklm';
import type { AttackLogger } from '@blackunicorn/bonklm-logger';

/**
 * Path matching function type.
 * Uses normalized path comparison for security.
 */
export type PathMatcher = (path: string) => boolean;

/**
 * Configuration options for the guardrails middleware.
 */
export interface GuardrailsMiddlewareConfig {
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
   * WARNING: Response validation in Express is limited because headers
   * are already sent when the middleware processes responses. Only buffer
   * mode is supported for response validation.
   *
   * @default false
   */
  validateResponse?: boolean;

  /**
   * Response validation mode.
   *
   * - 'buffer': Buffer entire response, validate, then send
   * - 'disabled': Disable response validation (recommended for streaming)
   *
   * @default 'buffer'
   */
  validateResponseMode?: 'buffer' | 'disabled';

  /**
   * If true, only validate requests (skip response validation).
   * Recommended for production to avoid response buffering issues.
   * @default false
   */
  onRequestOnly?: boolean;

  /**
   * Only process requests matching these paths.
   * Uses path normalization for security.
   * If empty, all paths are processed (except excludePaths).
   */
  paths?: string[];

  /**
   * Exclude these paths from validation.
   * Uses path normalization for security.
   */
  excludePaths?: string[];

  /**
   * Logger instance (regression: Use Logger type, not GenericLogger).
   * Defaults to console logger.
   */
  logger?: Logger;

  /**
   * Production mode flag.
   * When true, error messages are generic to prevent information leakage.
   * When false, detailed error messages are returned.
   * @default process.env.NODE_ENV === 'production'
   */
  productionMode?: boolean;

  /**
   * Validation timeout in milliseconds.
   * Uses validateWithTimeoutSecure (canonical primitive) to enforce timeout.
   * @default 5000
   */
  validationTimeout?: number;

  /**
   * Maximum content length in bytes.
   * Requests larger than this are rejected without validation.
   * @default 1048576 (1MB)
   */
  maxContentLength?: number;

  /**
   * Custom error handler.
   * Called when validation fails.
   */
  onError?: (result: GuardrailResult, req: Request, res: Response) => void;

  /**
   * Custom extractor for request body content.
   * Should return a string for validation (regression).
   *
   * The return value is normalized to string before validation.
   */
  bodyExtractor?: (req: Request) => string | string[];

  /**
   * Custom extractor for response content.
   * Only used in buffer mode for response validation.
   */
  responseExtractor?: (res: Response) => string;

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
   * Custom extractor for session ID from request.
   * Defaults to extracting from `session.id`, `req.sessionID`, or a generated ID.
   */
  sessionIdExtractor?: (req: Request) => string;

  /**
   * Policy for bodies the default extractor cannot serialize.
   * - `'block'` (default): reject the request — a guardrail must not
   *   issue a verdict on content it could not read.
   * - `'scan-literal'`: legacy behavior — scan the literal sentinel
   *   string (always validates clean; NOT recommended).
   * @default 'block'
   */
  unparsableBodyPolicy?: 'block' | 'scan-literal';
}

/**
 * Extended Request interface with guardrails metadata.
 */
export interface GuardrailsRequest extends Omit<Request, 'path'> {
  /**
   * The request path (from Express).
   */
  path: string;

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
export type ErrorHandler = (result: GuardrailResult, req: Request, res: Response) => void;

/**
 * Body extractor function type (regression).
 */
export type BodyExtractor = (req: Request) => string | string[];
