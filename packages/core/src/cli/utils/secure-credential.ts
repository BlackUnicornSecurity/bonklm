/**
 * Secure Credential Handling
 *
 * This module provides the SecureCredential class for safely handling
 * sensitive credential values in memory. It uses Buffer.alloc() for
 * clean memory initialization and enforces size limits to prevent
 * DoS attacks through memory exhaustion.
 *
 * SECURITY: Buffer Overflow Protection (C-5)
 * - Maximum credential size: 8KB (8192 bytes)
 * - Uses Buffer.alloc() for zero-initialized memory
 * - Automatic memory zeroing on disposal
 *
 * SECURITY IMPORTANT: JavaScript Limitations
 * - Strings are immutable and cannot be zeroed from memory
 * - toString() returns a string that may persist in memory indefinitely
 * - ALWAYS use use() or useSync() for automatic scoping
 * - NEVER capture the return value of toString() in a variable
 * - The callback in use()/useSync() MUST NOT capture the credential string
 */

import { Buffer } from 'node:buffer';
import { WizardError } from './error.js';

/**
 * Symbol for custom inspect method to prevent credential leakage
 */
const INSPECT_CUSTOM = Symbol.for('nodejs.util.inspect.custom');

/**
 * Maximum allowed size for a credential in bytes
 *
 * This limit prevents DoS attacks through memory exhaustion while
 * accommodating all legitimate API key formats.
 *
 * Typical API key sizes:
 * - OpenAI: 51 bytes (sk-... 48 chars + prefix)
 * - Anthropic: 104 bytes (sk-ant-... 95 chars + prefix)
 * - AWS: Up to several KB for some tokens
 */
const MAX_CREDENTIAL_SIZE = 8192; // 8KB

/**
 * Securely wraps sensitive credential values in memory
 *
 * This class provides secure memory handling for credentials:
 * - Uses Buffer.alloc() for clean (zero-initialized) memory
 * - Enforces 8KB size limit to prevent DoS
 * - Automatically zeros memory after use
 * - Provides try/finally pattern for automatic cleanup
 *
 * @example
 * ```ts
 * // Manual usage
 * const credential = new SecureCredential(apiKey);
 * try {
 *   const result = await validateApiKey(credential.toString());
 * } finally {
 *   credential.dispose();
 * }
 *
 * // Automatic cleanup with use()
 * const credential = new SecureCredential(apiKey);
 * await credential.use(async (key) => {
 *   return await validateApiKey(key);
 * });
 * // Memory is already zeroed here
 * ```
 */
export class SecureCredential {
  /**
   * The underlying buffer containing the credential
   *
   * Marked private to prevent direct access
   */
  private buffer: Buffer;

  /**
   * Track whether this credential has been disposed
   *
   * When true, toString() returns empty string instead of
   * accessing the zeroed buffer
   */
  private disposed: boolean = false;

  /**
   * Track whether use()/useSync() is currently active
   *
   * Prevents re-entry attacks and concurrent access
   */
  private inUse: boolean = false;

  /**
   * Creates a new SecureCredential
   *
   * @param value - The credential value to store securely
   * @throws {WizardError} If the credential exceeds MAX_CREDENTIAL_SIZE
   */
  constructor(value: string) {
    // Calculate byte length (UTF-8 may use multiple bytes per character)
    const byteLength = Buffer.byteLength(value, 'utf-8');

    // Enforce size limits to prevent DoS (C-5 fix)
    if (byteLength > MAX_CREDENTIAL_SIZE) {
      throw new WizardError(
        'CREDENTIAL_TOO_LARGE',
        `Credential size (${byteLength} bytes) exceeds maximum (${MAX_CREDENTIAL_SIZE} bytes)`,
        'Use a shorter API key or token',
        undefined,
        1
      );
    }

    // Use Buffer.alloc() for clean memory (C-5 fix)
    // This ensures the buffer is zero-initialized, preventing
    // exposure of data from previous allocations
    this.buffer = Buffer.alloc(byteLength);
    this.buffer.write(value, 'utf-8');
  }

  /**
   * Returns the credential as a string
   *
   * This returns the actual credential value. Use with caution
   * and ensure the value is not logged or exposed in error messages.
   *
   * @returns The credential value as a UTF-8 string
   */
  toString(): string {
    if (this.disposed) {
      return '';
    }
    return this.buffer.toString('utf-8');
  }

