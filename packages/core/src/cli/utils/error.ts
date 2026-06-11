/**
 * Error handling utilities for the BonkLM Installation Wizard
 *
 * This module provides the WizardError class with credential sanitization
 * to prevent sensitive data leakage in error messages and stack traces.
 */

/**
 * Lower threshold for entropy detection to catch more potential credentials
 *
 * This threshold balances between catching real credentials and avoiding
 * over-redaction of normal text.
 */
const ENTROPY_THRESHOLD = 0.6; // 60% unique characters

/**
 * Calculates the Shannon entropy of a string to detect high-entropy values
 * that might be credentials or tokens.
 *
 * High entropy strings suggest randomly generated values like API keys,
 * tokens, or passwords.
 *
 * Uses both character uniqueness AND byte-level entropy for better detection.
 *
 * @param str - The string to analyze
 * @returns True if the string has high entropy
 */
function isHighEntropy(str: string): boolean {
  if (str.length < 20) return false;

  // Check 1: Character uniqueness ratio
  const unique = new Set(str).size;
  const ratio = unique / str.length;
  if (ratio > ENTROPY_THRESHOLD) return true;

  // Check 2: Byte-level Shannon entropy (more accurate for detecting random data)
  const charCounts = new Map<string, number>();
  for (const char of str) {
    charCounts.set(char, (charCounts.get(char) || 0) + 1);
  }

  let entropy = 0;
  for (const count of Array.from(charCounts.values())) {
    const p = count / str.length;
    entropy -= p * Math.log2(p);
  }

  // Normalized entropy (divide by max entropy for the alphabet size)
  const maxEntropy = Math.log2(Math.min(str.length, 256));
  const normalizedEntropy = entropy / maxEntropy;

  return normalizedEntropy > ENTROPY_THRESHOLD;
}

/**
 * Applies the always-on credential patterns — the high-confidence shapes that
 * are redacted unconditionally — in a single canonical order shared by
 * {@link redactCredentials} (Error / CLI messages) and {@link sanitizeError}'s
 * stack-trace pass, so both agree on the output for the same input.
 *
 * Order is load-bearing: JWTs are matched BEFORE the generic base64 pattern. A
 * JWT segment is often a long high-entropy base64 run, so running base64 first
 * would consume it and leave the token fragmented into several `***REDACTED***`
 * chunks instead of one `***JWT_REDACTED***` marker.
 *
 * @param text - The text to redact.
 * @returns A new string with always-on credential shapes redacted.
 */
function redactAlwaysOn(text: string): string {
  // sk- API keys (case-insensitive: Sk-, SK-, ...); includes the special
  // characters commonly found in provider keys.
  let sanitized = text.replace(/sk-[a-zA-Z0-9\-_\.+/]{10,}/gi, '***REDACTED***');

  // Bearer tokens.
  sanitized = sanitized.replace(/Bearer\s+[a-zA-Z0-9\-._~+/]+=*/gi, 'Bearer ***REDACTED***');

  // JWTs (header.payload.signature) — before base64 (see order note above).
  sanitized = sanitized.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '***JWT_REDACTED***');

  // High-entropy base64 (optional `=` / `==` padding).
  sanitized = sanitized.replace(/([A-Za-z0-9+/]{32,}={0,2})/g, match =>
    isHighEntropy(match) ? '***REDACTED***' : match
  );

  return sanitized;
}

/**
 * Redacts credential-shaped substrings from a single piece of text.
 *
 * Single string-level source of truth for credential redaction, shared by
 * {@link sanitizeError} (Error messages) and CLI output paths that surface
 * connector-supplied strings (e.g. the wizard / `connector test` `--json`
 * error field).
 *
 * Runs the shared always-on shapes ({@link redactAlwaysOn}: sk- keys, Bearer
 * tokens, JWTs, high-entropy base64) first, then two message-only conditional
 * catch-alls — labelled `api_key=` values and quoted high-entropy strings —
 * that mop up credentials the high-confidence patterns did not already redact.
 * Each conditional match is redacted only when it clears the entropy check, so
 * ordinary prose is left intact.
 *
 * @param text - The text to redact
 * @returns A new string with credential-shaped substrings replaced
 */
