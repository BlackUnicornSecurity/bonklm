/**
 * Express Guardrails Middleware
 * ============================
 * Express middleware for LLM security guardrails.
 *
 * Security Fixes Applied:
 * - Path traversal protection via path.normalize()
 * - Response validation uses buffering mode
 * - Production mode toggle for error messages
 * - Validation timeout via validateWithTimeoutSecure
 * - Request size limit option
 * - regression: Correct GuardrailEngine.validate() API (string context)
 * - regression: Use createLogger('console') instead of raw console
 * - regression: bodyExtractor handles string[] by normalizing to string
 * - S013-002: Prototype pollution protection in JSON.stringify
 * - S013-002: Content sanitization for malicious payloads
 * - S013-008: Request size validation using UTF-8 byte size
 * - S013-007: Security headers implementation
 * - S013-003: ConfigValidator integration for runtime configuration validation
 * - S013-004: AttackLogger integration for security event logging
 * - S013-005: SessionTracker integration for multi-request attack detection
 *
 * @package @blackunicorn/bonklm-express
 */

import type { NextFunction, Request, Response } from 'express';
import { normalize } from 'node:path';
import {
  createLogger,
  GuardrailEngine,
  type GuardrailResult,
  isSessionEscalated,
  type Logger,
  LogLevel,
  RiskLevel,
  Schema,
  serializeError,
  type SessionPatternFinding,
  Severity,
  updateSessionState,
  validateWithTimeoutSecure,
  Validators
} from '@blackunicorn/bonklm';
import type {
  BodyExtractor,
  ErrorHandler,
  GuardrailsMiddlewareConfig,
  GuardrailsRequest,
  PathMatcher
} from './types.js';

// regression: Use proper logger instead of raw console
const DEFAULT_LOGGER = createLogger('console', LogLevel.INFO);

/**
 * Thrown by the default body extractor when the request body cannot
 * be serialized (nested circular references, BigInt values, and other
 * non-JSON body-parser outputs). The middleware fails closed on this
 * error by default — see `unparsableBodyPolicy`. Signaled out-of-band
 * (throw) rather than via a string sentinel so a body that legitimately
 * CONTAINS the marker text can never be confused with an unparsable
 * body.
 */
export class UnparsableBodyError extends Error {
  constructor() {
    super('Unparsable request body');
    this.name = 'UnparsableBodyError';
  }
}

/**
 * @deprecated Kept for `unparsableBodyPolicy: 'scan-literal'` legacy
 * semantics: the literal string scanned when an unparsable body is not
 * blocked. No longer produced as an extractor return value.
 */
export const UNPARSABLE_BODY_SENTINEL = '[Unparsable body]';

// regression: Handle string | string[] return type from bodyExtractor
// Normalize to string before validation
// S013-002: Add prototype pollution protection and content sanitization
const DEFAULT_BODY_EXTRACTOR: BodyExtractor = (req: Request): string => {
  if (req.body?.message) return sanitizeBodyContent(String(req.body.message));
  if (req.body?.prompt) return sanitizeBodyContent(String(req.body.prompt));
  if (req.body?.content) return sanitizeBodyContent(String(req.body.content));
  if (req.body?.text) return sanitizeBodyContent(String(req.body.text));
  // S013-002: Safe JSON stringify with prototype pollution protection
  try {
    return JSON.stringify(req.body, (key, value) => {
      // Prevent prototype pollution
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        return undefined;
      }
      // Handle circular references. The replacer's ROOT invocation uses
      // key '' with value === req.body — replacing there would collapse
      // every body to the literal '[Circular]' (scanned clean: fail-open).
      // Only collapse NON-root self-references.
      if (key !== '' && typeof value === 'object' && value !== null && value === req.body) {
        return '[Circular]';
      }
      return value;
    });
  } catch {
    throw new UnparsableBodyError();
  }
};

/**
 * S013-002: Sanitize body content to prevent log injection and control character attacks.
 * Strips ANSI escape sequences and control characters while preserving printable content.
 */
