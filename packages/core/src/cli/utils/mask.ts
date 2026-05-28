/**
 * Mask Utility - Secure credential masking
 *
 * This module provides functions for masking sensitive values like API keys
 * while preventing timing attacks through randomization.
 */

import { randomBytes } from 'node:crypto';

/**
 * Minimum length threshold for showing partial content
 */
const MIN_VISIBLE_LENGTH = 8;

/**
 * Minimum and maximum padding for random padding
 */
const MIN_PADDING = 10;
const MAX_PADDING = 19;

/**
 * Masks a sensitive value (like an API key) for logging/display purposes.
 *
 * Shows only the first 2 and last 4 characters for values longer than 8 chars.
 * Uses random padding to prevent timing attacks based on output length.
 *
 * @param value - The sensitive value to mask (e.g., API key, token)
 * @returns The masked string with random padding
 *
 * @example
 * ```ts
 * maskKey('sk-1234567890abcdef') // 'sk***************1234'
 * maskKey('short')                // '***'
 * maskKey('')                     // '***'
 * ```
 */
export function maskKey(value: string): string {
  // Handle empty or short values
  if (value.length <= MIN_VISIBLE_LENGTH) {
    return '***';
  }

  const prefix = value.slice(0, 2);
  const suffix = value.slice(-4);

  // Generate cryptographically secure random padding WITHOUT modulo bias
  // Use rejection sampling to ensure uniform distribution (prevents timing attacks)
  const range = MAX_PADDING - MIN_PADDING + 1; // 10 possible values
  let randomByte: number;
  let paddingLength: number;
  do {
    randomByte = randomBytes(1)[0];
    paddingLength = (randomByte % range) + MIN_PADDING;
  } while (randomByte >= 256 - (256 % range)); // Reject bytes that would cause bias
  const padding = '*'.repeat(paddingLength);

  return `${prefix}${padding}${suffix}`;
}

/**
 * Masks a value while preserving a specific visible prefix length.
 *
 * @param value - The value to mask
 * @param visibleChars - Number of characters to show at the start
 * @param suffixChars - Number of characters to show at the end
 * @returns The masked string
 */
export function maskKeyWithCustomLength(value: string, visibleChars: number, suffixChars: number): string {
  // Validate input parameters
  if (!Number.isInteger(visibleChars) || visibleChars < 0) {
    throw new TypeError('visibleChars must be a non-negative integer');
  }
  if (!Number.isInteger(suffixChars) || suffixChars < 0) {
    throw new TypeError('suffixChars must be a non-negative integer');
  }

  if (value.length <= visibleChars + suffixChars) {
    return '***';
  }

  const prefix = value.slice(0, visibleChars);
  const suffix = value.slice(-suffixChars);

  // Use same rejection sampling for consistent timing attack protection
  const range = MAX_PADDING - MIN_PADDING + 1;
  let randomByte: number;
  let paddingLength: number;
  do {
    randomByte = randomBytes(1)[0];
    paddingLength = (randomByte % range) + MIN_PADDING;
  } while (randomByte >= 256 - (256 % range));
  const padding = '*'.repeat(paddingLength);

  return `${prefix}${padding}${suffix}`;
}

/**
 * Masks all but the last N characters of a value.
 *
 * Useful for showing just enough to identify the type of credential.
 *
 * @param value - The value to mask
 * @param visibleChars - Number of characters to show at the end
 * @returns The masked string
 */
export function maskAllButLast(value: string, visibleChars: number = 4): string {
  if (value.length <= visibleChars) {
    return '***';
  }

  const suffix = value.slice(-visibleChars);
  const prefixLength = value.length - visibleChars;

  // Use exact prefix length for masking (deterministic for this function)
  const padding = '*'.repeat(prefixLength);

  return `${padding}${suffix}`;
}

/**
 * Checks if a value appears to be already masked.
 *
 * @param value - The value to check
 * @returns True if the value appears to be masked
 */
export function isMasked(value: string): boolean {
  // Common patterns that indicate a masked value
  if (value === '***') {
    return true;
  }

  // Pattern: starts with 3+ asterisks and ends with *** (custom masked format)
  if (/^\*{3,}/.test(value) && value.endsWith('***')) {
    return true;
  }

  // Pattern: 2 chars + 10+ asterisks + 4 chars (maskKey format)
  // Allows any non-asterisk characters in prefix/suffix (handles hyphens, underscores, etc.)
  if (/^[^*]{1,3}\*{10,}[^*]{3,5}$/.test(value)) {
    return true;
  }

  // Pattern: starts with 3+ asterisks and ends with 1+ alphanumeric chars (maskAllButLast format)
  if (/^\*{3,}[a-z0-9]+$/i.test(value)) {
    return true;
  }

  return false;
}
