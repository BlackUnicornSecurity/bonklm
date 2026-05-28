/**
 * Rate Limiter Tests (S016-003)
 * ================================
 * Tests for the sliding window rate limiter.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  RateLimiter,
  createRateLimiter,
  CommonRateLimiters,
  DEFAULT_RATE_LIMIT,
  type RateLimiterConfig,
  type RateLimitResult
} from '../../../src/security/rate-limiter.js';

describe('RateLimiter (S016-003)', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter({ maxRequests: 5, windowMs: 1000, enabled: true });
  });

  describe('Basic Rate Limiting', () => {
    it('should allow requests within the limit', () => {
      const key = 'user-1';

      for (let i = 0; i < 5; i++) {
        const result = limiter.checkLimit(key);
        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(5 - i - 1);
      }
    });

    it('should block requests exceeding the limit', () => {
      const key = 'user-1';

      // Use up all requests
      for (let i = 0; i < 5; i++) {
        limiter.checkLimit(key);
      }

      // Next request should be blocked
      const result = limiter.checkLimit(key);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.retryAfter).toBeGreaterThan(0);
    });

    it('should track count correctly', () => {
      const key = 'user-1';

      const result1 = limiter.checkLimit(key);
      expect(result1.count).toBe(1);

      const result2 = limiter.checkLimit(key);
      expect(result2.count).toBe(2);
    });

    it('should return remaining requests correctly', () => {
      const key = 'user-1';

      const result1 = limiter.checkLimit(key);
      expect(result1.remaining).toBe(4);

      const result2 = limiter.checkLimit(key);
      expect(result2.remaining).toBe(3);
    });
  });

  describe('Sliding Window Behavior', () => {
    it('should slide the window forward', async () => {
      const key = 'user-1';
      const limiter = new RateLimiter({ maxRequests: 3, windowMs: 100, enabled: true });

      // Use up all requests
      limiter.checkLimit(key);
      limiter.checkLimit(key);
      limiter.checkLimit(key);

      const blocked = limiter.checkLimit(key);
      expect(blocked.allowed).toBe(false);

      // Wait for window to slide past first request
      await new Promise(resolve => setTimeout(resolve, 110));

      // First request should have fallen out of window
      const result = limiter.checkLimit(key);
      expect(result.allowed).toBe(true);
      expect(result.count).toBe(1);
    });

    it('should maintain accurate count with sliding window', async () => {
      const key = 'user-1';
      const limiter = new RateLimiter({ maxRequests: 10, windowMs: 500, enabled: true });

      // Make 5 requests spaced out
      for (let i = 0; i < 5; i++) {
        const result = limiter.checkLimit(key);
        expect(result.allowed).toBe(true);
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // After 500ms window, earlier requests may have fallen out
      // Count should reflect remaining requests in the sliding window
      const count = limiter.getCount(key);
      expect(count).toBeGreaterThan(0);
      expect(count).toBeLessThanOrEqual(5);
    });
  });

  describe('Per-Key Rate Limiting', () => {
    it('should track limits independently per key', () => {
      const limiter = new RateLimiter({ maxRequests: 2, windowMs: 1000, enabled: true });

      // User 1 makes 2 requests
      limiter.checkLimit('user-1');
      limiter.checkLimit('user-1');
      const blocked1 = limiter.checkLimit('user-1');
      expect(blocked1.allowed).toBe(false);

      // User 2 should still be able to make requests
      const result2 = limiter.checkLimit('user-2');
      expect(result2.allowed).toBe(true);
    });

    it('should handle multiple keys independently', () => {
      const results: Record<string, RateLimitResult> = {};

      for (let i = 0; i < 3; i++) {
        results[`user-${i}`] = limiter.checkLimit(`user-${i}`);
      }

      // All should be allowed
      expect(results['user-0'].allowed).toBe(true);
      expect(results['user-1'].allowed).toBe(true);
      expect(results['user-2'].allowed).toBe(true);
    });
  });

  describe('Reset and Clear', () => {
    it('should reset limit for a specific key', () => {
      const key = 'user-1';

      // Use up limit
      for (let i = 0; i < 5; i++) {
        limiter.checkLimit(key);
      }

      let blocked = limiter.checkLimit(key);
      expect(blocked.allowed).toBe(false);

      // Reset
      limiter.reset(key);

      // Should be allowed again
      const result = limiter.checkLimit(key);
      expect(result.allowed).toBe(true);
    });

    it('should clear all tracked keys', () => {
      limiter.checkLimit('user-1');
      limiter.checkLimit('user-2');
      limiter.checkLimit('user-3');

      expect(limiter.getKeyCount()).toBe(3);

      limiter.clear();

      expect(limiter.getKeyCount()).toBe(0);
    });
  });

  describe('Configuration', () => {
    it('should support custom rate limit configuration', () => {
      const customLimiter = new RateLimiter({
        maxRequests: 100,
        windowMs: 60000,
        enabled: true
      });

      for (let i = 0; i < 100; i++) {
        const result = customLimiter.checkLimit('key');
        expect(result.allowed).toBe(true);
      }

      const blocked = customLimiter.checkLimit('key');
      expect(blocked.allowed).toBe(false);
    });

    it('should support disabled rate limiter', () => {
      const disabledLimiter = new RateLimiter({ enabled: false, maxRequests: 1, windowMs: 1000 });

      // Should allow unlimited requests when disabled
      for (let i = 0; i < 100; i++) {
        const result = disabledLimiter.checkLimit('key');
        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(1); // Shows original maxRequests
      }
    });

    it('should have default rate limit of 100 requests per minute', () => {
      expect(DEFAULT_RATE_LIMIT.maxRequests).toBe(100);
      expect(DEFAULT_RATE_LIMIT.windowMs).toBe(60000);
      expect(DEFAULT_RATE_LIMIT.enabled).toBe(true);
    });
  });

  describe('Factory Function', () => {
    it('should create rate limiter with factory', () => {
      const limiter = createRateLimiter({ maxRequests: 10, windowMs: 5000 });
      expect(limiter).toBeInstanceOf(RateLimiter);
    });

    it('should create rate limiter with default config', () => {
      const limiter = createRateLimiter();
      expect(limiter).toBeInstanceOf(RateLimiter);
    });
  });

  describe('Common Rate Limiters (S016-003)', () => {
    it('should provide strict rate limiter', () => {
      const strict = CommonRateLimiters.strict();
      expect(strict).toBeInstanceOf(RateLimiter);

      // Strict: 10 requests per minute
      for (let i = 0; i < 10; i++) {
        expect(strict.checkLimit('test').allowed).toBe(true);
      }
      expect(strict.checkLimit('test').allowed).toBe(false);
    });

    it('should provide lenient rate limiter', () => {
      const lenient = CommonRateLimiters.lenient();
      expect(lenient).toBeInstanceOf(RateLimiter);

      // Lenient: 1000 requests per minute
      for (let i = 0; i < 100; i++) {
        expect(lenient.checkLimit('test').allowed).toBe(true);
      }
    });

    it('should provide API rate limiter', () => {
      const api = CommonRateLimiters.api();
      expect(api).toBeInstanceOf(RateLimiter);

      // API: 60 requests per minute
      for (let i = 0; i < 60; i++) {
        expect(api.checkLimit('test').allowed).toBe(true);
      }
      expect(api.checkLimit('test').allowed).toBe(false);
    });

    it('should provide per-second rate limiter', () => {
      const perSecond = CommonRateLimiters.perSecond();
      expect(perSecond).toBeInstanceOf(RateLimiter);

      // Per second: 5 requests per second
      for (let i = 0; i < 5; i++) {
        expect(perSecond.checkLimit('test').allowed).toBe(true);
      }
      expect(perSecond.checkLimit('test').allowed).toBe(false);
    });

    it('should provide disabled rate limiter', () => {
      const disabled = CommonRateLimiters.disabled();
      expect(disabled).toBeInstanceOf(RateLimiter);

      // Disabled: always allows
      for (let i = 0; i < 100; i++) {
        expect(disabled.checkLimit('test').allowed).toBe(true);
      }
    });
  });

  describe('Statistics', () => {
    it('should get current count for a key', () => {
      limiter.checkLimit('user-1');
      limiter.checkLimit('user-1');
      limiter.checkLimit('user-1');

      expect(limiter.getCount('user-1')).toBe(3);
    });

    it('should return 0 for non-existent key', () => {
      expect(limiter.getCount('non-existent')).toBe(0);
    });

    it('should track number of keys', () => {
      expect(limiter.getKeyCount()).toBe(0);

      limiter.checkLimit('user-1');
      expect(limiter.getKeyCount()).toBe(1);

      limiter.checkLimit('user-2');
      expect(limiter.getKeyCount()).toBe(2);

      limiter.reset('user-1');
      expect(limiter.getKeyCount()).toBe(1); // Only user-2 remains

      limiter.clear();
      expect(limiter.getKeyCount()).toBe(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle rapid requests', () => {
      const results: RateLimitResult[] = [];

      // Make 10 requests rapidly
      for (let i = 0; i < 10; i++) {
        results.push(limiter.checkLimit('rapid'));
      }

      const allowed = results.filter(r => r.allowed).length;
      expect(allowed).toBe(5); // Only first 5 should be allowed
    });

    it('should handle empty string keys', () => {
      const result = limiter.checkLimit('');
      expect(result.allowed).toBe(true);
    });

    it('should handle special characters in keys', () => {
      const result = limiter.checkLimit('user@example.com');
      expect(result.allowed).toBe(true);
    });

    it('should handle concurrent keys with same prefix', () => {
      const limiter = new RateLimiter({ maxRequests: 1, windowMs: 1000, enabled: true });

      expect(limiter.checkLimit('user:1').allowed).toBe(true);
      expect(limiter.checkLimit('user:11').allowed).toBe(true);
      expect(limiter.checkLimit('user:111').allowed).toBe(true);

      // Each key is tracked independently
      expect(limiter.getKeyCount()).toBe(3);
    });
  });

  describe('Reset Time', () => {
    it('should provide reset time for blocked requests', () => {
      const key = 'user-1';
      const limiter = new RateLimiter({ maxRequests: 1, windowMs: 1000, enabled: true });

      limiter.checkLimit(key);
      const blocked = limiter.checkLimit(key);

      expect(blocked.allowed).toBe(false);
      expect(blocked.resetTime).toBeGreaterThan(Date.now());
      expect(blocked.retryAfter).toBeGreaterThan(0);
      expect(blocked.retryAfter).toBeLessThanOrEqual(1000);
    });
  });
});
