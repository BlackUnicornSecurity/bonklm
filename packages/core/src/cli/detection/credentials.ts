/**
 * Credential Detection Module
 *
 * Scans the environment for known API keys and credentials.
 * Uses SecureCredential for memory safety and enforces whitelist validation
 * to prevent environment variable injection attacks.
 *
 * SECURITY: Environment Variable Injection Prevention (HP-4)
 * - All environment variable names are validated against a whitelist
 * - Only known credential patterns are checked
 * - Non-string values are rejected
 * - SecureCredential ensures memory is zeroed after use
 */

import { maskKey } from '../utils/mask.js';
import { SecureCredential } from '../utils/secure-credential.js';

/**
 * Detected credential information
 *
 * The maskedValue is safe for logging/display as it only shows
 * the first 2 and last 4 characters with random padding.
 */
export interface DetectedCredential {
  /** Human-readable name of the credential provider */
  name: string;
  /** The actual environment variable name */
  key: string;
  /** Masked value for display (safe to log) */
  maskedValue: string;
  /** Whether the credential is currently set in the environment */
  present: boolean;
}

/**
 * Known credential patterns for detection
 *
 * Each entry maps a provider name to its environment variable name.
 * Only these specific patterns are checked - no arbitrary env vars.
 */
const CREDENTIAL_PATTERNS = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  ollama: 'OLLAMA_HOST'
} as const;

/**
 * Type-safe list of all credential names we detect
 */
export type CredentialName = keyof typeof CREDENTIAL_PATTERNS;

/**
 * SECURITY: Whitelist of allowed environment variable names
 *
 * This regex strictly matches ONLY the known credential patterns.
 * Any attempt to check environment variables outside this list
 * will be silently ignored, preventing injection attacks.
 *
 * Patterns allowed:
 * - OPENAI_API_KEY
 * - ANTHROPIC_API_KEY
 * - OLLAMA_HOST
 */
const ALLOWED_ENV_PATTERNS = /^(OPENAI_API_KEY|ANTHROPIC_API_KEY|OLLAMA_HOST)$/;

/**
 * Maximum number of credentials to detect
 *
 * Prevents unbounded iteration if CREDENTIAL_PATTERNS is modified
 */
const MAX_CREDENTIALS = 10;

/**
 * Validates that an environment variable name is allowed
 *
 * This is the primary defense against environment variable injection.
 * Only known, whitelisted variable names can be checked.
 *
 * @param envVarName - The environment variable name to validate
 * @returns True if the variable name is in the whitelist
 */
function isAllowedEnvVar(envVarName: string): boolean {
  return ALLOWED_ENV_PATTERNS.test(envVarName);
}

/**
 * Validates that a value is safe to process as a credential
 *
 * Rejects non-string values to prevent type confusion attacks.
 * Undefined and null are treated as "not set" rather than errors.
 *
 * @param value - The value to validate
 * @returns True if the value is a valid string credential
 */
function isValidCredentialValue(value: unknown): value is string {
  // undefined/null means credential is not set (not an error)
  if (value === null || value === undefined) {
    return false;
  }

  // Only non-empty string values are valid
  if (typeof value !== 'string') {
    return false;
  }

  // Empty strings are treated as "not set"
  if (value.length === 0) {
    return false;
  }

  return true;
}

/**
 * Scans the environment for known API credentials
 *
 * This function:
 * 1. Only checks whitelisted environment variable names
 * 2. Validates value types before processing
 * 3. Uses SecureCredential for memory safety
 * 4. Returns masked values safe for logging
 * 5. Properly disposes credentials after masking
 *
 * SECURITY: The maskedValue is safe to log - it only shows
 * first 2 + last 4 characters with random padding between.
 *
 * @returns Array of detected credentials (both present and absent)
 *
 * @example
 * ```ts
 * const credentials = detectCredentials();
 * // [
 * //   { name: 'openai', key: 'OPENAI_API_KEY', maskedValue: 'sk****1234', present: true },
 * //   { name: 'anthropic', key: 'ANTHROPIC_API_KEY', maskedValue: 'not set', present: false },
 * // ]
 * ```
 */
