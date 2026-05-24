/**
 * Connector Utilities - Standard Logger
 * =====================================
 *
 * Standard logger creation for consistent logging across connectors.
 *
 * @package @blackunicorn/bonklm/core
 */

import { createLogger, type Logger } from '../base/GenericLogger.js';
import { sanitizeLogString } from '../common/index.js';

/**
 * Standard logger options for connectors.
 */
export interface StandardLoggerOptions {
  /** Logger instance (if not provided, creates a console logger) */
  logger?: Logger;
  /** Log level for the connector */
  logLevel?: 'debug' | 'info' | 'warn' | 'error' | 'silent';
  /** Prefix for log messages */
  prefix?: string;
}

/**
 * Creates a standard logger for connector use.
 * Ensures consistent logging patterns across all connectors.
 *
 * @param options - Logger options
 * @returns Logger instance
 *
 * @example
 * ```ts
 * const logger = createStandardLogger({ prefix: '[Pinecone Guardrails]' });
 * logger.info('Query executed', { topK: 10 });
 * ```
 */
export function createStandardLogger(options: StandardLoggerOptions = {}): Logger {
  const { logger, prefix } = options;

  if (logger) {
    // If prefix provided, wrap the logger to add prefix
    if (prefix) {
      return createPrefixedLogger(logger, prefix);
    }
    return logger;
  }

  // Default to console logger
  return createLogger('console');
}

/**
 * Wraps a logger to add a prefix to all messages.
 *
 * @param baseLogger - Base logger to wrap
 * @param prefix - Prefix to add to messages
 * @returns Wrapped logger
 *
 * @internal
 */
function createPrefixedLogger(baseLogger: Logger, prefix: string): Logger {
  return {
    debug: (message: string, meta?: Record<string, unknown>) => {
      baseLogger.debug(`${prefix} ${message}`, meta);
    },
    info: (message: string, meta?: Record<string, unknown>) => {
      baseLogger.info(`${prefix} ${message}`, meta);
    },
    warn: (message: string, meta?: Record<string, unknown>) => {
      baseLogger.warn(`${prefix} ${message}`, meta);
    },
    error: (message: string, error?: Error | Record<string, unknown>) => {
      // Convert Error to LogContext format
      const context = error instanceof Error
        ? { error: error.message, name: error.name }
        : error;
      baseLogger.error(`${prefix} ${message}`, context);
    },
  };
}

/**
 * Creates a logger specific to a connector type.
 *
 * @param connectorName - Name of the connector (e.g., 'pinecone', 'openai')
 * @param options - Logger options
 * @returns Logger instance
 *
 * @example
 * ```ts
 * const logger = createConnectorLogger('pinecone');
 * const logger = createConnectorLogger('openai', { logLevel: 'warn' });
 * ```
 */
export function createConnectorLogger(
  connectorName: string,
  options: Omit<StandardLoggerOptions, 'prefix'> = {}
): Logger {
  return createStandardLogger({
    ...options,
    prefix: `[${connectorName} Guardrails]`,
  });
}

/**
 * Sanitizes sensitive data from log metadata.
 * Removes or masks API keys, tokens, and other sensitive information.
 *
 * @param meta - Metadata object to sanitize
 * @returns Sanitized metadata
 *
 * @example
 * ```ts
 * logger.info('Request sent', sanitizeLogMetadata({
 *   apiKey: 'sk-1234',
 *   model: 'gpt-4'
 * }));
 * // Logs: { apiKey: '[REDACTED]', model: 'gpt-4' }
 * ```
 */
export function sanitizeLogMetadata(
  meta: Record<string, unknown>
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = { ...meta };
  const sensitiveKeys = [
    'apiKey',
    'api_key',
    'apikey',
    'token',
    'authorization',
    'password',
    'secret',
    'credential',
    'accessToken',
    'access_token',
    'refreshToken',
    'refresh_token',
    'privateKey',
    'private_key',
  ];

  for (const key of Object.keys(sanitized)) {
    const lowerKey = key.toLowerCase();
    if (sensitiveKeys.some((sk) => lowerKey.includes(sk.toLowerCase()))) {
      const value = sanitized[key];
      if (typeof value === 'string' && value.length > 0) {
        // Show first 4 and last 4 chars
        if (value.length <= 8) {
          sanitized[key] = '[REDACTED]';
        } else {
          sanitized[key] = `${value.slice(0, 4)}****${value.slice(-4)}`;
        }
      } else {
        sanitized[key] = '[REDACTED]';
      }
    }
  }

  // Audit-loop HIGH fix #6 (adversarial): every string value in
  // metadata gets ASCII-control / newline / ANSI stripped + truncated.
  // Attacker-influenced names (handoff names, tool names, plugin
  // names) flow into structured logs unsanitised; a name carrying
  // `\nCRITICAL [BonkLM] Admin override: validation=disabled` injects
  // a fake log line into any structured logger that splits on
  // newlines or any SIEM parsing the stream. Strips the entire C0
  // control range + DEL.
  for (const key of Object.keys(sanitized)) {
    const value = sanitized[key];
    if (typeof value === 'string') {
      // Sprint 39: same-file tolerated caller of `stripLogControlChars`
      // per ADR-0001 — three internal callers preserve their existing
      // SPACE-replacement format for back-compat. New external code
      // should call `sanitizeLogString` from common/index.ts instead.
      sanitized[key] = stripLogControlChars(value);
    }
  }

  return sanitized;
}

