/**
 * Monitoring Logger
 *
 * Enhanced logger with structured logging, metrics, and audit trails.
 *
 * @package @blackunicorn/bonklm
 */

import type { Logger } from '../base/GenericLogger.js';
import { redactPIIInObject, redactPIIInStringSync } from '../guards/pii/validators.js';

/**
 * Log level
 */
export enum MonitoringLogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  SILENT = 4
}

/**
 * Log entry
 */
export interface LogEntry {
  level: MonitoringLogLevel;
  timestamp: number;
  message: string;
  context?: Record<string, unknown>;
  error?: {
    name: string;
    message: string;
    stack?: string;
    code?: string;
  };
  metadata?: {
    runId?: string;
    connector?: string;
    operation?: string;
    [key: string]: unknown;
  };
}

/**
 * Metrics data
 */
export interface MetricsData {
  counters: Record<string, number>;
  gauges: Record<string, number>;
  histograms: Record<string, number[]>;
  timestamps: Record<string, number>;
}

/**
 * Monitoring logger options
 */
export interface MonitoringLoggerOptions {
  /** Minimum log level */
  level?: MonitoringLogLevel;
  /** Enable JSON formatting */
  json?: boolean;
  /** Enable metrics collection */
  metrics?: boolean;
  /** Enable audit logging */
  audit?: boolean;
  /** Log prefix */
  prefix?: string;
  /** Custom logger implementation */
  logger?: Logger;
  /** Sample rate for debug logs (0-1) */
  sampleRate?: number;
}

/**
 * Default monitoring logger options
 */
const DEFAULT_OPTIONS: Required<Omit<MonitoringLoggerOptions, 'logger'>> = {
  level: MonitoringLogLevel.INFO,
  json: false,
  metrics: false,
  audit: false,
  prefix: '',
  sampleRate: 1.0
};

/**
 * Monitoring Logger
 *
 * Enhanced logger with structured logging, metrics collection, and audit trails.
 */
export class MonitoringLogger implements Logger {
  private readonly options: Required<Omit<MonitoringLoggerOptions, 'logger'>>;
  private readonly baseLogger: Logger;
  private readonly metrics: MetricsData = {
    counters: {},
    gauges: {},
    histograms: {},
    timestamps: {}
  };
  private readonly auditLog: LogEntry[] = [];
  private readonly maxAuditEntries = 1000;

  constructor(options: MonitoringLoggerOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.baseLogger = options.logger || console;
  }

  /**
   * Log debug message
   */
  debug(message: string, context?: Record<string, unknown>): void {
    if (this.options.level <= MonitoringLogLevel.DEBUG) {
      this.log(MonitoringLogLevel.DEBUG, message, context);
    }
  }

  /**
   * Log info message
   */
  info(message: string, context?: Record<string, unknown>): void {
    if (this.options.level <= MonitoringLogLevel.INFO) {
      this.log(MonitoringLogLevel.INFO, message, context);
    }
  }

  /**
   * Log warning message
   */
  warn(message: string, context?: Record<string, unknown>): void {
    if (this.options.level <= MonitoringLogLevel.WARN) {
      this.log(MonitoringLogLevel.WARN, message, context);
    }
  }

  /**
   * Log error message
   */
  error(message: string, context?: Record<string, unknown>): void {
    if (this.options.level <= MonitoringLogLevel.ERROR) {
      this.log(MonitoringLogLevel.ERROR, message, context);
    }
  }

  /**
   * Increment a counter metric
   */
  incrementCounter(name: string, value: number = 1): void {
    if (!this.options.metrics) return;

    this.metrics.counters[name] = (this.metrics.counters[name] || 0) + value;
  }

  /**
   * Set a gauge metric
   */
  setGauge(name: string, value: number): void {
    if (!this.options.metrics) return;

    this.metrics.gauges[name] = value;
  }

