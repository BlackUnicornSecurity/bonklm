/**
 * Secure API Key Validation Protocol
 *
 * This module provides secure API key validation with the following security features:
 * - Rate limiting to prevent credential enumeration attacks (HP-8 fix)
 * - Credential caching to reduce API calls
 * - Timeout enforcement to prevent hanging
 * - Secure credential handling with automatic memory cleanup
 * - No credential logging
 *
 * SECURITY: Rate Limiting (HP-8)
 * - Maximum 5 validations per minute
 * - LRU cache with 60-second TTL
 * - Throws WizardError when rate limit exceeded
 *
 * @module validation
 */

import { WizardError } from './error.js';
import { SecureCredential } from './secure-credential.js';
import { LRUCache } from 'lru-cache';

/**
 * Validation cache entry
 */
interface CacheEntry {
  timestamp: number;
  result: boolean;
}

/**
 * Rate limiting cache using LRU (Least Recently Used) eviction
 *
 * - Max 100 entries to prevent memory exhaustion
 * - 60 second TTL (time-to-live)
 * - Tracks both successful and failed validations
 */
const validationCache = new LRUCache<string, CacheEntry>({
  max: 100,
  ttl: 60 * 1000 // 1 minute in milliseconds
});

/**
 * Maximum number of validation attempts per minute
 *
 * This limit prevents credential enumeration attacks where an attacker
 * might try many different keys to find valid ones.
 */
const MAX_VALIDATIONS_PER_MINUTE = 5;

/**
 * One minute in milliseconds for rate limit window
 */
const RATE_LIMIT_WINDOW = 60 * 1000;

/**
 * Configuration for secure API key validation
 *
 * This interface defines the parameters needed to validate an API key
 * without exposing sensitive information in logs.
 */
export interface SecureValidationConfig {
  /**
   * HTTP method to use for validation
   *
   * HEAD and OPTIONS are preferred as they don't return a body
   * GET may be necessary if the API doesn't support HEAD/OPTIONS
   */
  method: 'HEAD' | 'OPTIONS' | 'GET';

  /**
   * Whether to send the API key in the Authorization header
   *
   * If true, sends: `Authorization: Bearer ${apiKey}`
   * If false, the key must be sent in the query string or body
   */
  sendInHeader: boolean;

  /**
   * The endpoint URL to call for validation
   *
   * This should be a lightweight endpoint that validates the key
   * without performing expensive operations
   */
  testEndpoint: string;

  /**
   * Maximum time to wait for a response (milliseconds)
   *
   * After this timeout, the validation will be aborted and a
   * WizardError will be thrown
   */
  timeout: number;

  /**
   * Logging level - always 'none' for security
   *
   * This prevents accidental logging of credentials
   */
  logLevel: 'none';
}

/**
 * Validates an API key securely with rate limiting and timeout enforcement
 *
 * This function implements multiple security measures:
 * 1. Rate limiting via LRU cache (HP-8 fix)
 * 2. Timeout enforcement via AbortController
 * 3. Secure credential handling with automatic memory cleanup
 * 4. No credential logging
 *
 * @param apiKey - The API key to validate
 * @param config - Validation configuration
 * @returns Promise<boolean> - True if the key is valid, false otherwise
 * @throws {WizardError} If rate limited, timed out, or network error occurs
 *
 * @example
 * ```ts
 * const isValid = await validateApiKeySecure('sk-abc123', {
 *   method: 'GET',
 *   sendInHeader: true,
 *   testEndpoint: 'https://api.openai.com/v1/models',
 *   timeout: 5000,
 *   logLevel: 'none'
 * });
 * ```
 */
export async function validateApiKeySecure(apiKey: string, config: SecureValidationConfig): Promise<boolean> {
  // Check cache first to avoid unnecessary API calls
  const cached = validationCache.get(apiKey);
  if (cached && Date.now() - cached.timestamp < RATE_LIMIT_WINDOW) {
    return cached.result;
  }

  // Rate limiting: Count recent validations within the time window
  const now = Date.now();
  const recentValidations = Array.from(validationCache.values()).filter(
    entry => now - entry.timestamp < RATE_LIMIT_WINDOW
  );

  if (recentValidations.length >= MAX_VALIDATIONS_PER_MINUTE) {
    throw new WizardError(
      'RATE_LIMITED',
      `Too many validation attempts (maximum ${MAX_VALIDATIONS_PER_MINUTE} per minute)`,
      'Please wait before trying again',
      undefined,
      2 // PARTIAL exit code
    );
  }

  // Use SecureCredential for memory-safe credential handling
  const secureKey = new SecureCredential(apiKey);

  try {
    const result = await secureKey.use(async key => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), config.timeout);

      try {
        // Build fetch options
        const options: RequestInit = {
          method: config.method,
          signal: controller.signal
        };

        // Add Authorization header if configured
        if (config.sendInHeader) {
          options.headers = {
            Authorization: `Bearer ${key}`
          };
        }

        // Make the request
        const response = await fetch(config.testEndpoint, options);

        clearTimeout(timeoutId);

        // Consider 200-299 and 401/403 as successful validation
        // (401/403 means the server recognized and rejected the key)
        // Other errors (network, DNS, etc.) are failures
        if (response.ok || response.status === 401 || response.status === 403) {
          return response.ok; // true for 2xx, false for auth failures
        }

        // For other status codes, throw to trigger catch block
        throw new Error(`Unexpected response status: ${response.status}`);
      } catch (error) {
        clearTimeout(timeoutId);

        // Handle timeout specifically
        if ((error as Error).name === 'AbortError') {
          throw new WizardError(
            'VALIDATION_TIMEOUT',
            `API key validation timed out after ${config.timeout}ms`,
            'Check your network connection and try again',
            error as Error,
            2 // PARTIAL exit code
          );
        }

        // Re-throw other errors
        throw error;
      }
    });

    // Cache the result for future requests
    validationCache.set(apiKey, { timestamp: Date.now(), result });

    return result;
  } finally {
    // Always dispose the credential to zero memory
    secureKey.dispose();
  }
}

/**
 * Clears the validation cache
 *
 * This can be useful for testing or when you want to force
 * re-validation of all keys.
 *
 * @example
 * ```ts
 * clearValidationCache();
 * // All future validations will hit the API
 * ```
 */
export function clearValidationCache(): void {
  validationCache.clear();
}

/**
 * Gets the current rate limit status
 *
 * Returns information about how many validations have been performed
 * in the current time window.
 *
 * @returns Rate limit status information
 *
 * @example
 * ```ts
 * const status = getRateLimitStatus();
 * console.log(`Used ${status.used}/${status.max} validations`);
 * ```
 */
export function getRateLimitStatus(): {
  used: number;
  max: number;
  resetTime: number;
} {
  const now = Date.now();
  const recentValidations = Array.from(validationCache.values()).filter(
    entry => now - entry.timestamp < RATE_LIMIT_WINDOW
  );

  // Find the oldest timestamp in the current window
  const oldestTimestamp = recentValidations.length > 0 ? Math.min(...recentValidations.map(e => e.timestamp)) : now;

  return {
    used: recentValidations.length,
    max: MAX_VALIDATIONS_PER_MINUTE,
    resetTime: oldestTimestamp + RATE_LIMIT_WINDOW
  };
}
