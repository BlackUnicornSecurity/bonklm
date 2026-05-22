/**
 * BonkLM - Bash Safety Guard
 * ==================================
 * Blocks dangerous bash commands that could cause irreversible damage.
 *
 * Features:
 * - Detects dangerous rm commands with path validation
 * - SQL injection pattern detection
 * - Command substitution detection
 * - Directory traversal detection
 * - Dangerous pattern blocking (dd, fork bomb, chmod 777, etc.)
 * - Pipe-to-bash detection (curl|bash, wget|bash)
 */

import { resolve as resolvePath } from 'node:path';
import { createResult, Severity as Sev } from '../base/GuardrailResult.js';
import { mergeConfig, type ValidatorConfig } from '../base/ValidatorConfig.js';
import type { Logger } from '../base/GenericLogger.js';
import { normalizeText } from '../validators/text-normalizer.js';

// =============================================================================
// TYPES
// =============================================================================

export interface BashSafetyConfig extends ValidatorConfig {
  /**
   * Current working directory for path validation
   */
  cwd?: string;

  /**
   * Enable SQL injection detection
   */
  detectSqlInjection?: boolean;

  /**
   * Enable command substitution detection
   */
  detectCommandSubstitution?: boolean;
}

export interface BashFinding {
  category: string;
  pattern: string;
  severity: Sev;
  match: string;
  description: string;
}

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * Safe environment variables that are allowed in commands
 */
const SAFE_VARIABLES = new Set([
  '$HOME', '$USER', '$PWD', '$OLDPWD', '$PATH', '$SHELL',
  '$TERM', '$LANG', '$LC_ALL', '$TZ', '$HOSTNAME',
  '$LOGNAME', '$TMPDIR', '$XDG_CONFIG_HOME', '$XDG_DATA_HOME',
]);

/**
 * Shell operators that terminate command arguments
 */
const SHELL_OPERATORS = new Set(['|', '||', '&&', ';', '>', '>>', '2>', '2>>', '&>', '<']);

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Check if a path is within the current working directory (repo)
 */
function isPathInRepo(target: string, cwd: string): boolean {
  const resolvedTarget = resolvePath(cwd, target);
  const resolvedCwd = resolvePath(cwd);
  return resolvedTarget.startsWith(resolvedCwd);
}

/**
 * Split a command string into individual pipeline/chain segments
 */
export function splitCommandSegments(cmd: string): string[] {
  return cmd.split(/\s*(?:\|\||&&|[|;])\s*/).map(s => s.trim()).filter(Boolean);
}

/**
 * Extract target paths from rm commands
 */
export function extractRmTargets(cmd: string): string[] {
  const segments = splitCommandSegments(cmd);
  const targets: string[] = [];

  for (const segment of segments) {
    const parts = segment.split(/\s+/);
    let foundRm = false;
    let skipNext = false;

    for (const part of parts) {
      if (skipNext) {
        skipNext = false;
        continue;
      }
      if (part === 'rm' || part === 'sudo') {
        if (part === 'rm') foundRm = true;
        continue;
      }
      if (!foundRm) continue;
      if (SHELL_OPERATORS.has(part)) break;
      if (part.startsWith('-')) {
        if (part === '-I' || part === '--interactive') {
          skipNext = true;
        }
        continue;
      }
      targets.push(part);
    }
  }
  return targets;
}

/**
 * Check variable safety
 */
function checkVariableSafety(varRef: string): { isSafe: boolean; varName: string } {
  const match = varRef.match(/^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/);
  if (!match) return { isSafe: false, varName: varRef };
  return { isSafe: SAFE_VARIABLES.has(`$${match[1]}`), varName: `$${match[1]}` };
}

// =============================================================================
// SQL INJECTION DETECTION
// =============================================================================

export interface SQLInjectionResult {
  isSQLi: boolean;
  testId?: string;
  subtype?: string;
  severity: string;
}