  /**
   * Record a value in a histogram
   */
  recordHistogram(name: string, value: number): void {
    if (!this.options.metrics) return;

    if (!this.metrics.histograms[name]) {
      this.metrics.histograms[name] = [];
    }

    this.metrics.histograms[name].push(value);

    // Keep only last 1000 values
    if (this.metrics.histograms[name].length > 1000) {
      this.metrics.histograms[name].shift();
    }
  }

  /**
   * Record a timestamp
   */
  recordTimestamp(name: string, timestamp: number = Date.now()): void {
    if (!this.options.metrics) return;

    this.metrics.timestamps[name] = timestamp;
  }

  /**
   * Get all metrics
   */
  getMetrics(): MetricsData {
    return {
      counters: { ...this.metrics.counters },
      gauges: { ...this.metrics.gauges },
      histograms: Object.fromEntries(Object.entries(this.metrics.histograms).map(([k, v]) => [k, [...v]])),
      timestamps: { ...this.metrics.timestamps }
    };
  }

  /**
   * Reset all metrics
   */
  resetMetrics(): void {
    this.metrics.counters = {};
    this.metrics.gauges = {};
    this.metrics.histograms = {};
    this.metrics.timestamps = {};
  }

  /**
   * Get audit log
   */
  getAuditLog(): LogEntry[] {
    return [...this.auditLog];
  }

  /**
   * Clear audit log
   */
  clearAuditLog(): void {
    this.auditLog.length = 0;
  }

  /**
   * Sanitize context to prevent sensitive data exposure in logs.
   * Uses format-preserving PII redaction for string values.
   * Redacts potentially sensitive fields like 'content', 'match', 'secret', etc.
   */
  private sanitizeContext(context?: Record<string, unknown>): Record<string, unknown> | undefined {
    if (!context) return undefined;

    const sanitized = { ...context };
    const sensitiveKeys = ['content', 'match', 'secret', 'token', 'password', 'key', 'credential'];

    for (const key of Object.keys(sanitized)) {
      const lowerKey = key.toLowerCase();
      const isSensitiveKey = sensitiveKeys.some(sk => lowerKey.includes(sk));
      const value = sanitized[key];

      if (isSensitiveKey) {
        // Apply PII redaction to sensitive fields
        if (typeof value === 'string' && value.length > 0) {
          sanitized[key] = redactPIIInStringSync(value);
        } else if (Array.isArray(value)) {
          // Redact each string element in the array
          sanitized[key] = value.map(item =>
            typeof item === 'string'
              ? redactPIIInStringSync(item)
              : typeof item === 'object' && item !== null
                ? this.sanitizeContext(item as Record<string, unknown>)
                : item
          );
        } else if (typeof value === 'object' && value !== null) {
          // Apply PII redaction to object values
          sanitized[key] = redactPIIInObject(value as Record<string, unknown>);
        }
      } else {
        // For non-sensitive keys, still apply PII redaction as a safety measure
        if (typeof value === 'string') {
          sanitized[key] = redactPIIInStringSync(value);
        } else if (Array.isArray(value)) {
          // Redact each string element in the array
          sanitized[key] = value.map(item =>
            typeof item === 'string'
              ? redactPIIInStringSync(item)
              : typeof item === 'object' && item !== null
                ? this.sanitizeContext(item as Record<string, unknown>)
                : item
          );
        } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          // Recursively sanitize nested objects
          sanitized[key] = this.sanitizeContext(value as Record<string, unknown>);
        }
      }
    }

