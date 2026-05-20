/**
 * Attack Logger - Main Logger Class
 * =================================
 *
 * Main class for logging and managing attack entries.
 * Integrates with GuardrailEngine via onIntercept callback.
 *
 * @package @blackunicorn/bonklm-logger
 */

import { AttackLogStore } from './AttackLogStore.js';
import { createConfig, type ValidatedConfig } from './config.js';
import {
  sanitizeContent_,
  sanitizeForJSON,
  transformToAttackLogEntry,
  truncateContent,
} from './transform.js';
import type {
  AttackLogEntry,
  AttackLoggerConfig,
  AttackSummary,
  EngineResult,
  ExportOptions,
  InterceptCallback,
  LogFilter,
} from './types.js';
import { promises as fs } from 'fs';
import { dirname, isAbsolute, resolve } from 'path';
import * as crypto from 'crypto';

/**
 * Current origin state for generating session-based origins.
 */
let currentSessionId: string | null = null;
let sessionCounter = 0;

/**
 * Default base directory for file exports.
 * Defaults to current working directory.
 */
let defaultExportDir = process.cwd();

/**
 * Set the default export directory for file exports.
 * Must be an absolute path within the application's working directory.
 *
 * @param dir - Absolute path to the export directory
 * @throws Error if path is invalid or outside allowed boundaries
 */
export function setExportDirectory(dir: string): void {
  const resolved = resolve(dir);
  const cwd = resolve(process.cwd());

  // Verify the path is within or is the CWD
  if (!resolved.startsWith(cwd) && cwd !== resolved) {
    throw new Error(
      `Export directory must be within the current working directory. ` +
      `Got: ${dir}, CWD: ${cwd}`
    );
  }

  defaultExportDir = resolved;
}

/**
 * Validate a file path for export to prevent path traversal attacks.
 *
 * Security checks:
 * - Detects and blocks `../` and `..` sequences
 * - Blocks absolute paths (except when within allowed directory)
 * - Validates file extension is `.json`
 * - Ensures resolved path is within allowed directory
 * - Blocks null bytes
 *
 * @param filePath - User-provided file path
 * @param baseDir - Base directory for exports (defaults to CWD)
 * @returns Resolved, validated file path
 * @throws Error if path validation fails
 */
function validateExportPath(filePath: string, baseDir: string = defaultExportDir): string {
  // Check for null bytes
  if (filePath.includes('\x00')) {
    throw new Error(
      'Invalid file path: null bytes are not allowed'
    );
  }

  // Check for path traversal patterns
  const pathTraversalPattern = /\.\.[\/\\]|%2e%2e%2f|%2e%2e%5c/i;
  if (pathTraversalPattern.test(filePath)) {
    throw new Error(
      'Path traversal detected: file paths cannot contain "../" or encoded variations'
    );
  }

  // Check if absolute path
  const isAbsPath = isAbsolute(filePath);
  let resolvedPath: string;

  if (isAbsPath) {
    resolvedPath = resolve(filePath);
    // Verify absolute path is within allowed directory
    const resolvedBase = resolve(baseDir);
    if (!resolvedPath.startsWith(resolvedBase)) {
      throw new Error(
        'Invalid file path: absolute paths must be within the export directory'
      );
    }
  } else {
    // Resolve relative path against base directory
    resolvedPath = resolve(baseDir, filePath);
  }

  // Verify the resolved path is still within base directory (final check)
  const resolvedBase = resolve(baseDir);
  if (!resolvedPath.startsWith(resolvedBase)) {
    throw new Error(
      'Invalid file path: resolved path is outside allowed directory'
    );
  }

  // Validate file extension (must be .json)
  if (!resolvedPath.toLowerCase().endsWith('.json')) {
    throw new Error(
      'Invalid file path: only .json files are allowed for export'
    );
  }

  return resolvedPath;
}

/**
 * Generate a cryptographically secure session ID.
 * Uses crypto.randomBytes() instead of Math.random() for security (S014-005).
 */