function sanitizeBodyContent(content: string): string {
  if (typeof content !== 'string') {
    return String(content);
  }
  // Remove ANSI escape sequences
  content = content.replace(/\x1b\[[0-9;]*m/g, '');
  // Remove control characters except newline, tab, carriage return
  content = content.replace(/[\x00-\x08\x0b-\x0c\x0e-\x1f\x7f]/g, '');
  return content;
}

// regression: Production mode error handler (generic, no info leakage)
const PRODUCTION_ERROR_HANDLER: ErrorHandler = (_result: GuardrailResult, req: Request, res: Response): void => {
  res.status(400).json({
    error: 'Request blocked',
    request_id: (req as any).id || req.ip
  });
};

// Development mode error handler (verbose)
const DEVELOPMENT_ERROR_HANDLER: ErrorHandler = (result: GuardrailResult, _req: Request, res: Response): void => {
  res.status(400).json({
    error: 'Request blocked by guardrails',
    reason: result.reason,
    severity: result.severity,
    risk_level: result.risk_level
  });
};

// Path normalization for security
// Prevents path traversal attacks like /api/ai/../chat
function compilePathMatcher(pattern: string): PathMatcher {
  // Normalize the pattern and convert backslashes to forward slashes
  const normalized = normalize(pattern).replace(/\\/g, '/');
  return (path: string): boolean => {
    // Normalize the request path
    const normalizedPath = normalize(path).replace(/\\/g, '/');
    // Check if the normalized path starts with the normalized pattern
    return normalizedPath.startsWith(normalized);
  };
}

/**
 * S013-007: Add security headers to the response.
 * Adds common security headers to prevent XSS, clickjacking, and other attacks.
 *
 * defensive guard — skip when `res.getHeader` / `res.setHeader`
 * are unavailable. Express always provides them at runtime; this guard
 * lets unit tests pass minimal `Response` mocks without crashing the
 * middleware. The security headers themselves are the canonical contract
 * (CSP, X-Frame-Options, X-Content-Type-Options, X-XSS-Protection,
 * Referrer-Policy, Permissions-Policy) and remain unchanged for Express.
 *
 * the guard logs at WARN level when
 * triggered, so operators see a clear signal if a real production wrapper
 * strips response methods (e.g. an over-aggressive Proxy or an in-house
 * Response shim). Tests with minimal mocks will see the WARN line in
 * captured logs — that's expected and helps surface coverage gaps.
 */
function addSecurityHeaders(res: Response, logger?: Logger): void {
  if (
    typeof (res as { getHeader?: unknown }).getHeader !== 'function' ||
    typeof (res as { setHeader?: unknown }).setHeader !== 'function'
  ) {
    logger?.warn?.(
      '[Guardrails] addSecurityHeaders: res.getHeader/setHeader unavailable; ' +
        'CSP / X-Frame-Options / X-Content-Type-Options / X-XSS-Protection / ' +
        'Referrer-Policy / Permissions-Policy were NOT applied. This is expected ' +
        'in unit tests with minimal Response mocks, but indicates a real ' +
        'misconfiguration in production (broken Response wrapper / Proxy).'
    );
    return;
  }
  // Content-Security-Policy: Restrict resource sources
  // Default policy allows same-origin scripts and styles
  if (!res.getHeader('Content-Security-Policy')) {
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'"
    );
  }

  // X-Frame-Options: Prevent clickjacking
  if (!res.getHeader('X-Frame-Options')) {
    res.setHeader('X-Frame-Options', 'DENY');
  }

  // X-Content-Type-Options: Prevent MIME sniffing
  if (!res.getHeader('X-Content-Type-Options')) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
  }

  // X-XSS-Protection: Enable XSS filter (legacy browsers)
  if (!res.getHeader('X-XSS-Protection')) {
    res.setHeader('X-XSS-Protection', '1; mode=block');
  }

  // Referrer-Policy: Control referrer information
  if (!res.getHeader('Referrer-Policy')) {
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  }

  // Permissions-Policy: Restrict browser features
  if (!res.getHeader('Permissions-Policy')) {
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  }
}

/**
 * S013-003: Configuration validation schema for Express middleware.
 * Validates middleware configuration at initialization time.
 */
