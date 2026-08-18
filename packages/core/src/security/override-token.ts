/**
 * Override Token Validation
 *
 * S011-006: Cryptographic validation for override tokens.
 * Provides HMAC-based token validation with expiration and audit logging.
 *
 * @package @blackunicorn/bonklm
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Logger } from '../base/GenericLogger.js';

/**
 * Token format: timestamp:signature:nonce:scope
 * - timestamp: Unix timestamp for expiration check
 * - signature: HMAC-SHA256 signature
 * - nonce: Random bytes to prevent replay attacks
 * - scope: Token scope (admin, emergency, readonly)
 */
const TOKEN_FORMAT = '^(\\d+):([a-f0-9]{64}):([a-f0-9]{16,32}):([a-z_]+)$';

/**
 * Default token expiration: 1 hour (3600000 ms)
 */
const DEFAULT_TOKEN_EXPIRATION_MS = 3600000;

/**
 * HMAC algorithm for token signing
 */
const HMAC_ALGORITHM = 'sha256';

/**
 * Token scopes
 */
export enum TokenScope {
  /** Full bypass - use with extreme caution */
  ADMIN = 'admin',
  /** Time-limited emergency bypass */
  EMERGENCY = 'emergency',
  /** Read-only access - allows logging but no actual bypass */
  READONLY = 'readonly'
}

/**
 * Token validation result
 */
export interface TokenValidationResult {
  /** Whether the token is valid */
  valid: boolean;
  /** Validation error message (if invalid) */
  error?: string;
  /** Token scope (if valid) */
  scope?: TokenScope;
  /** Token timestamp (if valid) */
  timestamp?: number;
}

/**
 * Override token configuration
 */
export interface OverrideTokenConfig {
  /** HMAC secret key (must be 32+ bytes) */
  secret: string;
  /** Token expiration in milliseconds (default 1 hour) */
  expirationMs?: number;
  /** Maximum number of tokens to track for replay protection */
  maxReplayCache?: number;
}

/**
 * Token usage for audit logging
 */
export interface TokenUsage {
  timestamp: number;
  scope: TokenScope;
  contentHash: string;
  success: boolean;
  error?: string;
}

/**
 * Replay protection cache entry
 */
interface ReplayCacheEntry {
  nonce: string;
  usedAt: number;
}

/**
 * Override Token Validator
 *
 * Provides cryptographic validation for override tokens with:
 * - HMAC-SHA256 signature verification
 * - Token expiration checking
 * - Replay attack prevention
 * - Timing-safe comparison
 *
 * @public v1.0-RC1 API freeze. Crypto contract frozen:
 * HMAC-SHA256, 32-byte minimum secret, base64url payload, 5-min
 * default expiry, `timingSafeEqual` comparison. Replay cache eviction
 * policy is `@internal` (may switch from LRU to TTL-based without
 * notice).
 */
export class OverrideTokenValidator {
  private readonly secret: Buffer;
  private readonly expirationMs: number;
  private readonly maxReplayCache: number;
  private readonly replayCache: Map<string, ReplayCacheEntry>;
  private readonly tokenFormatRegex: RegExp;

  constructor(config: OverrideTokenConfig) {
    if (!config.secret || config.secret.length < 32) {
      throw new Error('Override token secret must be at least 32 characters');
    }

    this.secret = Buffer.from(config.secret, 'utf-8');
    this.expirationMs = config.expirationMs ?? DEFAULT_TOKEN_EXPIRATION_MS;
    this.maxReplayCache = config.maxReplayCache ?? 10000;
    this.replayCache = new Map();
    this.tokenFormatRegex = new RegExp(TOKEN_FORMAT);
  }

  /**
   * Generate a new override token
   *
   * @param scope - Token scope
   * @param _customExpirationMs - Optional custom expiration (reserved for future use)
   * @returns Generated token string
   */
  generateToken(scope: TokenScope = TokenScope.ADMIN, _customExpirationMs?: number): string {
    const timestamp = Date.now();
    const nonce = randomBytes(16).toString('hex');

    // Create signature payload
    const payload = `${timestamp}:${nonce}:${scope}`;
    const signature = createHmac(HMAC_ALGORITHM, this.secret).update(payload).digest('hex');

    return `${timestamp}:${signature}:${nonce}:${scope}`;
  }

