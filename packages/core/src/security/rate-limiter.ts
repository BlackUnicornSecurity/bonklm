/**
 * BonkLM - Rate Limiter
 * ================================
 *
 * S016-003: Sliding window rate limiter to prevent DoS attacks.
 *
 * Features:
 * - Sliding window algorithm for accurate rate limiting
 * - Per-key rate limiting (by sessionId, IP, etc.)
 * - Configurable window size and request limit
 * - Automatic cleanup of expired entries
 *
 * @package @blackunicorn/bonklm
 */

// =============================================================================
// TYPES
// =============================================================================

/**
 * Rate limiter configuration.
 */
export interface RateLimiterConfig {
  /** Maximum number of requests allowed in the time window */
  maxRequests: number;
  /** Time window in milliseconds */
  windowMs: number;
  /** Enable/disable rate limiting */
  enabled?: boolean;
}

/**
 * Rate limit check result.
 */
export interface RateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean;
  /** Number of requests made in the current window */
  count: number;
  /** Number of requests remaining in the window */
  remaining: number;
  /** Time when the window will reset (milliseconds since epoch) */
  resetTime: number;
  /** Estimated time until next request is allowed (milliseconds) */
  retryAfter?: number;
}

/**
 * Rate limit entry for tracking requests.
 */
interface RateLimitEntry {
  timestamps: number[];
  windowStart: number;
}

// =============================================================================
// CONSTANTS
// =============================================================================

/** Default rate limit: 100 requests per minute */
export const DEFAULT_RATE_LIMIT: RateLimiterConfig = {
  maxRequests: 100,
  windowMs: 60000, // 1 minute
  enabled: true
};

/** Cleanup interval for removing old rate limit entries */
const CLEANUP_INTERVAL = 1000; // Check every 1000 operations

// =============================================================================
// RATE LIMITER CLASS
// =============================================================================

/**
 * Sliding window rate limiter.
 * Prevents DoS attacks by limiting request rate per key.
 */
export class RateLimiter {
  private readonly config: Required<RateLimiterConfig>;
  private readonly entries: Map<string, RateLimitEntry> = new Map();
  private cleanupCounter = 0;

  constructor(config: RateLimiterConfig = DEFAULT_RATE_LIMIT) {
    this.config = {
      ...DEFAULT_RATE_LIMIT,
      ...config,
      enabled: config.enabled ?? true
    };
  }

  /**
   * Check if a request is allowed for the given key.
   *
   * @param key - Identifier to rate limit (sessionId, IP, etc.)
   * @param timestamp - Current timestamp (defaults to Date.now())
   * @returns Rate limit result
   */
  checkLimit(key: string, timestamp: number = Date.now()): RateLimitResult {
    // If rate limiting is disabled, always allow
    if (!this.config.enabled) {
      return {
        allowed: true,
        count: 0,
        remaining: this.config.maxRequests,
        resetTime: timestamp + this.config.windowMs
      };
    }

    // Periodic cleanup of old entries
    this.cleanupCounter++;
    if (this.cleanupCounter >= CLEANUP_INTERVAL) {
      this.cleanupCounter = 0;
      this.cleanup(timestamp);
    }

    // Get or create entry for this key
    let entry = this.entries.get(key);
    if (!entry) {
      entry = {
        timestamps: [],
        windowStart: timestamp
      };
      this.entries.set(key, entry);
    }

    // Slide the window if the current timestamp is outside the current window
    const windowElapsed = timestamp - entry.windowStart;
    if (windowElapsed >= this.config.windowMs) {
      // Start a new window
      entry.timestamps = [];
      entry.windowStart = timestamp;
    } else if (windowElapsed > 0) {
      // Remove timestamps outside the sliding window
      const windowStart = timestamp - this.config.windowMs;
      entry.timestamps = entry.timestamps.filter(ts => ts >= windowStart);
    }

    // Check if limit is exceeded
    const count = entry.timestamps.length;
    const allowed = count < this.config.maxRequests;

    if (allowed) {
      // Add current request timestamp
      entry.timestamps.push(timestamp);
    }

    // Calculate window end time
    const windowEnd = entry.windowStart + this.config.windowMs;

    return {
      allowed,
      count: entry.timestamps.length,
      remaining: Math.max(0, this.config.maxRequests - entry.timestamps.length),
      resetTime: windowEnd,
      retryAfter: allowed ? undefined : Math.max(0, windowEnd - timestamp)
    };
  }

  /**
   * Reset the rate limit for a specific key.
   * Useful for admin actions or testing.
   *
   * @param key - Identifier to reset
   */
  reset(key: string): void {
    this.entries.delete(key);
  }

  /**
   * Clear all rate limit entries.
   */
  clear(): void {
    this.entries.clear();
  }

  /**
   * Get current statistics for a key.
   *
   * @param key - Identifier to check
   * @returns Current count or 0 if not found
   */
  getCount(key: string): number {
    const entry = this.entries.get(key);
    if (!entry) {
      return 0;
    }

    // Filter to current window
    const now = Date.now();
    const windowStart = now - this.config.windowMs;
    const validTimestamps = entry.timestamps.filter(ts => ts >= windowStart);
    return validTimestamps.length;
  }

  /**
   * Get the number of tracked keys.
   */
  getKeyCount(): number {
    return this.entries.size;
  }

  /**
   * Clean up expired entries (outside any window).
   */
  private cleanup(now: number): void {
    const oldestAllowed = now - this.config.windowMs;

    for (const [key, entry] of this.entries.entries()) {
      // Remove old timestamps
      entry.timestamps = entry.timestamps.filter(ts => ts >= oldestAllowed);

      // Remove entry if no valid timestamps remain
      if (entry.timestamps.length === 0) {
        this.entries.delete(key);
      }
    }
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create a rate limiter with the specified configuration.
 */
export function createRateLimiter(config?: RateLimiterConfig): RateLimiter {
  return new RateLimiter(config);
}

/**
 * Create a rate limiter for common scenarios.
 */
export const CommonRateLimiters = {
  /** 100 requests per minute (default) */
  default: () => new RateLimiter(DEFAULT_RATE_LIMIT),

  /** Strict: 10 requests per minute */
  strict: () => new RateLimiter({ maxRequests: 10, windowMs: 60000, enabled: true }),

  /** Lenient: 1000 requests per minute */
  lenient: () => new RateLimiter({ maxRequests: 1000, windowMs: 60000, enabled: true }),

  /** API endpoint: 60 requests per minute */
  api: () => new RateLimiter({ maxRequests: 60, windowMs: 60000, enabled: true }),

  /** Per second: 5 requests per second */
  perSecond: () => new RateLimiter({ maxRequests: 5, windowMs: 1000, enabled: true }),

  /** Disabled (always allows) */
  disabled: () => new RateLimiter({ maxRequests: 0, windowMs: 60000, enabled: false })
};