// fix: EVERY field in `GuardrailsMiddlewareConfig` is optional
// from the user's perspective — `createGuardrailsMiddleware` destructures
// with defaults for all of them. The original schema marked them as
// required, which broke when callers passed sparse configs (the documented
// `{ validators: [...] }`-only shape from the JSDoc example). Wrap each
// in `Validators.optional(...)` so the schema validates SHAPES when
// supplied, but does not reject missing fields. The validators/guards
// arrays additionally use `validatorInstance` (object-shape OR callable)
// since canonical validators are class instances.
const EXPRESS_CONFIG_SCHEMA = new Schema({
  validators: Validators.optional(Validators.array(Validators.validatorInstance, 0, 100)),
  guards: Validators.optional(Validators.array(Validators.validatorInstance, 0, 100)),
  validateRequest: Validators.optional(Validators.boolean),
  validateResponse: Validators.optional(Validators.boolean),
  validateResponseMode: Validators.optional(Validators.enum(['buffer', 'disabled'] as const)),
  onRequestOnly: Validators.optional(Validators.boolean),
  paths: Validators.optional(Validators.array(Validators.string, 0, 100)),
  excludePaths: Validators.optional(Validators.array(Validators.string, 0, 100)),
  logger: Validators.optional(Validators.loggerInstance),
  productionMode: Validators.optional(Validators.boolean),
  validationTimeout: Validators.optional(Validators.timeout),
  maxContentLength: Validators.optional(Validators.positiveNumber(0)),
  onError: Validators.optional(Validators.function),
  bodyExtractor: Validators.optional(Validators.function),
  responseExtractor: Validators.optional(Validators.function),
  // S013-004: AttackLogger is optional. Sprint 29: switched from
  // `function` to `attackLoggerInstance` — canonical AttackLogger is
  // a class instance, not a bare callable.
  attackLogger: Validators.optional(Validators.attackLoggerInstance),
  // S013-005: Session tracking options
  enableSessionTracking: Validators.optional(Validators.boolean),
  sessionIdExtractor: Validators.optional(Validators.function),
  unparsableBodyPolicy: Validators.optional(Validators.enum(['block', 'scan-literal'] as const))
});

/**
 * S013-003: Validate middleware configuration at initialization.
 * Throws if configuration is invalid.
 */
function validateExpressConfig(config: GuardrailsMiddlewareConfig): void {
  EXPRESS_CONFIG_SCHEMA.validateOrThrow(config as Record<string, unknown>);
}

/**
 * Create Express middleware for LLM guardrails.
 *
 * @param config - Middleware configuration options
 * @returns Express middleware function
 *
 * @example
 * ```typescript
 * import express from 'express';
 * import { createGuardrailsMiddleware } from '@blackunicorn/bonklm-express';
 * import { PromptInjectionValidator } from '@blackunicorn/bonklm';
 *
 * const app = express();
 * app.use(express.json());
 *
 * app.use('/api/ai', createGuardrailsMiddleware({
 *   validators: [new PromptInjectionValidator()],
 *   validateRequest: true,
 *   validateResponse: false,
 * }));
 * ```
 */