export function redactCredentials(text: string): string {
  let sanitized = redactAlwaysOn(text);

  // api_key=<value> — redact only a high-entropy value (message-only catch-all).
  sanitized = sanitized.replace(/api[_-]?key["\s:=]+([^\s"'`<>]+)/gi, (match, value) => {
    return isHighEntropy(value) ? match.replace(value, '***REDACTED***') : match;
  });

  // Quoted high-entropy strings — more specific, to avoid false positives
  // (message-only catch-all).
  sanitized = sanitized.replace(/["']([a-zA-Z0-9_\-\.+/=]{32,})["']/g, (match, captured) =>
    isHighEntropy(captured) ? '***REDACTED***' : match
  );

  return sanitized;
}

/**
 * Sanitizes an error by redacting potential credentials from the message and stack trace.
 *
 * This prevents sensitive data from leaking through error handling pathways.
 * The message is redacted via {@link redactCredentials}; the stack trace gets
 * only the shared always-on subset (sk- keys, Bearer tokens, JWTs, high-entropy
 * base64) through the same `redactAlwaysOn` helper and canonical order, so the
 * two outputs stay consistent.
 *
 * @param error - The error to sanitize
 * @param depth - Internal recursion guard (do not use)
 * @returns A new error with sanitized message and stack trace
 */
export function sanitizeError(error: Error, depth: number = 0): Error {
  // Guard against infinite recursion
  const MAX_DEPTH = 3;
  if (depth >= MAX_DEPTH) {
    // Return a safe fallback instead of recursing infinitely
    const fallback = new Error('Error sanitization reached maximum depth');
    fallback.stack = undefined;
    return fallback;
  }
  const sanitizedMessage = redactCredentials(error.message);
  let sanitizedStack = error.stack;

  // Stack frames get the shared always-on subset (sk-/Bearer/JWT/base64) in the
  // same canonical order as the message pass; the message-only api_key / quoted
  // catch-alls are intentionally not applied to stack traces.
  if (sanitizedStack) {
    sanitizedStack = redactAlwaysOn(sanitizedStack);
  }

  const sanitized = new Error(sanitizedMessage);
  sanitized.stack = sanitizedStack;
  return sanitized;
}

/**
 * Exit codes for CLI operations
 *
 * Following standard CLI conventions:
 * - 0: Success
 * - 1: Error
 * - 2: Partial success (some operations succeeded, some failed)
 */
export const ExitCode = {
  SUCCESS: 0,
  ERROR: 1,
  PARTIAL: 2
} as const;

/**
 * Exit code type for type safety
 */
export type ExitCodeType = keyof typeof ExitCode;

/**
 * Custom error class for the BonkLM Installation Wizard
 *
 * Provides structured error information with:
 * - Error code for programmatic handling
 * - User-friendly message
 * - Actionable suggestion
 * - Sanitized cause error
 * - Appropriate exit code
 *
 * @example
 * ```ts
 * throw new WizardError(
 *   'CREDENTIAL_TOO_LARGE',
 *   'Credential size exceeds maximum',
 *   'Use a shorter API key',
 *   originalError,
 *   'ERROR'
 * );
 * ```
 */
export class WizardError extends Error {
  /**
   * Creates a new WizardError
   *
   * @param code - Machine-readable error code (e.g., 'ENV_READ_FAILED')
   * @param message - Human-readable error message
   * @param suggestion - Optional actionable suggestion for the user
   * @param cause - Optional original error (will be sanitized)
   * @param exitCode - Optional CLI exit code (defaults to ERROR)
   */
  constructor(
    public readonly code: string,
    message: string,
    public readonly suggestion?: string,
    public readonly cause?: Error,
    public readonly exitCode?: 0 | 1 | 2
  ) {
    super(message);
    this.name = 'WizardError';

    // Sanitize cause error to prevent credential leakage
    if (cause) {
      this.cause = sanitizeError(cause);
    }
  }

  /**
   * Formats the error for display to the user
   *
   * Includes the error code, message, and suggestion if available.
   * Does not include the stack trace for cleaner user experience.
   *
   * @returns Formatted error string
   */
  override toString(): string {
    let output = `${this.code}: ${this.message}`;
    if (this.suggestion) {
      output += `\nSuggestion: ${this.suggestion}`;
    }
    return output;
  }
}