function generateSessionId(): string {
  if (!currentSessionId) {
    // Generate 8 cryptographically random bytes and encode as base64url
    const randomBytes = crypto.randomBytes(8).toString('base64url');
    currentSessionId = `session-${Date.now()}-${randomBytes}`;
  }
  return currentSessionId;
}

/**
 * Reset the session ID (mainly for testing).
 */
export function resetSessionId(): void {
  currentSessionId = null;
  sessionCounter = 0;
}

/**
 * Generate a log entry ID.
 */
function generateEntryId(): string {
  sessionCounter++;
  return `entry-${Date.now()}-${sessionCounter}`;
}

/**
 * Main AttackLogger class.
 *
 * Provides attack logging, retrieval, filtering, and management.
 *
 * @example
 * ```typescript
 * const logger = new AttackLogger({ max_logs: 1000 });
 *
 * // Log an attack
 * await logger.log(result, { content: userInput });
 *
 * // Retrieve logs
 * const allLogs = logger.getLogs();
 * const jailbreaks = logger.getLogs({ injection_type: ['jailbreak'] });
 *
 * // Display
 * logger.show({ format: 'summary' });
 *
 * // Export
 * const json = logger.exportJSON();
 *
 * // Clear
 * logger.clear();
 * ```
 */
export class AttackLogger {
  private readonly store: AttackLogStore;
  private config: ValidatedConfig;
  private readonly interceptCallback: InterceptCallback;

  constructor(config: AttackLoggerConfig = {}) {
    this.config = createConfig(config);
    this.store = new AttackLogStore({
      max_logs: this.config.max_logs,
      ttl: this.config.ttl,
    });

    // Create the intercept callback for GuardrailEngine integration
    this.interceptCallback = async (result, context) => {
      if (!this.config.enabled) {
        return;
      }
      await this.logFromIntercept(result, context.content, context.validation_context);
    };
  }

  /**
   * Get the intercept callback for registering with GuardrailEngine.
   *
   * @example
   * ```typescript
   * const engine = new GuardrailEngine({ ... });
   * const logger = new AttackLogger();
   * engine.onIntercept(logger.getInterceptCallback());
   * ```
   */
  getInterceptCallback(): InterceptCallback {
    return this.interceptCallback;
  }

  /**
   * Log a validation result from GuardrailEngine.
   * This is called internally by the intercept callback.
   *
   * Security: Content is sanitized at storage time to prevent log injection.
   * - Control characters are escaped
   * - ANSI escape sequences are stripped
   * - PII is redacted if configured
   *
   * @param result - The engine result from validation
   * @param content - The original content that was validated
   * @param validationContext - Optional validation context
   */
  async logFromIntercept(
    result: EngineResult,
    content: string,
    validationContext?: string
  ): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    const origin = this.getOrigin();

    // Validate content size before processing (S014-005: Memory bounds)
    const contentSize = Buffer.byteLength(content, 'utf8');
    if (contentSize > this.config.max_content_size) {
      // Truncate content to max_content_size
      const truncatedBytes = Buffer.from(content).subarray(0, this.config.max_content_size);
      content = truncatedBytes.toString('utf8');
      // Add truncation indicator
      content = `${content.slice(0, -3)  }...`;
    }

    // Sanitize content at storage time to prevent log injection attacks
    // This applies to ALL content, regardless of sanitize_pii setting
    const sanitizedContent = sanitizeForJSON(content);

    const entry = transformToAttackLogEntry(
      result,
      {
        origin,
        content: sanitizedContent,
        validation_context: validationContext,
      },
      this.config.sanitize_pii
    );