/**
 * Strip ASCII control characters (0x00-0x1F + DEL 0x7F) from a
 * string and truncate to 256 chars. Used by `sanitizeLogMetadata`
 * to defeat log-injection via attacker-controlled names.
 *
 * @public
 *
 * @deprecated Since Sprint 39 — prefer `sanitizeLogString` from
 * `@blackunicorn/bonklm` (exported via `common/index.ts`) for new
 * code. This function is retained for
 * back-compat (it ships as the metadata-sanitizer for
 * `sanitizeLogMetadata` + `logValidationFailure` + `logTimeout`)
 * and remains `@public` per v1.0-RC1 freeze policy.
 *
 * **Behavioral divergence from `sanitizeLogString` (intentional):**
 *
 * | Aspect            | stripLogControlChars   | sanitizeLogString    |
 * | ----------------- | ---------------------- | -------------------- |
 * | Strip set         | `0x00-0x1F`, `0x7F`    | same                 |
 * | Replacement       | SPACE (` `)            | `\xNN` hex escape    |
 * | Cap               | 256 chars (no marker)  | 500 + `…[truncated]` |
 * | Newline handling  | replaced with SPACE    | literal `\\n` marker |
 *
 * The SPACE replacement loses forensic signal (a TAB-injection
 * attack becomes indistinguishable from legitimate space-padded
 * input — `"name": "legit payload"` vs
 * `"name": "malicious\x09phantom\x09column"` collapse to identical
 * output post-sanitize), but produces more human-readable log
 * lines for the connector-internal metadata use case. **This is
 * an accepted residual risk** — the deprecation tag exists so
 * new code prefers `sanitizeLogString`'s preserved-signal hex
 * escape. Removal target: v2.0 — see Sprint 39 ADR
 * `docs/contributing/adr/0001-log-sanitization.md`.
 */
export function stripLogControlChars(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 256);
}

/**
 * Logs a validation failure with consistent formatting.
 *
 * @param logger - Logger instance
 * @param reason - Reason for validation failure
 * @param context - Additional context about the failure
 *
 * @example
 * ```ts
 * logValidationFailure(logger, result.reason, {
 *   contentType: 'query',
 *   contentLength: query.length
 * });
 * ```
 */
export function logValidationFailure(
  logger: Logger,
  reason: string,
  context?: Record<string, unknown>
): void {
  // Audit-loop HIGH fix #6: `reason` originates from validator output
  // which can carry attacker-influenced text (e.g. matched pattern
  // content); strip control chars + truncate before logging.
  logger.warn('Validation blocked', {
    // Sprint 39 ADR-0001: same-file tolerated caller of the
    // deprecated `stripLogControlChars`. Removal target v2.0.
    reason: stripLogControlChars(reason),
    ...sanitizeLogMetadata(context ?? {}),
  });
}

/**
 * Logs a timeout with consistent formatting.
 *
 * @param logger - Logger instance
 * @param operation - Operation that timed out
 * @param timeoutMs - Timeout duration in milliseconds
 *
 * @example
 * ```ts
 * logTimeout(logger, 'query validation', 30000);
 * ```
 */
export function logTimeout(
  logger: Logger,
  operation: string,
  timeoutMs: number
): void {
  // Sprint 38 CWE-117 sweep: `operation` is a caller-supplied label
  // (typically static like 'query validation'), but connector authors
  // may derive it from request metadata (e.g. `${requestId} validate`)
  // where attacker-influenced data could land. Strip control chars
  // before template interpolation. Uses the same-file
  // `stripLogControlChars` helper for consistency with
  // `logValidationFailure` (which already strips its `reason` arg).
  // Sprint 39 ADR-0001: same-file tolerated caller of the
  // deprecated `stripLogControlChars`. Removal target v2.0.
  logger.warn(`Timeout: ${stripLogControlChars(operation)}`, {
    timeout: `${timeoutMs}ms`,
  });
}

/**
 * Sanitize a value of unknown type for inclusion in a structured-
 * logger meta object. Combines `String()` coercion (converts numbers,
 * objects, symbols to their string representation) with
 * `sanitizeLogString` CWE-117 hardening. Single source of truth for
 * the `sanitizeLogString(String(x))` combo that proliferated across
 * connector packages during Sprint 40.
 *
 * Use this at every connector-boundary meta-field that may carry
 * caller-supplied content (`messageId`, `sessionId`, `toolName`,
 * `channel`, `userId`, `reason`, `runId`, etc.). Per Sprint 40
 * defensive-by-default policy: prefer over-sanitization to
 * misclassification of attacker-control surface.
 *
 * Treats nullish input (`null` / `undefined`) as empty string so the
 * meta object always serializes a string-typed value (downstream
 * SIEM ingestors prefer stable shapes over conditional fields).
 *
 * **Symbol/object-toString safety (Sprint 41 security audit S41-1):**
 * `String(Symbol('inject\nfake'))` returns `"Symbol(inject\nfake)"`
 * — with the embedded `\n` intact. The CWE-117 defence is provided
 * by the subsequent `sanitizeLogString` call, NOT by `String()`.
 * Same applies to objects with hostile `toString()`. The `String()`
 * step is shape-coercion only; sanitization is a separate layer.
 *
 * @public
 *
 * Sprint 41 — consolidates the
 * `sanitizeLogString(String(x ?? ''))` combo from Sprint 40.
 *
 * @example
 * ```ts
 * logger.warn('Tool blocked', {
 *   toolName: sanitizeMeta(context.toolName),
 *   sessionId: sanitizeMeta(context.sessionId),
 * });
 * ```
 */
export function sanitizeMeta(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  // Sprint 43 security MEDIUM #5 closure: a value with a hostile
  // `toString()` that throws will propagate the exception out of
  // `String(value)`, crashing the calling log line. Wrap in a
  // try/catch — fail-closed to a static `[unstringifiable]` marker
  // so the log call still completes with safe content.
  try {
    return sanitizeLogString(String(value));
  } catch {
    return '[unstringifiable]';
  }
}
