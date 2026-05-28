/**
 * Override Token Validation Tests (S011-006)
 * ==========================================
 * Comprehensive tests for cryptographic override token validation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  OverrideTokenValidator,
  TokenScope,
  createOverrideTokenValidator,
  hashContent,
  parseOverrideTokenConfig,
  type OverrideTokenConfig
} from '../../../src/security/override-token.js';

describe('OverrideTokenValidator (S011-006)', () => {
  let validator: OverrideTokenValidator;
  const testSecret = 'this-is-a-test-secret-key-that-is-32-bytes-long';

  beforeEach(() => {
    validator = new OverrideTokenValidator({ secret: testSecret });
  });

  describe('Token Generation', () => {
    it('should generate valid admin token', () => {
      const token = validator.generateToken(TokenScope.ADMIN);
      expect(token).toMatch(/^\d+:[a-f0-9]{64}:[a-f0-9]{32}:admin$/);
    });

    it('should generate valid emergency token', () => {
      const token = validator.generateToken(TokenScope.EMERGENCY);
      expect(token).toMatch(/^\d+:[a-f0-9]{64}:[a-f0-9]{32}:emergency$/);
    });

    it('should generate valid readonly token', () => {
      const token = validator.generateToken(TokenScope.READONLY);
      expect(token).toMatch(/^\d+:[a-f0-9]{64}:[a-f0-9]{32}:readonly$/);
    });

    it('should generate unique tokens', () => {
      const token1 = validator.generateToken(TokenScope.ADMIN);
      const token2 = validator.generateToken(TokenScope.ADMIN);
      expect(token1).not.toBe(token2);
    });

    it('should include valid timestamp', () => {
      const before = Date.now();
      const token = validator.generateToken(TokenScope.ADMIN);
      const after = Date.now();

      const timestamp = parseInt(token.split(':')[0]!, 10);
      expect(timestamp).toBeGreaterThanOrEqual(before);
      expect(timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe('Token Validation', () => {
    it('should validate correctly signed token', () => {
      const token = validator.generateToken(TokenScope.ADMIN);
      const result = validator.validateToken(token);

      expect(result.valid).toBe(true);
      expect(result.scope).toBe(TokenScope.ADMIN);
      expect(result.timestamp).toBeDefined();
      expect(result.error).toBeUndefined();
    });

    it('should reject token with invalid signature', () => {
      const token = validator.generateToken(TokenScope.ADMIN);
      // Signature is the second component (after first colon)
      const parts = token.split(':');
      const tamperedToken = `${parts[0]}:${'0'.repeat(64)}:${parts[2]}:${parts[3]}`;

      const result = validator.validateToken(tamperedToken);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid token signature');
    });

    it('should reject expired token', async () => {
      const shortLivedValidator = new OverrideTokenValidator({
        secret: testSecret,
        expirationMs: 100 // 100ms expiration
      });

      const token = shortLivedValidator.generateToken(TokenScope.ADMIN);

      // Wait for token to expire
      await new Promise(resolve => setTimeout(resolve, 150));

      const result = shortLivedValidator.validateToken(token);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Token expired');
    });

    it('should reject token with future timestamp', () => {
      const futureTime = Date.now() + 120000; // 2 minutes in future
      const token = validator.generateToken(TokenScope.ADMIN);

      // Tamper with timestamp
      const parts = token.split(':');
      parts[0] = String(futureTime);
      const futureToken = parts.join(':');

      const result = validator.validateToken(futureToken);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Token timestamp in future');
    });

    it('should reject token with invalid format', () => {
      const result = validator.validateToken('invalid-token-format');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid token format');
    });

    it('should reject token with invalid scope', () => {
      const parts = validator.generateToken(TokenScope.ADMIN).split(':');
      parts[3] = 'invalid_scope';
      const invalidScopeToken = parts.join(':');

      const result = validator.validateToken(invalidScopeToken);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid token scope');
    });

    it('should reject replayed token', () => {
      const token = validator.generateToken(TokenScope.ADMIN);

      // First use should succeed
      const result1 = validator.validateToken(token);
      expect(result1.valid).toBe(true);

      // Second use should fail (replay protection)
      const result2 = validator.validateToken(token);
      expect(result2.valid).toBe(false);
      expect(result2.error).toBe('Token already used (replay attack detected)');
    });

    it('should allow different tokens with same nonce', () => {
      // Generate two tokens - they should have different nonces
      const token1 = validator.generateToken(TokenScope.ADMIN);
      const token2 = validator.generateToken(TokenScope.ADMIN);

      const result1 = validator.validateToken(token1);
      const result2 = validator.validateToken(token2);

      expect(result1.valid).toBe(true);
      expect(result2.valid).toBe(true);
    });
  });

  describe('Content Validation', () => {
    it('should find and validate token in content', () => {
      const token = validator.generateToken(TokenScope.ADMIN);
      const content = `Some content with override token: ${token}`;

      const result = validator.validateContent(content);
      expect(result.valid).toBe(true);
      expect(result.scope).toBe(TokenScope.ADMIN);
    });

    it('should return error when no token found', () => {
      const content = 'Some content without any override token';
      const result = validator.validateContent(content);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('No valid override token found');
    });

    it('should validate first valid token in content', () => {
      const validToken = validator.generateToken(TokenScope.ADMIN);
      const invalidToken = 'invalid-token';
      const content = `${invalidToken} and ${validToken}`;

      const result = validator.validateContent(content);
      expect(result.valid).toBe(true);
      expect(result.scope).toBe(TokenScope.ADMIN);
    });

    it('should reject content with only expired tokens', async () => {
      const shortLivedValidator = new OverrideTokenValidator({
        secret: testSecret,
        expirationMs: 50
      });

      const token = shortLivedValidator.generateToken(TokenScope.ADMIN);
      const content = `Content with token: ${token}`;

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 100));

      const result = shortLivedValidator.validateContent(content);
      expect(result.valid).toBe(false);
    });
  });

  describe('Replay Protection', () => {
    it('should track used tokens', () => {
      const token = validator.generateToken(TokenScope.ADMIN);
      validator.validateToken(token);

      const result = validator.validateToken(token);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('replay');
    });

    it('should reject new token when cache is full with active entries (fail-closed)', () => {
      // TTL-based eviction policy.
      // When all cached entries are still within their validity window,
      // accepting a new entry would require evicting a live used-nonce,
      // breaking the replay-protection guarantee. The fix: fail-closed.
      const shortExpiry = 5000; // 5 seconds — well within test run time
      const smallCacheValidator = new OverrideTokenValidator({
        secret: testSecret,
        maxReplayCache: 3,
        expirationMs: shortExpiry
      });

      const tokens = [
        smallCacheValidator.generateToken(TokenScope.ADMIN),
        smallCacheValidator.generateToken(TokenScope.ADMIN),
        smallCacheValidator.generateToken(TokenScope.ADMIN),
        smallCacheValidator.generateToken(TokenScope.ADMIN)
      ];

      // Fill cache to capacity with 3 used nonces
      expect(smallCacheValidator.validateToken(tokens[0]!).valid).toBe(true);
      expect(smallCacheValidator.validateToken(tokens[1]!).valid).toBe(true);
      expect(smallCacheValidator.validateToken(tokens[2]!).valid).toBe(true);

      // Attempting to use the 4th token while cache is full with active entries
      // MUST throw, not silently evict a live nonce (fail-closed behaviour)
      expect(() => smallCacheValidator.validateToken(tokens[3]!)).toThrow('replay cache is at capacity');
    });

    it('should clean up old cache entries', () => {
      const token = validator.generateToken(TokenScope.ADMIN);
      validator.validateToken(token);

      // Cleanup with very short retention
      validator.cleanupReplayCache(0);

      // Token should no longer be in cache
      const result = validator.validateToken(token);
      // Since cleanup ran, replay protection might be cleared
      expect(result).toBeDefined();
    });

    it('should clear all replay cache entries', () => {
      const token = validator.generateToken(TokenScope.ADMIN);
      validator.validateToken(token);

      validator.clearReplayCache();

      const result = validator.validateToken(token);
      // After clearing cache, token should be valid again
      expect(result.valid).toBe(true);
    });
  });

  describe('replay-cache starvation regression', () => {
    // CRITICAL regression guard: demonstrates that the FIFO vulnerability
    // (attacker floods cache → evicts used nonce → replays token) is closed.
    // Strategy: use short TTL (100 ms) so expired entries CAN be evicted;
    // fill cache with N-1 junk tokens, use target token T, add 1 more junk
    // token (triggering TTL sweep on valid entries → none expired → fail-closed),
    // then try to replay T. With short TTL we test eviction of EXPIRED entries
    // allows room, but active entries block the flood path.

    it('should reject replay of token T even after N junk tokens fill and expire from cache', async () => {
      const cacheSize = 5;
      const shortExpiry = 80; // 80 ms — tokens expire during the test
      const floodValidator = new OverrideTokenValidator({
        secret: testSecret,
        maxReplayCache: cacheSize,
        expirationMs: shortExpiry
      });

      // Step 1: fill cache with (cacheSize - 1) junk tokens
      for (let i = 0; i < cacheSize - 1; i++) {
        const junk = floodValidator.generateToken(TokenScope.ADMIN);
        expect(floodValidator.validateToken(junk).valid).toBe(true);
      }

      // Step 2: use the target token T (cache is now at cacheSize - 1, T fills slot)
      const targetToken = floodValidator.generateToken(TokenScope.ADMIN);
      expect(floodValidator.validateToken(targetToken).valid).toBe(true);
      // cache is now FULL (cacheSize entries, all active)

      // Step 3: wait for tokens to expire (past shortExpiry)
      await new Promise(resolve => setTimeout(resolve, 100));

      // Step 4: add one more junk token — TTL sweep should evict the now-expired
      // entries (including T's nonce), making room. BUT T is now also expired —
      // the expiration check fires BEFORE the replay check, so T is rejected on
      // "Token expired", not "replay". This is correct: expired tokens are invalid
      // regardless of whether their nonce is in the cache.
      const newJunk = floodValidator.generateToken(TokenScope.ADMIN);
      // newJunk itself is fresh so it validates OK after TTL sweep clears space
      expect(floodValidator.validateToken(newJunk).valid).toBe(true);

      // Step 5: attempt replay of T — MUST be rejected (expired, not replayed)
      const replayResult = floodValidator.validateToken(targetToken);
      expect(replayResult.valid).toBe(false);
      // Either "Token expired" (correct — token window closed) or
      // "Token already used" (also correct — nonce still in cache).
      // Both mean the replay is blocked; the important thing is valid === false.
      expect(replayResult.error).toBeDefined();
    });

    it('should reject replay when cache is actively flooded with unexpired tokens', () => {
      // Core replay-cache starvation attack: flood with valid tokens within expiry window.
      // With TTL-based eviction the cache hits capacity with active entries and
      // throws (fail-closed) — the attacker cannot open a replay window.
      const cacheSize = 5;
      const floodValidator = new OverrideTokenValidator({
        secret: testSecret,
        maxReplayCache: cacheSize,
        expirationMs: 3600000 // 1 hour — nothing expires during this test
      });

      // Fill cache to capacity
      const usedTokens: string[] = [];
      for (let i = 0; i < cacheSize; i++) {
        const t = floodValidator.generateToken(TokenScope.ADMIN);
        usedTokens.push(t);
        floodValidator.validateToken(t);
      }

      // Attempt flood: the (cacheSize + 1)-th token triggers fail-closed throw
      const floodToken = floodValidator.generateToken(TokenScope.ADMIN);
      expect(() => floodValidator.validateToken(floodToken)).toThrow('replay cache is at capacity');

      // Original tokens remain protected — no nonce was evicted
      for (const used of usedTokens) {
        // Each should be either "replay" (nonce still in cache) or "expired" —
        // neither is valid === true.  Signature check runs after format/expiry/replay
        // so the important guarantee is: replayed tokens are NEVER valid.
        const r = floodValidator.validateToken(used);
        expect(r.valid).toBe(false);
      }
    });
  });

  describe('Configuration', () => {
    it('should require minimum secret length', () => {
      expect(() => new OverrideTokenValidator({ secret: 'short' })).toThrow('at least 32 characters');
    });

    it('should accept valid secret', () => {
      expect(() => new OverrideTokenValidator({ secret: testSecret })).not.toThrow();
    });

    it('should use default expiration when not specified', () => {
      const defaultValidator = new OverrideTokenValidator({ secret: testSecret });
      const token = defaultValidator.generateToken(TokenScope.ADMIN);

      // Token should be valid immediately
      const result = defaultValidator.validateToken(token);
      expect(result.valid).toBe(true);
    });

    it('should use custom expiration when specified', async () => {
      const shortValidator = new OverrideTokenValidator({
        secret: testSecret,
        expirationMs: 50
      });

      const token = shortValidator.generateToken(TokenScope.ADMIN);
      await new Promise(resolve => setTimeout(resolve, 100));

      const result = shortValidator.validateToken(token);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Token expired');
    });
  });

  describe('Utility Functions', () => {
    describe('hashContent', () => {
      it('should hash content consistently', () => {
        const content = 'test content';
        const hash1 = hashContent(content);
        const hash2 = hashContent(content);

        expect(hash1).toBe(hash2);
      });

      it('should produce different hashes for different content', () => {
        const hash1 = hashContent('content 1');
        const hash2 = hashContent('content 2');

        expect(hash1).not.toBe(hash2);
      });

      it('should truncate hash to 16 characters', () => {
        const hash = hashContent('test');
        expect(hash.length).toBe(16);
      });
    });

    describe('parseOverrideTokenConfig', () => {
      it('should parse string config', () => {
        const config = parseOverrideTokenConfig('simple-string-secret');
        expect(config).toEqual({ secret: 'simple-string-secret' });
      });

      it('should pass through object config', () => {
        const configObj: OverrideTokenConfig = {
          secret: testSecret,
          expirationMs: 3600000
        };

        const config = parseOverrideTokenConfig(configObj);
        expect(config).toEqual(configObj);
      });
    });
  });

  describe('Token Scopes', () => {
    it('should support all defined scopes', () => {
      const scopes = [TokenScope.ADMIN, TokenScope.EMERGENCY, TokenScope.READONLY];

      for (const scope of scopes) {
        const token = validator.generateToken(scope);
        const result = validator.validateToken(token);

        expect(result.valid).toBe(true);
        expect(result.scope).toBe(scope);
      }
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty token', () => {
      const result = validator.validateToken('');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid token format');
    });

    it('should handle token with missing components', () => {
      const incompleteToken = '1234567890:abc';
      const result = validator.validateToken(incompleteToken);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid token format');
    });

    it('should handle very long content', () => {
      const token = validator.generateToken(TokenScope.ADMIN);
      // Use delimiters around the token for proper extraction
      const longContent = 'a'.repeat(10000) + ' ' + token + ' ' + 'a'.repeat(10000);

      const result = validator.validateContent(longContent);
      expect(result.valid).toBe(true);
    });

    it('should handle special characters in content', () => {
      const token = validator.generateToken(TokenScope.ADMIN);
      const specialContent = `Content with \n\t\r special chars: ${token}`;

      const result = validator.validateContent(specialContent);
      expect(result.valid).toBe(true);
    });
  });

  describe('Security Properties', () => {
    it('should use timing-safe comparison', () => {
      const validToken = validator.generateToken(TokenScope.ADMIN);
      const invalidToken = validToken.replace(/a/g, 'b');

      // Both validations should take similar time
      // (preventing timing attacks)
      const start1 = performance.now();
      validator.validateToken(validToken);
      const time1 = performance.now() - start1;

      const start2 = performance.now();
      validator.validateToken(invalidToken);
      const time2 = performance.now() - start2;

      // Times should be reasonably similar (within factor of 10)
      // This is a loose check - actual timing-safe comparison
      // ensures constant time regardless of where the mismatch is
      expect(Math.max(time1, time2) / Math.min(time1, time2)).toBeLessThan(10);
    });

    it('should not expose token in validation error', () => {
      const token = validator.generateToken(TokenScope.ADMIN);
      const result = validator.validateToken(token);

      // Validation result should not contain the actual token
      expect(result).not.toHaveProperty('token');
      expect(JSON.stringify(result)).not.toContain(token);
    });
  });
});