  /**
   * Validate an override token
   *
   * @param token - Token string to validate
   * @returns Validation result
   */
  validateToken(token: string): TokenValidationResult {
    // Parse token format
    const match = token.match(this.tokenFormatRegex);
    if (!match) {
      return { valid: false, error: 'Invalid token format' };
    }

    const [, timestampStr, providedSignature, nonce, scopeStr] = match;
    const timestamp = parseInt(timestampStr, 10);

    // Check expiration
    const now = Date.now();
    if (now - timestamp > this.expirationMs) {
      return { valid: false, error: 'Token expired' };
    }

    // Check for future timestamp (clock skew protection)
    if (timestamp > now + 60000) {
      // Allow 1 minute clock skew
      return { valid: false, error: 'Token timestamp in future' };
    }

    // Check replay protection
    const replayKey = `${nonce}:${scopeStr}`;
    if (this.replayCache.has(replayKey)) {
      return { valid: false, error: 'Token already used (replay attack detected)' };
    }

    // Verify scope
    if (!Object.values(TokenScope).includes(scopeStr as TokenScope)) {
      return { valid: false, error: 'Invalid token scope' };
    }

    // Verify signature
    const payload = `${timestamp}:${nonce}:${scopeStr}`;
    const expectedSignature = createHmac(HMAC_ALGORITHM, this.secret).update(payload).digest('hex');

    // Use timing-safe comparison to prevent timing attacks
    const signatureValid = this.timingSafeEqualString(providedSignature, expectedSignature);
    if (!signatureValid) {
      return { valid: false, error: 'Invalid token signature' };
    }

    // Mark token as used (after all validation passes)
    this.markTokenUsed(replayKey);

    return {
      valid: true,
      scope: scopeStr as TokenScope,
      timestamp
    };
  }

  /**
   * Check if content contains a valid override token
   *
   * @param content - Content to check for token
   * @returns Validation result
   */
  validateContent(content: string): TokenValidationResult {
    // Token format: timestamp:signature:nonce:scope (approx 100+ chars)
    // Extract potential tokens from content
    const potentialTokens = this.extractPotentialTokens(content);

    for (const token of potentialTokens) {
      const result = this.validateToken(token);
      if (result.valid) {
        return result;
      }
    }

    return { valid: false, error: 'No valid override token found' };
  }

  /**
   * Log token usage for audit purposes
   *
   * @param logger - Logger instance
   * @param usage - Token usage details
   */
  logUsage(logger: Logger, usage: TokenUsage): void {
    if (usage.success) {
      logger.warn('Override token used', {
        scope: usage.scope,
        timestamp: new Date(usage.timestamp).toISOString(),
        contentHash: usage.contentHash
      });
    } else {
      logger.warn('Override token validation failed', {
        error: usage.error,
        contentHash: usage.contentHash
      });
    }
  }

  /**
   * Clean up old replay cache entries
   *
   * @param olderThanMs - Remove entries older than this (default: 2x expiration)
   */
  cleanupReplayCache(olderThanMs: number = this.expirationMs * 2): void {
    const now = Date.now();
    const cutoff = now - olderThanMs;

    for (const [key, entry] of this.replayCache.entries()) {
      if (entry.usedAt < cutoff) {
        this.replayCache.delete(key);
      }
    }
  }

  /**
   * Clear the replay cache (for testing purposes)
   */
  clearReplayCache(): void {
    this.replayCache.clear();
  }

  /**
   * Mark a token as used (replay protection).
   *
   * @internal Eviction policy: TTL-based only.
   *
   * Security contract: a used-nonce entry MUST NOT be evicted while the
   * corresponding token is still within its validity window
   * (`expirationMs`). FIFO / size-only eviction violates this because an
   * attacker can flood the cache with valid junk tokens, evict the oldest
   * used-nonce, and then replay the original token.
   *
   * Strategy:
   * 1. Before inserting a new entry, sweep the cache and remove any
   *    entry whose TTL has elapsed (`usedAt + expirationMs <= now`).
   * 2. If, after the sweep, the cache is still at or above capacity, the
   *    token is refused (fail-closed) — this prevents memory exhaustion
   *    while preserving replay protection for all active tokens.
   */
  private markTokenUsed(key: string): void {
    const now = Date.now();

    // Step 1: evict only TTL-expired entries.
    for (const [entryKey, entry] of this.replayCache.entries()) {
      if (entry.usedAt + this.expirationMs <= now) {
        this.replayCache.delete(entryKey);
      }
    }

    // Step 2: fail-closed if capacity still exceeded after TTL sweep.
    // Every remaining live entry is still within its validity window —
    // evicting any of them would break replay protection.
    if (this.replayCache.size >= this.maxReplayCache) {
      throw new Error(
        'Override token replay cache is at capacity with active entries. ' +
          'Token rejected to preserve replay protection. ' +
          'Increase maxReplayCache or wait for active tokens to expire.'
      );
    }

    this.replayCache.set(key, {
      nonce: key,
      usedAt: now
    });
  }