export function checkSQLInjection(cmd: string): SQLInjectionResult {
  if (!cmd || typeof cmd !== 'string') {
    return { isSQLi: false, severity: 'INFO' };
  }

  const upperCmd = cmd.toUpperCase();

  // UNION-based SQL injection
  if (/\bUNION\s+(?:ALL\s+)?SELECT/i.test(cmd)) {
    return { isSQLi: true, testId: 'A03-101', subtype: 'UNION', severity: 'CRITICAL' };
  }

  // ORDER BY with comment
  if (/\bORDER\s+BY\s+\d+\s*--/i.test(cmd)) {
    return { isSQLi: true, testId: 'A03-101', subtype: 'UNION', severity: 'CRITICAL' };
  }

  // HAVING 1=1 pattern
  if (/\bHAVING\s+1\s*=\s*1/i.test(cmd)) {
    return { isSQLi: true, testId: 'A03-101', subtype: 'UNION', severity: 'CRITICAL' };
  }

  // Boolean-blind SQL injection
  if (/\bOR\s+1\s*=\s*1\b/i.test(upperCmd) || /\bAND\s+1\s*=\s*2\b/i.test(upperCmd)) {
    return { isSQLi: true, testId: 'A03-102', subtype: 'BOOLEAN_BLIND', severity: 'CRITICAL' };
  }

  // OR 'a'='a pattern
  if (/\bOR\s+['"]?[a-z]['"]?\s*=\s*['"]?[a-z]['"]?/i.test(cmd)) {
    return { isSQLi: true, testId: 'A03-102', subtype: 'BOOLEAN_BLIND', severity: 'CRITICAL' };
  }

  // IF statement pattern
  if (/\bIF\s*\([^)]*\=[^)]*\)/i.test(cmd)) {
    return { isSQLi: true, testId: 'A03-102', subtype: 'BOOLEAN_BLIND', severity: 'CRITICAL' };
  }

  // Time-based SQL injection
  if (/\bSLEEP\s*\(/i.test(cmd) || /\bWAITFOR\s+DELAY/i.test(cmd) || /\bBENCHMARK\s*\(/i.test(cmd)) {
    return { isSQLi: true, testId: 'A03-103', subtype: 'TIME_BASED', severity: 'CRITICAL' };
  }

  if (/\bPG_SLEEP\s*\(/i.test(cmd)) {
    return { isSQLi: true, testId: 'A03-103', subtype: 'TIME_BASED', severity: 'CRITICAL' };
  }

  // Error-based SQL injection
  if (/\bCAST\s*\(/i.test(cmd) && /\bAS\s+INT/i.test(cmd)) {
    return { isSQLi: true, testId: 'A03-104', subtype: 'ERROR_BASED', severity: 'CRITICAL' };
  }

  if (/\bCONVERT\s*\(/i.test(cmd) && /\bINT\b/i.test(cmd)) {
    return { isSQLi: true, testId: 'A03-104', subtype: 'ERROR_BASED', severity: 'CRITICAL' };
  }

  if (/\bFLOOR\s*\(\s*RAND\s*\(/i.test(cmd)) {
    return { isSQLi: true, testId: 'A03-104', subtype: 'ERROR_BASED', severity: 'CRITICAL' };
  }

  if (/\bCOUNT\s*\([^)]*CONCAT/i.test(cmd)) {
    return { isSQLi: true, testId: 'A03-104', subtype: 'ERROR_BASED', severity: 'CRITICAL' };
  }

  // Stacked query injection
  if (/;.*\bDROP\s+TABLE/i.test(cmd)) {
    return { isSQLi: true, testId: 'A03-105', subtype: 'STACKED_QUERY', severity: 'CRITICAL' };
  }

  if (/;.*\bINSERT\s+INTO/i.test(cmd)) {
    return { isSQLi: true, testId: 'A03-105', subtype: 'STACKED_QUERY', severity: 'CRITICAL' };
  }

  if (/;.*\bUPDATE\b/i.test(cmd) && /\bSET\b/i.test(cmd)) {
    return { isSQLi: true, testId: 'A03-105', subtype: 'STACKED_QUERY', severity: 'CRITICAL' };
  }

  if (/;.*\bEXEC\b/i.test(cmd)) {
    return { isSQLi: true, testId: 'A03-105', subtype: 'STACKED_QUERY', severity: 'CRITICAL' };
  }

  if (/;.*\bTRUNCATE\s+TABLE/i.test(cmd)) {
    return { isSQLi: true, testId: 'A03-105', subtype: 'STACKED_QUERY', severity: 'CRITICAL' };
  }

  // General SQL patterns (WARNING level)
  if (/\bSELECT\s+\*\s+FROM\b/i.test(cmd) || /\bWHERE\s+1\s*=\s*1\b/i.test(cmd)) {
    return { isSQLi: true, severity: 'WARNING' };
  }

  if (cmd.trim().endsWith('--')) {
    return { isSQLi: true, severity: 'WARNING' };
  }

  return { isSQLi: false, severity: 'INFO' };
}

// =============================================================================
// DANGEROUS PATTERN DETECTION
// =============================================================================

/**
 * Detect command substitution patterns
 */
export interface CommandSubstitution {
  type: string;
  match: string;
}

export function detectCommandSubstitution(cmd: string): CommandSubstitution[] {
  const patterns: [RegExp, string][] = [
    [/\$\([^)]+\)/g, 'Command substitution $()'],
    [/`[^`]+`/g, 'Backtick command substitution'],
    [/\$\{[^}]+\}/g, 'Variable expansion ${}'],
    [/\$[A-Za-z_][A-Za-z0-9_]*/g, 'Variable reference'],
  ];

  const detected: CommandSubstitution[] = [];
  for (const [pattern, description] of patterns) {
    const matches = cmd.match(pattern);
    if (matches) {
      for (const match of matches) {
        detected.push({ type: description, match });
      }
    }
  }
  return detected;
}

/**
 * Check for dangerous rm commands
 */
export function checkDangerousRm(
  cmd: string,
  cwd: string
): { isDangerous: boolean; isAbsolute: boolean; message: string } {
  // Absolute block patterns
  const absoluteBlockPatterns = [
    /rm\s+(-[rfRF]+\s+)*[/~](\s|;|&|$|\|)/,
    /rm\s+(-[rfRF]+\s+)*\/\s*(\s|;|&|$|\|)/,
    /rm\s+(-[rfRF]+\s+)*~\s*(\s|;|&|$|\|)/,
    /rm\s+(-[rfRF]+\s+)*\/home\b/,
    /rm\s+(-[rfRF]+\s+)*\/Users\b/,
    /rm\s+(-[rfRF]+\s+)*\/root\b/,
    /rm\s+(-[rfRF]+\s+)*\$HOME\b/,
    /rm\s+(-[rfRF]+\s+)*\*\s*(\s|;|&|$|\|)/,
  ];

  for (const pattern of absoluteBlockPatterns) {
    if (pattern.test(cmd)) {
      return {
        isDangerous: true,
        isAbsolute: true,
        message: 'ABSOLUTE BLOCK: Catastrophically dangerous rm command detected',
      };
    }
  }

  // Check rm -rf with path validation
  if (/\brm\b.*-[rfRF]/.test(cmd)) {
    const targets = extractRmTargets(cmd);
    for (const target of targets) {
      if (target.startsWith('$')) {
        const { isSafe, varName } = checkVariableSafety(target);
        if (!isSafe) {
          return {
            isDangerous: true,
            isAbsolute: true,
            message: `ABSOLUTE BLOCK: rm -rf uses unverified variable: ${varName}`,
          };
        }
        continue;
      }
      if (!isPathInRepo(target, cwd)) {
        return {
          isDangerous: true,
          isAbsolute: true,
          message: `ABSOLUTE BLOCK: rm -rf targets path outside repository: ${target}`,
        };
      }
    }
  }

  // Check rm without -rf
  if (/\brm\b/.test(cmd)) {
    const targets = extractRmTargets(cmd);
    for (const target of targets) {
      if (target.startsWith('$')) {
        const { isSafe, varName } = checkVariableSafety(target);
        if (!isSafe) {
          return {
            isDangerous: true,
            isAbsolute: false,
            message: `STRICT BLOCK: rm uses unverified variable: ${varName}`,
          };
        }
        continue;
      }
      if (!isPathInRepo(target, cwd)) {
        return {
          isDangerous: true,
          isAbsolute: false,
          message: `STRICT BLOCK: rm targets path outside repository: ${target}`,
        };
      }
    }
  }

  return { isDangerous: false, isAbsolute: false, message: '' };
}

/**
 * Check for directory escape attempts
 */
export function checkDirectoryEscape(
  cmd: string,
  cwd: string
): { isEscape: boolean; message: string } {
  const cdMatch = cmd.match(/\bcd\s+([^\s;&|]+)/);
  if (cdMatch && cdMatch[1]) {
    const target = cdMatch[1];
    if (target.startsWith('/') && !isPathInRepo(target, cwd)) {
      return {
        isEscape: true,
        message: `Directory escape attempt: cd to ${target} (outside repository)`,
      };
    }
  }

  if (/\.\.\//.test(cmd)) {
    const traversalCount = (cmd.match(/\.\.\//g) || []).length;
    if (traversalCount >= 5) {
      return {
        isEscape: true,
        message: `Suspicious directory traversal: ${traversalCount} levels of ../`,
      };
    }
  }

  return { isEscape: false, message: '' };
}

/**
 * Check for other dangerous patterns
 */
export function checkDangerousPatterns(cmd: string): { isDangerous: boolean; message: string } {
  const dangerousPatterns: [RegExp, string][] = [
    [/>\s*\/dev\/sd[a-z]/, 'Direct write to block device'],
    [/mkfs\./, 'Filesystem format command'],
    [/dd\s+.*of=\/dev\//, 'dd to device - potential disk wipe'],
    [/:\(\)\s*{\s*:\|:\s*&\s*};\s*:/, 'Fork bomb detected'],
    [/chmod\s+(-[rR]+\s+)*777\s+\//, 'Dangerous chmod 777 on system path'],
    [/chown\s+(-[rR]+\s+)*root/, 'Changing ownership to root'],
    [/curl\s+.*\|\s*(sudo\s+)?bash/, 'Pipe curl to bash (dangerous)'],
    [/wget\s+.*\|\s*(sudo\s+)?bash/, 'Pipe wget to bash (dangerous)'],
    [/eval\s+.*\$/, 'Eval with variable expansion'],
  ];

  for (const [pattern, message] of dangerousPatterns) {
    if (pattern.test(cmd)) {
      return { isDangerous: true, message: `STRICT BLOCK: ${message}` };
    }
  }

  const segments = splitCommandSegments(cmd);
  if (segments.length > 1) {
    for (const segment of segments) {
      for (const [pattern, message] of dangerousPatterns) {
        if (pattern.test(segment)) {
          return { isDangerous: true, message: `STRICT BLOCK: ${message} (in chained command)` };
        }
      }
    }
  }

  return { isDangerous: false, message: '' };
}

// =============================================================================
// GUARD CLASS
// =============================================================================

export class BashSafetyGuard {
  private readonly config: Required<BashSafetyConfig>;
  private logger: Logger;

  constructor(config?: BashSafetyConfig) {
    this.config = mergeConfig({
      ...config,
      cwd: config?.cwd ?? process.cwd(),
      detectSqlInjection: config?.detectSqlInjection ?? true,
      detectCommandSubstitution: config?.detectCommandSubstitution ?? true,
    }) as Required<BashSafetyConfig>;

    this.logger = this.config.logger ?? console;
  }

  /**
   * Validate a bash command for safety
   */
  validate(command: string): import('../base/GuardrailResult.js').GuardrailResult {
    if (!command || command.trim().length === 0) {
      return createResult(true, Sev.INFO, []);
    }

    // Normalize before detection — defeats `r​m -rf /` and homoglyph bypass.
    // Also normalize cwd so path-containment checks on `cd /home/иван` work for
    // users whose home directory contains Cyrillic/Greek/precomposed characters.
    command = normalizeText(command);
    const normalizedCwd = this.config.cwd ? normalizeText(this.config.cwd) : this.config.cwd;

    const findings: BashFinding[] = [];

    // Cumulative-audit fix: strip ASCII control chars + DEL from any
    // raw-command slice that flows into a Finding.match field —
    // attacker-supplied shell content can carry ANSI escapes, newlines,
    // or carriage returns that hijack downstream log lines. Same
    // approach as the doc-id sanitisation in retrieved-doc.ts.
    const sanitiseShell = (s: string): string => s.replace(/[\x00-\x1f\x7f]/g, '');

    // Check for command substitution
    if (this.config.detectCommandSubstitution) {
      const substitutions = detectCommandSubstitution(command);
      if (substitutions.length > 0) {
        for (const sub of substitutions) {
          findings.push({
            category: 'command_substitution',
            pattern: sub.type,
            severity: Sev.WARNING,
            match: sanitiseShell(sub.match.slice(0, 50)),
            description: `Command substitution detected: ${sub.type}`,
          });
        }
        this.logger.warn(`Command substitution detected in: ${sanitiseShell(command.slice(0, 100))}`);
      }
    }

    // Check for SQL injection
    if (this.config.detectSqlInjection) {
      const sqliResult = checkSQLInjection(command);
      if (sqliResult.isSQLi) {
        findings.push({
          category: 'sql_injection',
          pattern: sqliResult.testId ?? sqliResult.subtype ?? 'unknown',
          severity: sqliResult.severity === 'CRITICAL' ? Sev.CRITICAL : Sev.WARNING,
          match: sanitiseShell(command.slice(0, 100)),
          description: `SQL injection detected: ${sqliResult.subtype ?? sqliResult.testId}`,
        });
      }
    }

    // Check dangerous rm commands (path containment uses normalized cwd)
    const rmCheck = checkDangerousRm(command, normalizedCwd);
    if (rmCheck.isDangerous) {
      findings.push({
        category: 'dangerous_rm',
        pattern: rmCheck.isAbsolute ? 'absolute_block' : 'strict_block',
        severity: Sev.CRITICAL,
        match: sanitiseShell(command.slice(0, 100)),
        description: rmCheck.message,
      });
    }

    // Check directory escape (path containment uses normalized cwd)
    const escapeCheck = checkDirectoryEscape(command, normalizedCwd);
    if (escapeCheck.isEscape) {
      findings.push({
        category: 'directory_escape',
        pattern: 'escape_attempt',
        severity: Sev.CRITICAL,
        match: sanitiseShell(command.slice(0, 100)),
        description: escapeCheck.message,
      });
    }

    // Check other dangerous patterns
    const patternCheck = checkDangerousPatterns(command);
    if (patternCheck.isDangerous) {
      findings.push({
        category: 'dangerous_pattern',
        pattern: 'dangerous',
        severity: Sev.CRITICAL,
        match: sanitiseShell(command.slice(0, 100)),
        description: patternCheck.message,
      });
    }

    if (findings.length === 0) {
      return createResult(true, Sev.INFO, []);
    }

    // Convert to Finding format
    const convertedFindings = findings.map((f) => ({
      category: f.category,
      pattern_name: f.pattern,
      severity: f.severity,
      match: f.match,
      description: f.description,
      weight: f.severity === Sev.CRITICAL ? 20 : f.severity === Sev.WARNING ? 10 : 5,
    }));

    const hasCritical = findings.some((f) => f.severity === Sev.CRITICAL);
    const shouldBlock = this.config.action === 'block' && hasCritical;

    if (shouldBlock) {
      this.logger.error(`Bash command blocked: ${findings[0]?.description}`);
    }

    return createResult(
      !shouldBlock,
      hasCritical ? Sev.CRITICAL : Sev.WARNING,
      convertedFindings
    );
  }

  /**
   * Get the guard's configuration
   */
  getConfig(): BashSafetyConfig {
    return { ...this.config };
  }
}

// =============================================================================
// CONVENIENCE FUNCTION
// =============================================================================

/**
 * Quick bash safety check.
 * @param command - Command to check
 * @param cwd - Current working directory (optional)
 * @returns Validation result
 */
export function checkBashSafety(
  command: string,
  cwd?: string
): import('../base/GuardrailResult.js').GuardrailResult {
  const guard = new BashSafetyGuard({ cwd });
  return guard.validate(command);
}
