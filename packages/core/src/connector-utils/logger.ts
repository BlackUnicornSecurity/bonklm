/**
 * Connector Utilities - Standard Logger
 * =====================================
 *
 * Standard logger creation for consistent logging across connectors.
 *
 * @package @blackunicorn/bonklm/core
 */

import { createLogger, type Logger } from '../base/GenericLogger.js';

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
      sanitized[key] = stripLogControlChars(value);
    }
  }

  return sanitized;
}

/**
 * Strip ASCII control characters (0x00-0x1F + DEL 0x7F) from a
 * string and truncate to 256 chars. Used by `sanitizeLogMetadata`
 * to defeat log-injection via attacker-controlled names.
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
  logger.warn(`Timeout: ${stripLogControlChars(operation)}`, {
    timeout: `${timeoutMs}ms`,
  });
}