export function createGuardrailsMiddleware(
  config: GuardrailsMiddlewareConfig = {}
): (req: GuardrailsRequest, res: Response, next: NextFunction) => void {
  // S013-003: Validate configuration at initialization
  validateExpressConfig(config);

  const {
    validators = [],
    guards = [],
    validateRequest = true,
    validateResponse = false,
    validateResponseMode = 'buffer', // Default to buffer mode
    onRequestOnly = false,
    paths = [],
    excludePaths = [],
    logger = DEFAULT_LOGGER, // regression: Use proper logger
    productionMode = process.env.NODE_ENV === 'production',
    validationTimeout = 5000, // Default 5 second timeout
    maxContentLength = 1024 * 1024, // Default 1MB limit
    onError,
    bodyExtractor = DEFAULT_BODY_EXTRACTOR,
    // Fail closed on bodies the default extractor cannot serialize —
    // a guardrail must not hand a verdict on content it could not read.
    // 'scan-literal' preserves the legacy lenient behavior.
    unparsableBodyPolicy = 'block',
    attackLogger, // S013-004: Optional AttackLogger instance
    enableSessionTracking = false, // S013-005: Session tracking disabled by default
    sessionIdExtractor // S013-005: Optional custom session ID extractor
  } = config;

  const engine = new GuardrailEngine({
    validators,
    guards,
    logger
  });

  // S013-004: Register AttackLogger intercept callback if provided
  if (attackLogger) {
    // The AttackLogger type is defined in types.ts and used for config validation
    // We need to call getInterceptCallback() to register with the engine
    engine.onIntercept(attackLogger.getInterceptCallback());
  }

  // S013-005: Default session ID extractor
  const defaultSessionIdExtractor = (req: Request): string => {
    // Try common session patterns
    if ((req as any).session?.id) return (req as any).session.id;
    if ((req as any).sessionID) return (req as any).sessionID;
    if ((req as any).sessionId) return (req as any).sessionId;
    // Fall back to IP-based session (not ideal for production with proxies)
    return `ip-${req.ip || req.socket.remoteAddress || 'unknown'}`;
  };

  const getSessionId = sessionIdExtractor || defaultSessionIdExtractor;

  // Compile path matchers with normalization
  const pathMatchers = paths.map(compilePathMatcher);
  const excludeMatchers = excludePaths.map(compilePathMatcher);

  // Path matching with normalization
  const shouldProcessPath = (path: string): boolean => {
    const normalizedPath = normalize(path).replace(/\\/g, '/');

    // Check exclusions first
    if (excludeMatchers.some(matcher => matcher(normalizedPath))) {
      return false;
    }

    // Check inclusions
    if (pathMatchers.length === 0) return true;
    return pathMatchers.some(matcher => matcher(normalizedPath));
  };

  // Create timeout wrapper for validation.
  //
  // routes through the canonical `validateWithTimeoutSecure`
  // primitive from core/connector-utils. Replaces the broken
  // AbortController pattern (signal never propagated to engine.validate).
  const validateWithTimeout = async (content: string, context?: string): Promise<GuardrailResult[]> => {
    // regression: Use correct API signature (string context, not object)
    const result = await validateWithTimeoutSecure<GuardrailResult>({
      operation: async () => {
        const r = await engine.validate(content, context);
        return r;
      },
      timeoutMs: validationTimeout,
      timeoutSentinel: () => ({
        allowed: false,
        blocked: true,
        severity: Severity.CRITICAL,
        risk_level: RiskLevel.HIGH,
        risk_score: 100,
        findings: [],
        timestamp: Date.now(),
        reason: 'Validation timeout'
      }),
      logger
    });
    return [result];
  };

  // Select error handler based on production mode
  const errorHandler = onError ?? (productionMode ? PRODUCTION_ERROR_HANDLER : DEVELOPMENT_ERROR_HANDLER);

  return function guardrailsMiddleware(req: GuardrailsRequest, res: Response, next: NextFunction): void {
    // S013-007: Add security headers
    addSecurityHeaders(res, logger);

    // Skip if path not in scope
    if (!shouldProcessPath(req.path)) {
      return next();
    }

    // Skip if already validated
    if (req._guardrailsValidated) {
      return next();
    }

    // Request validation
    if (validateRequest) {
      // Async validation - don't block the event loop
      (async () => {
        try {
          // Extract content from request body. The default extractor
          // signals unparsable bodies by throwing UnparsableBodyError
          // (out-of-band — a body legitimately containing the legacy
          // marker text is never misclassified).
          let extractedContent: string | string[];
          try {
            extractedContent = bodyExtractor(req);
          } catch (error) {
            if (!(error instanceof UnparsableBodyError)) throw error;
            // Fail closed on unparsable bodies: scanning the literal
            // string would always validate clean — a fail-open path.
            if (unparsableBodyPolicy === 'block') {
              logger.warn('[Guardrails] Unparsable request body — blocking (fail-closed)', { path: req.path });
              return errorHandler(
                {
                  allowed: false,
                  blocked: true,
                  severity: Severity.CRITICAL,
                  risk_level: RiskLevel.HIGH,
                  risk_score: 100,
                  findings: [],
                  timestamp: Date.now(),
                  reason: 'Unparsable request body'
                },
                req,
                res
              );
            }
            // scan-literal legacy semantics
            extractedContent = UNPARSABLE_BODY_SENTINEL;
          }

          // regression: Normalize to string before validation
          const content = Array.isArray(extractedContent) ? extractedContent.join(' ') : extractedContent;

          // S013-008: Check content byte size (UTF-8) instead of character length
          const contentByteLength = Buffer.byteLength(content, 'utf8');
          if (contentByteLength > maxContentLength) {
            logger.warn('[Guardrails] Content too large', {
              byteLength: contentByteLength,
              max: maxContentLength
            });
            return errorHandler(
              {
                allowed: false,
                blocked: true,
                severity: Severity.WARNING,
                risk_level: RiskLevel.MEDIUM,
                risk_score: 50,
                findings: [],
                timestamp: Date.now(),
                reason: 'Content too large'
              },
              req,
              res
            );
          }

          // S013-005: Check session escalation before validation
          if (enableSessionTracking) {
            const sessionId = getSessionId(req);
            const escalationCheck = isSessionEscalated(sessionId);
            if (escalationCheck.escalated) {
              logger.warn('[Guardrails] Session escalated, blocking request', {
                sessionId,
                reason: escalationCheck.reason
              });
              return errorHandler(
                {
                  allowed: false,
                  blocked: true,
                  severity: Severity.CRITICAL,
                  risk_level: RiskLevel.HIGH,
                  risk_score: escalationCheck.riskScore,
                  findings: [],
                  timestamp: Date.now(),
                  reason: `Session escalated: ${escalationCheck.reason}`
                },
                req,
                res
              );
            }
          }

          // regression: Use correct API signature (string context)
          const results = await validateWithTimeout(content, 'input');

          req._guardrailsResults = results;

          // S013-005: Update session state with findings
          if (enableSessionTracking) {
            const sessionId = getSessionId(req);
            // Convert GuardrailResult findings to SessionPatternFinding format
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
            if (findings.length > 0) {
              const sessionResult = updateSessionState(sessionId, findings);
              if (sessionResult.shouldEscalate) {
                logger.warn('[Guardrails] Session escalated after validation', {
                  sessionId,
                  reason: sessionResult.reason
                });
                // Escalate the risk score based on session state
                const escalatedResult = {
                  allowed: false,
                  blocked: true,
                  severity: Severity.CRITICAL,
                  risk_level: RiskLevel.HIGH,
                  risk_score: sessionResult.riskScore,
                  findings: results.flatMap(r => r.findings || []),
                  timestamp: Date.now(),
                  reason: `Session escalation: ${sessionResult.reason}`
                };
                return errorHandler(escalatedResult, req, res);
              }
            }
          }

          const blocked = results.find(r => !r.allowed);
          if (blocked) {
            logger.warn('[Guardrails] Request blocked', {
              reason: blocked.reason,
              path: req.path
            });
            return errorHandler(blocked, req, res);
          }

          req._guardrailsValidated = true;
          next();
        } catch (error) {
          // Sprint 40 hardening (architect HIGH-1 + security S40-3):
          // sister site to nestjs.service.ts:263 + nestjs.interceptor.ts:324.
          // Use the canonical primitive.
          logger.error('[Guardrails] Validation error', { error: serializeError(error) });
          // Fail-closed: block on error
          return errorHandler(
            {
              allowed: false,
              blocked: true,
              severity: Severity.CRITICAL,
              risk_level: RiskLevel.HIGH,
              risk_score: 100,
              findings: [],
              timestamp: Date.now(),
              reason: 'Validation error'
            },
            req,
            res
          );
        }
      })();
      return; // Return early since we're handling async
    }

    // Response validation only in buffer mode
    // Note: Response validation in Express is tricky because headers are already sent
    if (validateResponse && validateResponseMode === 'buffer' && !onRequestOnly) {
      const originalSend = res.send;
      const chunks: Buffer[] = [];

      // Override res.write to buffer chunks
      const originalWrite = res.write.bind(res);
      res.write = function (this: Response, chunk: any, cb?: any): boolean {
        if (chunk) {
          chunks.push(Buffer.from(chunk));
        }
        return originalWrite(chunk, cb);
      } as any;

      // Override res.send to buffer and validate
      res.send = function (data: any): Response {
        if (data) {
          chunks.push(Buffer.from(data));
        }

        const content = Buffer.concat(chunks).toString('utf8');

        // Validate response before sending
        validateWithTimeout(content, 'output')
          .then(results => {
            const blocked = results.find(r => !r.allowed);
            if (blocked) {
              logger.warn('[Guardrails] Response blocked', {
                reason: blocked.reason,
                path: req.path
              });
              // Don't leak original content in production
              if (productionMode) {
                return res.status(500).json({ error: 'Response filtered' });
              }
              return res.status(500).json({
                error: 'Response filtered by guardrails',
                reason: blocked.reason
              });
            }
            // Content is safe, send it
            return originalSend.call(this, data);
          })
          .catch(error => {
            logger.error('[Guardrails] Response validation error', { error });
            // Fail-closed: don't send response if validation fails
            return res.status(500).json({ error: 'Validation error' });
          });

        return this;
      };
    }

    next();
  };
}

export type { GuardrailsMiddlewareConfig, GuardrailsRequest, ErrorHandler, BodyExtractor };