    const entryId = generateEntryId();
    await this.store.set(entryId, entry);
  }

  /**
   * Get all log entries or filter by criteria.
   *
   * @param filter - Optional filter criteria
   * @returns Array of matching log entries (newest first)
   */
  getLogs(filter?: LogFilter): AttackLogEntry[] {
    let entries = this.store.getAll();

    // Apply filters if provided
    if (filter) {
      entries = this.applyFilter(entries, filter);
    }

    // Sort by timestamp descending (newest first)
    entries.sort((a, b) => b.timestamp - a.timestamp);

    return entries;
  }

  /**
   * Get a summary of all logged attacks.
   *
   * @returns Attack summary with statistics
   */
  getSummary(): AttackSummary {
    const entries = this.store.getAll();

    const summary: AttackSummary = {
      total_count: entries.length,
      blocked_count: entries.filter((e) => e.blocked).length,
      allowed_count: entries.filter((e) => !e.blocked).length,
      by_injection_type: {
        'prompt-injection': 0,
        'jailbreak': 0,
        'reformulation': 0,
        'secret-exposure': 0,
        'unknown': 0,
      },
      by_attack_vector: {
        'direct': 0,
        'encoded': 0,
        'roleplay': 0,
        'social-engineering': 0,
        'context-overload': 0,
        'fragmented': 0,
        'unknown': 0,
      },
      by_risk_level: {
        'LOW': 0,
        'MEDIUM': 0,
        'HIGH': 0,
      },
      highest_risk_entry: null,
    };

    let highestRiskScore = -1;

    for (const entry of entries) {
      summary.by_injection_type[entry.injection_type]++;
      summary.by_attack_vector[entry.vector]++;
      summary.by_risk_level[entry.risk_level]++;

      if (entry.risk_score > highestRiskScore) {
        highestRiskScore = entry.risk_score;
        summary.highest_risk_entry = entry;
      }
    }

    return summary;
  }

  /**
   * Clear all log entries.
   * Warns if entries are approaching TTL.
   */
  clear(): void {
    if (this.config.warn_before_ttl_clear) {
      const approaching = this.store.getEntriesApproachingTTL();
      if (approaching.length > 0) {
        console.warn(
          `[AttackLogger] Clearing ${approaching.length} entries approaching TTL expiration`
        );
      }
    }

    this.store.clear();
  }

  /**
   * Get the current count of log entries.
   */
  get count(): number {
    return this.store.count;
  }

  /**
   * Check if the logger is enabled.
   */
  get enabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Enable or disable the logger.
   */
  setEnabled(enabled: boolean): void {
    this.config = { ...this.config, enabled };
  }

  /**
   * Export all log entries as JSON string.
   *
   * Note: Control characters are already sanitized at storage time (S014-004).
   * This method only applies additional PII sanitization if requested.
   *
   * @param options - Export options for PII sanitization
   * @returns JSON string of all log entries
   */
  exportJSON(options?: ExportOptions): string {
    const entries = this.getLogs();

    // Apply additional PII sanitization if requested for export
    // Control characters are already sanitized at storage time
    const sanitizedEntries = entries.map((entry) => ({
      ...entry,
      content: this.applyPiiSanitizationForExport(
        entry.content,
        options?.sanitize_pii
      ),
    }));

    return JSON.stringify(sanitizedEntries, null, 2);
  }

  /**
   * Export all log entries to a JSON file.
   *
   * Path security:
   * - Path traversal attacks are blocked (`../` sequences)
   * - Absolute paths are restricted to the export directory
   * - Only .json file extensions are allowed
   * - Null bytes are rejected
   *
   * @param filePath - Path to the output file (relative or within export directory)
   * @param options - Export options for sanitization
   * @returns Promise that resolves when file is written
   * @throws Error if path validation fails
   *
   * @example
   * ```typescript
   * // Relative path (recommended)
   * await logger.exportJSONToFile('./attacks.json', { sanitize_pii: true });
   *
   * // Set custom export directory first
   * import { setExportDirectory } from '@blackunicorn/bonklm-logger';
   * setExportDirectory('/app/exports');
   * await logger.exportJSONToFile('attacks.json');
   * ```
   */
  async exportJSONToFile(filePath: string, options?: ExportOptions): Promise<void> {
    const json = this.exportJSON(options);
    const validatedPath = validateExportPath(filePath);

    // Ensure parent directory exists
    const parentDir = dirname(validatedPath);
    try {
      await fs.mkdir(parentDir, { recursive: true });
    } catch {
      // Directory may already exist or creation failed
      // Continue and let writeFile handle any errors
    }

    await fs.writeFile(validatedPath, json, 'utf-8');
  }

  /**
   * Apply PII sanitization for export (if requested).
   *
   * Note: Control characters are already sanitized at storage time.
   * This method only applies additional PII redaction if explicitly requested.
   *
   * @param content - The content to sanitize (already sanitized for control chars)
   * @param sanitizePii - Whether to additionally sanitize PII for this export
   * @returns Content with optional PII sanitization applied
   */
  private applyPiiSanitizationForExport(
    content: string,
    sanitizePii?: boolean
  ): string {
    // Content is already sanitized for control characters at storage time
    // Only apply additional PII sanitization if requested
    if (sanitizePii) {
      return sanitizeContent_(content);
    }
    return content;
  }

  /**
   * Display log entries in the console.
   *
   * @param options - Display options
   */
  show(options?: {
    format?: 'table' | 'json' | 'summary';
    color?: boolean;
    limit?: number;
    filter?: LogFilter;
  }): void;

  /**
   * Display log entries in the console (simplified signature).
   *
   * @param format - Display format
   */
  show(format?: 'table' | 'json' | 'summary'): void;

  show(
    optionsOrFormat?:
      | { format?: 'table' | 'json' | 'summary'; color?: boolean; limit?: number; filter?: LogFilter }
      | 'table'
      | 'json'
      | 'summary'
  ): void {
    // Handle both signatures
    let format: 'table' | 'json' | 'summary' = 'table';
    let color = true;
    let limit: number | undefined;
    let filter: LogFilter | undefined;

    if (typeof optionsOrFormat === 'string') {
      format = optionsOrFormat;
    } else if (typeof optionsOrFormat === 'object') {
      format = optionsOrFormat.format ?? 'table';
      color = optionsOrFormat.color ?? true;
      limit = optionsOrFormat.limit;
      filter = optionsOrFormat.filter;
    }

    if (format === 'json') {
      console.log(this.exportJSON());
      return;
    }

    if (format === 'summary') {
      this.displaySummary(color);
      return;
    }

    // Default: table format
    this.displayTable(color, limit, filter);
  }

  /**
   * Display entries in table format.
   */
  private displayTable(color: boolean, limit?: number, filter?: LogFilter): void {
    let entries = this.getLogs(filter);

    if (limit) {
      entries = entries.slice(0, limit);
    }

    if (entries.length === 0) {
      console.log('No attack log entries.');
      return;
    }

    // ANSI color codes
    const red = color ? '\x1b[31m' : '';
    const yellow = color ? '\x1b[33m' : '';
    const green = color ? '\x1b[32m' : '';
    const reset = color ? '\x1b[0m' : '';
    const dim = color ? '\x1b[2m' : '';

    // Table header
    console.log('\n┌─────────────────────┬──────────────────┬─────────────────┬─────────┬──────┐');
    console.log(
      '│ Timestamp           │ Type             │ Vector          │ Risk    │ Blkd │'
    );
    console.log('├─────────────────────┼──────────────────┼─────────────────┼─────────┼──────┤');

    // Table rows
    for (const entry of entries) {
      const timestamp = new Date(entry.timestamp).toISOString().slice(0, 19);
      const type = (`${entry.injection_type  } `).slice(0, 16);
      const vector = (`${entry.vector  } `).slice(0, 15);

      let riskColor = reset;
      if (entry.risk_level === 'HIGH') {
        riskColor = red;
      } else if (entry.risk_level === 'MEDIUM') {
        riskColor = yellow;
      } else if (entry.risk_level === 'LOW') {
        riskColor = green;
      }

      const blocked = entry.blocked ? `${red}✓${reset}` : `${dim}-${reset}`;
      const risk = `${riskColor}${entry.risk_level.padEnd(7)}${reset}`;

      console.log(
        `│ ${timestamp} │ ${type} │ ${vector} │ ${risk}│ ${blocked} │`
      );
    }

    console.log('└─────────────────────┴──────────────────┴─────────────────┴─────────┴──────┘');
    console.log(`Total: ${entries.length} entry(ies)`);
  }

  /**
   * Display executive summary.
   */
  private displaySummary(color: boolean): void {
    const summary = this.getSummary();

    const red = color ? '\x1b[31m' : '';
    const yellow = color ? '\x1b[33m' : '';
    const green = color ? '\x1b[32m' : '';
    const cyan = color ? '\x1b[36m' : '';
    const reset = color ? '\x1b[0m' : '';

    console.log(`\n${cyan}═══ Attack Logger Summary ═══${reset}`);
    console.log(`Total Attacks: ${summary.total_count}`);
    console.log(
      `Blocked: ${red}${summary.blocked_count}${reset} | Allowed: ${green}${summary.allowed_count}${reset}`
    );

    console.log(`\n${cyan}By Injection Type:${reset}`);
    for (const [type, count] of Object.entries(summary.by_injection_type)) {
      if (count > 0) {
        console.log(`  ${type}: ${count}`);
      }
    }

    console.log(`\n${cyan}By Attack Vector:${reset}`);
    for (const [vector, count] of Object.entries(summary.by_attack_vector)) {
      if (count > 0) {
        console.log(`  ${vector}: ${count}`);
      }
    }

    console.log(`\n${cyan}By Risk Level:${reset}`);
    for (const [level, count] of Object.entries(summary.by_risk_level)) {
      if (count > 0) {
        let colorCode = reset;
        if (level === 'HIGH') colorCode = red;
        else if (level === 'MEDIUM') colorCode = yellow;
        else if (level === 'LOW') colorCode = green;
        console.log(`  ${colorCode}${level}${reset}: ${count}`);
      }
    }

    if (summary.highest_risk_entry) {
      console.log(`\n${cyan}Highest Risk Entry:${reset}`);
      console.log(
        `  Risk Score: ${red}${summary.highest_risk_entry.risk_score}${reset} (${summary.highest_risk_entry.risk_level})`
      );
      console.log(
        `  Type: ${summary.highest_risk_entry.injection_type} | Vector: ${summary.highest_risk_entry.vector}`
      );
      console.log(
        `  Content: ${truncateContent(summary.highest_risk_entry.content, 100)}`
      );
    }

    console.log('');
  }

  /**
   * Apply filter criteria to log entries.
   */
  private applyFilter(entries: AttackLogEntry[], filter: LogFilter): AttackLogEntry[] {
    let filtered = [...entries];

    // Filter by injection type
    if (filter.injection_type) {
      const types = Array.isArray(filter.injection_type)
        ? filter.injection_type
        : [filter.injection_type];
      filtered = filtered.filter((e) => types.includes(e.injection_type));
    }

    // Filter by attack vector
    if (filter.vector) {
      const vectors = Array.isArray(filter.vector) ? filter.vector : [filter.vector];
      filtered = filtered.filter((e) => vectors.includes(e.vector));
    }

    // Filter by risk level
    if (filter.risk_level) {
      const levels = Array.isArray(filter.risk_level)
        ? filter.risk_level
        : [filter.risk_level];
      filtered = filtered.filter((e) => levels.includes(e.risk_level));
    }

    // Filter by blocked status
    if (filter.blocked !== undefined) {
      filtered = filtered.filter((e) => e.blocked === filter.blocked);
    }

    // Filter by timestamp range
    if (filter.since !== undefined) {
      filtered = filtered.filter((e) => e.timestamp >= filter.since!);
    }
    if (filter.until !== undefined) {
      filtered = filtered.filter((e) => e.timestamp <= filter.until!);
    }

    // Filter by origin
    if (filter.origin) {
      filtered = filtered.filter((e) => e.origin === filter.origin);
    }

    // Apply limit
    if (filter.limit) {
      filtered = filtered.slice(0, filter.limit);
    }

    return filtered;
  }

  /**
   * Get the origin identifier based on configuration.
   */
  private getOrigin(): string {
    switch (this.config.origin_type) {
      case 'sessionId':
        return generateSessionId();
      case 'custom':
        return this.config.custom_origin;
      case 'none':
        return 'none';
      default:
        return 'unknown';
    }
  }
}