  /**
   * Securely zeros the memory containing the credential
   *
   * This method overwrites the buffer with zeros to prevent
   * credential data from remaining in memory.
   *
   * @security Note: JavaScript garbage collection means the memory may
   * be reallocated before being overwritten. This is a best-effort
   * security measure. The original string passed to the constructor
   * also remains in memory until garbage collected.
   *
   * After calling dispose(), the credential should not be used again.
   *
   * @example
   * ```ts
   * const credential = new SecureCredential(apiKey);
   * // ... use the credential ...
   * credential.dispose(); // Memory is zeroed
   * ```
   */
  dispose(): void {
    if (this.disposed) {
      return; // Idempotent - safe to call multiple times
    }
    this.buffer.fill(0);
    this.disposed = true;
  }

  /**
   * Executes a callback with automatic credential cleanup
   *
   * This is the RECOMMENDED way to use credentials as it ensures
   * the memory is always zeroed, even if the callback throws an error.
   *
   * @param fn - Async callback function that receives the credential string
   * @returns The result of the callback function
   * @throws {WizardError} If the credential has already been disposed or is in use
   *
   * @security
   * The callback MUST NOT capture the credential string in a closure,
   * store it in a variable, or return it. Doing so completely bypasses
   * the security mechanism.
   *
   * @example
   * ```ts
   * const credential = new SecureCredential(apiKey);
   * const result = await credential.use(async (key) => {
   *   // Use key inline, DO NOT assign to a variable
   *   return await fetch('https://api.example.com/validate', {
   *     headers: { 'Authorization': `Bearer ${key}` }
   *   });
   * });
   * // credential.dispose() was already called automatically
   * ```
   */
  async use<T>(fn: (credential: string) => Promise<T>): Promise<T> {
    // Guard against use-after-dispose
    if (this.disposed) {
      throw new WizardError(
        'CREDENTIAL_DISPOSED',
        'Cannot use a credential that has already been disposed',
        'Create a new SecureCredential instance',
        undefined,
        1
      );
    }

    // Guard against re-entry
    if (this.inUse) {
      throw new WizardError(
        'CREDENTIAL_IN_USE',
        'Cannot re-enter use() while already in progress',
        'Complete the current use() call before starting another',
        undefined,
        1
      );
    }

    this.inUse = true;
    try {
      return await fn(this.toString());
    } finally {
      this.inUse = false;
      this.dispose();
    }
  }

  /**
   * Synchronous version of use() for non-async callbacks
   * @param fn - Callback function that receives the credential string
   * @returns The result of the callback function
   * @throws {WizardError} If the credential has already been disposed or is in use
   * @security The callback MUST NOT capture the credential string.
   */
  useSync<T>(fn: (credential: string) => T): T {
    if (this.disposed) {
      throw new WizardError(
        'CREDENTIAL_DISPOSED',
        'Cannot use a credential that has already been disposed',
        'Create a new SecureCredential instance',
        undefined,
        1
      );
    }
    if (this.inUse) {
      throw new WizardError(
        'CREDENTIAL_IN_USE',
        'Cannot re-enter useSync() while already in progress',
        'Complete the current useSync() call before starting another',
        undefined,
        1
      );
    }
    this.inUse = true;
    try {
      return fn(this.toString());
    } finally {
      this.inUse = false;
      this.dispose();
    }
  }

  /** Returns whether this credential has been disposed */
  get isDisposed(): boolean {
    return this.disposed;
  }

  /** Custom inspect to prevent credential leakage in console.log */
  [INSPECT_CUSTOM](): string {
    return this.disposed ? '[SecureCredential: disposed]' : '[SecureCredential: REDACTED]';
  }

  /** Custom toJSON to prevent credential leakage in JSON.stringify */
  toJSON(): string {
    return this.disposed ? '[SecureCredential: disposed]' : '[SecureCredential: REDACTED]';
  }

  /** Custom valueOf to prevent accidental credential exposure */
  valueOf(): undefined {
    return undefined;
  }
}

/** Callback type for async use() method */
export type CredentialCallback<T> = (credential: string) => Promise<T>;

/** Callback type for sync useSync() method */
export type CredentialCallbackSync<T> = (credential: string) => T;

/** Error codes specific to SecureCredential */
export const SecureCredentialError = {
  TOO_LARGE: 'CREDENTIAL_TOO_LARGE',
  DISPOSED: 'CREDENTIAL_DISPOSED',
  IN_USE: 'CREDENTIAL_IN_USE'
} as const;
