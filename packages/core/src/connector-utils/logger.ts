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
      const context = error instanceof Error ? { error: error.message, name: error.name } : error;
      baseLogger.error(`${prefix} ${message}`, context);
    }
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
    prefix: `[${connectorName} Guardrails]`
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
export function sanitizeLogMetadata(meta: Record<string, unknown>): Record<string, unknown> {
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
    'private_key'
  ];

  for (const key of Object.keys(sanitized)) {
    const lowerKey = key.toLowerCase();
    if (sensitiveKeys.some(sk => lowerKey.includes(sk.toLowerCase()))) {
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
  // metadata gets CWE-117 hardened. Attacker-influenced names
  // (handoff names, tool names, plugin names) flow into structured
  // logs unsanitised; a name carrying
  // `\nCRITICAL [BonkLM] Admin override: validation=disabled` injects
  // a fake log line into any structured logger that splits on
  // newlines or any SIEM parsing the stream.
  //
  // Sprint 50 (ADR-0001 D#2 revision): migrated from the deprecated
  // `stripLogControlChars` (SPACE-replacement, 256-cap) to the
  // canonical `sanitizeLogString` (hex-escape, 500-cap, `\n` marker).
  // Pre-publish v1.0.0-rc.4 cut is the right window to break the
  // legacy log format: zero downstream consumers depend on the SPACE
  // form, and the hex-escape preserves forensic signal a SOC analyst
  // needs to triage a TAB-injection attempt apart from a legitimate
  // space-padded input.
  //
  // **Order invariant (re-validated):** the sensitive-key
  // redaction loop above runs FIRST. The per-value sanitize pass
  // here runs over already-redacted partial-reveal strings (e.g.
  // `sk-a****1234`) — never over raw secret material. This is by
  // design: re-running `sanitizeLogString` over an already-safe
  // partial-reveal is a no-op for printable ASCII and a defence-in-
  // depth measure for any non-sensitive key whose value carries
  // control chars.
  for (const key of Object.keys(sanitized)) {
    const value = sanitized[key];
    if (typeof value === 'string') {
      sanitized[key] = sanitizeLogString(value);
    }
  }

  return sanitized;
}

/**
 * Strip ASCII control characters (0x00-0x1F + DEL 0x7F) from a
 * string and truncate to 256 chars. Replaces with SPACE.
 *
 * @public
 *
 * @deprecated Since Sprint 39 — prefer `sanitizeLogString` from
 * `@blackunicorn/bonklm` (exported via `common/index.ts`) for new
 * code. The three previous internal callers (`sanitizeLogMetadata`
 * / `logValidationFailure` / `logTimeout`) migrated to
 * `sanitizeLogString` (ADR-0001 Decision #2 revision).
 * This function is retained as `@public` for back-compat with any
 * external consumer who imported it during the rc.1 → rc.3 window;
 * removal target is v2.0 per ADR-0001 Decision #4.
 *
 * **Behavioral divergence from `sanitizeLogString` (why you should
 * prefer the canonical):**
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
 * output post-sanitize). `sanitizeLogString`'s hex-escape preserves
 * the attack fingerprint for SOC triage. See
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
export function logValidationFailure(logger: Logger, reason: string, context?: Record<string, unknown>): void {
  // Audit-loop HIGH fix #6: `reason` originates from validator output
  // which can carry attacker-influenced text (e.g. matched pattern
  // content); hex-escape control chars + cap before logging.
  //
  // Sprint 50 (ADR-0001 D#2 revision): migrated from the deprecated
  // `stripLogControlChars` to the canonical `sanitizeLogString` so
  // the forensic signal (TAB-injection, CRLF-injection) survives
  // the sanitisation layer instead of collapsing to indistinguishable
  // SPACE padding.
  logger.warn('Validation blocked', {
    reason: sanitizeLogString(reason),
    ...sanitizeLogMetadata(context ?? {})
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
export function logTimeout(logger: Logger, operation: string, timeoutMs: number): void {
  // CWE-117 sweep: `operation` is a caller-supplied label
  // (typically static like 'query validation'), but connector authors
  // may derive it from request metadata (e.g. `${requestId} validate`)
  // where attacker-influenced data could land. Hex-escape control
  // chars before template interpolation.
  //
  // Sprint 50 (ADR-0001 D#2 revision): migrated from the deprecated
  // `stripLogControlChars` to the canonical `sanitizeLogString`.
  logger.warn(`Timeout: ${sanitizeLogString(operation)}`, {
    timeout: `${timeoutMs}ms`
  });
}

/**
 * Sanitize a value of unknown type for inclusion in a structured-
 * logger meta object. Combines `String()` coercion (converts numbers,
 * objects, symbols to their string representation) with
 * `sanitizeLogString` CWE-117 hardening. Single source of truth for
 * the `sanitizeLogString(String(x))` combo that proliferated across
 * connector packages.
 *
 * Use this at every connector-boundary meta-field that may carry
 * caller-supplied content (`messageId`, `sessionId`, `toolName`,
 * `channel`, `userId`, `reason`, `runId`, etc.).
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
 * `sanitizeLogString(String(x ?? ''))` combo.
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
  // a value with a hostile
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