export function detectCredentials(): DetectedCredential[] {
  const detected: DetectedCredential[] = [];
  let checked = 0;

  for (const [name, envVar] of Object.entries(CREDENTIAL_PATTERNS)) {
    // Enforce limit to prevent unbounded iteration
    if (checked >= MAX_CREDENTIALS) {
      break;
    }

    // SECURITY FIX (HP-4): Validate environment variable name against whitelist
    if (!isAllowedEnvVar(envVar)) {
      // Skip any patterns not in our whitelist
      // This prevents environment variable injection
      continue;
    }

    // Get value from environment
    const value = process.env[envVar];

    // SECURITY FIX (HP-4): Validate value type before processing
    if (!isValidCredentialValue(value)) {
      // Credential not set or invalid type
      detected.push({
        name,
        key: envVar,
        maskedValue: 'not set',
        present: false
      });
      checked++;
      continue;
    }

    // Use SecureCredential for memory safety
    let secure: SecureCredential | null = null;
    try {
      secure = new SecureCredential(value);

      // Mask the value for safe display/logging
      const masked = maskKey(secure.toString());

      detected.push({
        name,
        key: envVar,
        maskedValue: masked,
        present: true
      });
    } catch {
      // If SecureCredential throws (e.g., value too large), treat as not set
      detected.push({
        name,
        key: envVar,
        maskedValue: 'not set',
        present: false
      });
    } finally {
      // SECURITY: Always zero memory after use
      secure?.dispose();
    }

    checked++;
  }

  return detected;
}

/**
 * Checks if a specific credential is present in the environment
 *
 * Convenience function for checking a single credential type.
 *
 * @param name - The credential name to check (e.g., 'openai', 'anthropic')
 * @returns True if the credential is present and valid
 *
 * @example
 * ```ts
 * if (isCredentialPresent('openai')) {
 *   // OPENAI_API_KEY is set
 * }
 * ```
 */
export function isCredentialPresent(name: CredentialName): boolean {
  const envVar = CREDENTIAL_PATTERNS[name];
  if (!envVar) {
    return false;
  }

  const value = process.env[envVar];
  return isValidCredentialValue(value);
}

/**
 * Gets the masked value of a specific credential
 *
 * Returns the masked value for display purposes. The actual
 * credential value is never returned in plain text.
 *
 * @param name - The credential name to get
 * @returns The masked credential value, or 'not set' if absent
 *
 * @example
 * ```ts
 * const masked = getCredentialMasked('openai');
 * console.log(`OpenAI key: ${masked}`); // "OpenAI key: sk****1234"
 * ```
 */
export function getCredentialMasked(name: CredentialName): string {
  const envVar = CREDENTIAL_PATTERNS[name];
  if (!envVar) {
    return 'not set';
  }

  const value = process.env[envVar];
  if (!isValidCredentialValue(value)) {
    return 'not set';
  }

  // Use SecureCredential for memory safety
  const secure = new SecureCredential(value);
  try {
    return maskKey(secure.toString());
  } finally {
    secure.dispose();
  }
}

/**
 * Gets all present credentials (filters out absent ones)
 *
 * Convenience function that returns only credentials that
 * are actually set in the environment.
 *
 * @returns Array of credentials that are present
 */
export function getPresentCredentials(): DetectedCredential[] {
  return detectCredentials().filter(cred => cred.present);
}

/**
 * Gets all credential patterns we support detecting
 *
 * Useful for UI display or configuration validation.
 *
 * @returns Array of supported credential names
 */
export function getSupportedCredentialNames(): CredentialName[] {
  return Object.keys(CREDENTIAL_PATTERNS) as CredentialName[];
}
