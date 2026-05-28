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
 * Sanitizes an error by redacting potential credentials from the message and stack trace.
 *
 * This prevents sensitive data from leaking through error handling pathways.
 *
 * The sanitization process:
 * 1. Applies each pattern to find potential credentials
 * 2. Checks each match for high entropy
 * 3. Redacts high-entropy matches, keeps low-entropy matches
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
  let sanitizedMessage = error.message;
  let sanitizedStack = error.stack;

  // First pass: Redact known credential patterns
  // sk- patterns are always redacted (they're API keys)
  // Case-insensitive to catch Sk-, SK-, etc.
  // Include common special characters found in API keys
  sanitizedMessage = sanitizedMessage.replace(/sk-[a-zA-Z0-9\-_\.+/]{10,}/gi, '***REDACTED***');

  // Bearer tokens are always redacted
  sanitizedMessage = sanitizedMessage.replace(/Bearer\s+[a-zA-Z0-9\-._~+/]+=*/gi, 'Bearer ***REDACTED***');

  // api_key patterns - extract and check the value
  sanitizedMessage = sanitizedMessage.replace(/api[_-]?key["\s:=]+([^\s"'`<>]+)/gi, (match, value) => {
    return isHighEntropy(value) ? match.replace(value, '***REDACTED***') : match;
  });

  // Base64 and high-entropy strings
  // Pattern 1: Base64 with proper padding (== or =)
  sanitizedMessage = sanitizedMessage.replace(/([A-Za-z0-9+/]{32,}={0,2})/g, match =>
    isHighEntropy(match) ? '***REDACTED***' : match
  );

  // Pattern 2: Quoted high-entropy strings (more specific to avoid false positives)
  sanitizedMessage = sanitizedMessage.replace(/["']([a-zA-Z0-9_\-\.+/=]{32,})["']/g, (match, captured) =>
    isHighEntropy(captured) ? '***REDACTED***' : match
  );

  // Pattern 3: Known JWT format (header.payload.signature)
  sanitizedMessage = sanitizedMessage.replace(
    /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
    '***JWT_REDACTED***'
  );

  // Apply same sanitization to stack trace
  if (sanitizedStack) {
    sanitizedStack = sanitizedStack.replace(/sk-[a-zA-Z0-9\-_\.+/]{10,}/gi, '***REDACTED***');
    sanitizedStack = sanitizedStack.replace(/Bearer\s+[a-zA-Z0-9\-._~+/]+=*/gi, 'Bearer ***REDACTED***');

    // JWT tokens in stack traces
    sanitizedStack = sanitizedStack.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '***JWT_REDACTED***');

    // Base64 patterns
    sanitizedStack = sanitizedStack.replace(/([A-Za-z0-9+/]{32,}={0,2})/g, match =>
      isHighEntropy(match) ? '***REDACTED***' : match
    );
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