  /**
   * Extract potential override tokens from content
   */
  private extractPotentialTokens(content: string): string[] {
    const tokens: string[] = [];

    // Token format pattern (timestamp:signature:nonce:scope)
    // timestamp: 10-13 digits
    // signature: 64 hex chars
    // nonce: 16-32 hex chars
    // scope: lowercase letters and underscores
    // Use lookahead to ensure token ends with non-alphanumeric/: or end of string
    const tokenPattern = /(\d{10,13}:[a-f0-9]{64}:[a-f0-9]{16,32}:[a-z_]+)(?![a-z0-9_:])/gi;

    let match;
    while ((match = tokenPattern.exec(content)) !== null) {
      tokens.push(match[1]);
    }

    return tokens;
  }

  /**
   * Timing-safe string comparison
   *
   * Uses crypto.timingSafeEqual with proper length handling
   */
  private timingSafeEqualString(a: string, b: string): boolean {
    if (a.length !== b.length) {
      return false;
    }

    try {
      return timingSafeEqual(Buffer.from(a, 'utf-8'), Buffer.from(b, 'utf-8'));
    } catch {
      return false;
    }
  }
}

/**
 * Create a deterministic content fingerprint for audit-log correlation.
 *
 * @internal
 *
 * **Threat model — what this IS:**
 * This is a deterministic content fingerprint, NOT a security MAC. Its
 * purpose is to correlate a token-validation event in one log line with
 * the content that triggered it in another, without storing the raw content.
 * Collision resistance is provided by HMAC-SHA256's construction; the fixed
 * key is intentional (see below).
 *
 * **Threat model — what this IS NOT:**
 * Do NOT use this function to verify the authenticity or integrity of a
 * message. The hardcoded key `'audit-hash'` is public knowledge; any party
 * can reproduce the same fingerprint for arbitrary content. There is no
 * secret here. Using this output as a MAC would provide zero protection
 * against a motivated attacker.
 *
 * **Why HMAC-SHA256 with a constant key instead of plain SHA-256?**
 * Raw SHA-256 over a variable-length input is vulnerable to length-extension
 * attacks: an attacker who knows `SHA256(content)` can compute
 * `SHA256(content || attacker_suffix)` without knowing `content`. HMAC
 * eliminates this class of attack via its inner/outer key padding — even
 * with a public constant key. For a read-only audit fingerprint this is
 * a meaningful defence-in-depth measure.
 *
 * **For ACTUAL MAC use** (e.g. verifying an override token's end-to-end
 * integrity with a user-supplied secret):
 * ```ts
 * import { createHmac } from 'node:crypto';
 * const mac = createHmac('sha256', userProvidedSecret)
 *   .update(payload)
 *   .digest('hex');
 * ```
 *
 * @param content - Content to fingerprint (first 1000 chars are used)
 * @returns 16-character hex fingerprint
 */
export function hashContent(content: string): string {
  return createHmac(HMAC_ALGORITHM, 'audit-hash')
    .update(content.slice(0, 1000)) // Only hash first 1000 chars
    .digest('hex')
    .slice(0, 16);
}

/**
 * Get override token secret from environment
 *
 * Priority order:
 * 1. BONKLM_OVERRIDE_SECRET environment variable
 * 2. LLM_GUARDRAILS_OVERRIDE_SECRET (legacy)
 * 3. Throws error in production if not set
 *
 * @returns Secret key string
 * @throws Error if secret not available
 */
export function getOverrideTokenSecret(): string {
  const secret = process.env.BONKLM_OVERRIDE_SECRET || process.env.LLM_GUARDRAILS_OVERRIDE_SECRET;

  if (!secret) {
    const isProduction =
      process.env.NODE_ENV === 'production' ||
      process.env.RAILS_ENV === 'production' ||
      process.env.FLASK_ENV === 'production';

    if (isProduction) {
      throw new Error('BONKLM_OVERRIDE_SECRET must be set in production. ' + 'Generate with: openssl rand -base64 32');
    }

    // For development/testing, use a placeholder
    console.warn(
      '[SECURITY] Using temporary override token secret for development. Set BONKLM_OVERRIDE_SECRET in production!'
    );
    return randomBytes(32).toString('base64');
  }

  if (secret.length < 32) {
    throw new Error('BONKLM_OVERRIDE_SECRET must be at least 32 characters');
  }

  return secret;
}

/**
 * Create an override token validator from environment
 *
 * @returns Configured validator instance
 */
export function createOverrideTokenValidator(): OverrideTokenValidator {
  const secret = getOverrideTokenSecret();
  return new OverrideTokenValidator({ secret });
}

/**
 * Type for override token configuration in engine config
 */
export type OverrideTokenConfigString = string | OverrideTokenConfig;

/**
 * Parse override token configuration
 *
 * Supports both simple string (legacy) and new config object
 *
 * @param config - Configuration string or object
 * @returns Parsed configuration
 */
export function parseOverrideTokenConfig(config: OverrideTokenConfigString): OverrideTokenConfig {
  if (typeof config === 'string') {
    // Legacy mode: simple string (INSECURE - for backward compatibility)
    return { secret: config };
  }

  return config;
}