    return sanitized;
  }

  /**
   * Sanitize stack traces to remove sensitive information.
   * Removes file paths, line numbers, and variable values while preserving
   * the error structure for debugging.
   *
   * @param stack - The stack trace to sanitize
   * @returns Sanitized stack trace
   */
  private sanitizeStackTrace(stack?: string): string | undefined {
    if (!stack) return undefined;

    let sanitized = stack;

    // Remove file paths and line numbers from stack frames
    // Pattern: at FunctionName (/path/to/file.ts:123:45)
    sanitized = sanitized.replace(/\([^\s)]*\/[^\s)]*:\d+:\d+\)/g, '([REDACTED_FILE:LINE])');

    // Pattern: at FunctionName /path/to/file.ts:123:45
    sanitized = sanitized.replace(/at\s+[^\s]+\s+[^\s]+\/[^\s]+:\d+:\d+/g, 'at [FUNCTION] [REDACTED_FILE:LINE]');

    // Pattern: at filename.js:line:column (simple format without path)
    // Handle TypeScript and Node.js extensions: .js, .ts, .tsx, .mjs, .cjs
    sanitized = sanitized.replace(/at\s+[^\s]+\.(js|ts|tsx|mjs|cjs):\d+:\d+/g, 'at [FILE]:[LINE]');

    // Pattern: filename.js:line:column (standalone format)
    sanitized = sanitized.replace(/[^\s]+\.(js|ts|tsx|mjs|cjs):\d+:\d+/g, '[FILE]:[LINE]');

    // Handle async stack frames
    sanitized = sanitized.replace(/at\s+async\s+[^\s]+\s*\([^\)]*\)/g, 'at async [FUNCTION] ([REDACTED_FILE:LINE])');

    // Remove absolute paths from node internal modules
    sanitized = sanitized.replace(/node:[^\s]+/g, 'node:internal');

    // Remove potential credentials in error messages
    sanitized = redactPIIInStringSync(sanitized);

    return sanitized;
  }

  /**
   * Log a structured entry
   */
  private log(level: MonitoringLogLevel, message: string, context?: Record<string, unknown>): void {
    // Apply sampling for debug logs
    if (level === MonitoringLogLevel.DEBUG && this.options.sampleRate < 1.0) {
      if (Math.random() > this.options.sampleRate) return;
    }

    // Sanitize context to prevent sensitive data exposure
    const sanitizedContext = this.sanitizeContext(context);

    const entry: LogEntry = {
      level,
      timestamp: Date.now(),
      message: this.options.prefix ? `${this.options.prefix} ${message}` : message,
      context: sanitizedContext
    };

    // Add error details if present
    if (context?.error instanceof Error) {
      const error = context.error;
      entry.error = {
        name: error.name,
        message: redactPIIInStringSync(error.message),
        stack: this.sanitizeStackTrace(error.stack),
        code: (error as any).code
      };
      // Remove error from context to avoid duplication
      const { error: _, ...rest } = sanitizedContext || {};
      entry.context = rest;
    }

    // Add metadata if present
    if (context?.metadata) {
      entry.metadata = context.metadata as Record<string, unknown>;
    }

    // Add to audit log if enabled
    if (this.options.audit && (level === MonitoringLogLevel.WARN || level === MonitoringLogLevel.ERROR)) {
      this.auditLog.push(entry);
      // Keep only last N entries
      if (this.auditLog.length > this.maxAuditEntries) {
        this.auditLog.shift();
      }
    }

    // Output the log
    if (this.options.json) {
      this.baseLogger.debug(JSON.stringify(entry));
    } else {
      const levelName = MonitoringLogLevel[level];
      const contextStr = sanitizedContext ? ` ${JSON.stringify(sanitizedContext)}` : '';
      this.baseLogger.debug(`[${levelName}] ${entry.message}${contextStr}`);
    }
  }

  /**
   * Create a child logger with additional metadata
   */
  child(_metadata: Record<string, unknown>): MonitoringLogger {
    const child = new MonitoringLogger({
      ...this.options,
      logger: this.baseLogger
    });
    child.metrics.counters = { ...this.metrics.counters };
    child.metrics.gauges = { ...this.metrics.gauges };
    child.metrics.histograms = { ...this.metrics.histograms };
    child.metrics.timestamps = { ...this.metrics.timestamps };
    return child;
  }
}

/**
 * Create a monitoring logger
 */
export function createMonitoringLogger(options?: MonitoringLoggerOptions): MonitoringLogger {
  return new MonitoringLogger(options);
}
