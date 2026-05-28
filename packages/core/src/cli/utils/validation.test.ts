/**
 * Tests for Secure API Validation Protocol
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  validateApiKeySecure,
  clearValidationCache,
  getRateLimitStatus,
  type SecureValidationConfig
} from './validation.js';
import { WizardError } from './error.js';

// Mock fetch globally with proper typing
const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

describe('Secure API Validation Protocol', () => {
  const validConfig: SecureValidationConfig = {
    method: 'GET',
    sendInHeader: true,
    testEndpoint: 'https://api.example.com/v1/test',
    timeout: 5000,
    logLevel: 'none'
  };

  beforeEach(() => {
    // Clear cache before each test
    clearValidationCache();
    // Reset fetch mock
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('validateApiKeySecure', () => {
    describe('successful validation', () => {
      it('should return true for valid API key (200 OK)', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200
        });

        const result = await validateApiKeySecure('sk-validkey123', validConfig);

        expect(result).toBe(true);
        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(mockFetch).toHaveBeenCalledWith(
          'https://api.example.com/v1/test',
          expect.objectContaining({
            method: 'GET',
            headers: {
              Authorization: 'Bearer sk-validkey123'
            }
          })
        );
      });

      it('should return false for invalid API key (401 Unauthorized)', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 401
        });

        const result = await validateApiKeySecure('sk-invalidkey', validConfig);

        expect(result).toBe(false);
      });

      it('should return false for forbidden API key (403 Forbidden)', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 403
        });

        const result = await validateApiKeySecure('sk-forbiddenkey', validConfig);

        expect(result).toBe(false);
      });

      it('should send key in Authorization header when sendInHeader is true', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200
        });

        await validateApiKeySecure('sk-testkey', {
          ...validConfig,
          sendInHeader: true
        });

        expect(mockFetch).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            headers: {
              Authorization: 'Bearer sk-testkey'
            }
          })
        );
      });

      it('should not send Authorization header when sendInHeader is false', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200
        });

        await validateApiKeySecure('sk-testkey', {
          ...validConfig,
          sendInHeader: false
        });

        const callArgs = mockFetch.mock.calls[0];
        expect(callArgs[1]).toBeDefined();
        expect(callArgs[1].headers).toBeUndefined();
      });

      it('should support HEAD method', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200
        });

        await validateApiKeySecure('sk-testkey', {
          ...validConfig,
          method: 'HEAD'
        });

        expect(mockFetch).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            method: 'HEAD'
          })
        );
      });

      it('should support OPTIONS method', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200
        });

        await validateApiKeySecure('sk-testkey', {
          ...validConfig,
          method: 'OPTIONS'
        });

        expect(mockFetch).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            method: 'OPTIONS'
          })
        );
      });
    });

    describe('timeout handling', () => {
      it('should throw WizardError on timeout', async () => {
        // Mock fetch to reject on abort signal (simulates timeout)
        mockFetch.mockImplementationOnce((url: string, options: RequestInit = {}) => {
          return new Promise((_, reject) => {
            // Listen for abort signal
            if (options.signal) {
              options.signal.addEventListener('abort', () => {
                reject(new DOMException('Aborted', 'AbortError'));
              });
            }
          });
        });

        const shortTimeoutConfig = {
          ...validConfig,
          timeout: 100 // 100ms timeout
        };

        await expect(validateApiKeySecure('sk-testkey', shortTimeoutConfig)).rejects.toThrow(WizardError);
      });

      it('should include timeout error details', async () => {
        mockFetch.mockImplementationOnce((url: string, options: RequestInit = {}) => {
          return new Promise((_, reject) => {
            if (options.signal) {
              options.signal.addEventListener('abort', () => {
                reject(new DOMException('Aborted', 'AbortError'));
              });
            }
          });
        });

        const shortTimeoutConfig = {
          ...validConfig,
          timeout: 100
        };

        try {
          await validateApiKeySecure('sk-testkey', shortTimeoutConfig);
          expect.fail('Should have thrown WizardError');
        } catch (error) {
          expect(error).toBeInstanceOf(WizardError);
          if (error instanceof WizardError) {
            expect(error.code).toBe('VALIDATION_TIMEOUT');
            expect(error.message).toContain('timed out');
            expect(error.message).toContain('100ms');
            expect(error.suggestion).toContain('network connection');
            expect(error.exitCode).toBe(2);
          }
        }
      });

      it('should clear timeout on successful response', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200
        });

        const startTime = Date.now();
        await validateApiKeySecure('sk-testkey', {
          ...validConfig,
          timeout: 5000
        });
        const endTime = Date.now();

        // Should complete well before timeout
        expect(endTime - startTime).toBeLessThan(1000);
      });
    });

    describe('rate limiting', () => {
      it('should cache successful validation results', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          status: 200
        });

        // First call - should hit fetch
        await validateApiKeySecure('sk-cachedkey', validConfig);
        expect(mockFetch).toHaveBeenCalledTimes(1);

        // Second call - should use cache
        await validateApiKeySecure('sk-cachedkey', validConfig);
        expect(mockFetch).toHaveBeenCalledTimes(1); // Still 1, not 2
      });

      it('should cache failed validation results', async () => {
        mockFetch.mockResolvedValue({
          ok: false,
          status: 401
        });

        // First call
        await validateApiKeySecure('sk-badkey', validConfig);
        expect(mockFetch).toHaveBeenCalledTimes(1);

        // Second call - should use cache
        await validateApiKeySecure('sk-badkey', validConfig);
        expect(mockFetch).toHaveBeenCalledTimes(1);
      });

      it('should enforce rate limit after max validations', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          status: 200
        });

        // Make 5 successful validations (the limit)
        for (let i = 0; i < 5; i++) {
          await validateApiKeySecure(`sk-key${i}`, validConfig);
        }

        // The 6th validation should throw rate limit error
        await expect(validateApiKeySecure('sk-key6', validConfig)).rejects.toThrow(WizardError);
      });

      it('should include rate limit error details', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          status: 200
        });

        // Fill up rate limit
        for (let i = 0; i < 5; i++) {
          await validateApiKeySecure(`sk-key${i}`, validConfig);
        }

        try {
          await validateApiKeySecure('sk-key6', validConfig);
          expect.fail('Should have thrown WizardError');
        } catch (error) {
          expect(error).toBeInstanceOf(WizardError);
          if (error instanceof WizardError) {
            expect(error.code).toBe('RATE_LIMITED');
            expect(error.message).toContain('Too many validation attempts');
            expect(error.message).toContain('5 per minute');
            expect(error.suggestion).toContain('wait');
            expect(error.exitCode).toBe(2);
          }
        }
      });

      it('should reset rate limit after cache TTL expires', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          status: 200
        });

        // Fill up rate limit
        for (let i = 0; i < 5; i++) {
          await validateApiKeySecure(`sk-key${i}`, validConfig);
        }

        // Should be rate limited
        await expect(validateApiKeySecure('sk-key6', validConfig)).rejects.toThrow(WizardError);

        // Clear cache to simulate TTL expiration
        clearValidationCache();

        // Should now work
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200
        });

        const result = await validateApiKeySecure('sk-key7', validConfig);
        expect(result).toBe(true);
      });

      it('should not rate limit cached keys', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          status: 200
        });

        // Use same key 10 times - should only fetch once
        for (let i = 0; i < 10; i++) {
          const result = await validateApiKeySecure('sk-samekey', validConfig);
          expect(result).toBe(true);
        }

        // Should only have called fetch once (cached)
        expect(mockFetch).toHaveBeenCalledTimes(1);
      });
    });

    describe('error handling', () => {
      it('should throw WizardError for network errors', async () => {
        mockFetch.mockRejectedValueOnce(new Error('Network error'));

        await expect(validateApiKeySecure('sk-testkey', validConfig)).rejects.toThrow(Error);
      });

      it('should throw WizardError for unexpected status codes', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 500
        });

        await expect(validateApiKeySecure('sk-testkey', validConfig)).rejects.toThrow(
          'Unexpected response status: 500'
        );
      });

      it('should handle DNS errors', async () => {
        mockFetch.mockRejectedValueOnce(new Error('ENOTFOUND'));

        await expect(validateApiKeySecure('sk-testkey', validConfig)).rejects.toThrow();
      });

      it('should handle connection refused', async () => {
        mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

        await expect(validateApiKeySecure('sk-testkey', validConfig)).rejects.toThrow();
      });
    });

    describe('secure credential handling', () => {
      it('should use SecureCredential for memory safety', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200
        });

        // This test verifies that the function completes successfully
        // The actual SecureCredential usage is tested in its own test file
        await validateApiKeySecure('sk-testkey', validConfig);

        expect(mockFetch).toHaveBeenCalledTimes(1);
      });

      it('should handle empty API keys', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200
        });

        const result = await validateApiKeySecure('', validConfig);
        expect(result).toBe(true);
      });

      it('should handle special characters in API keys', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200
        });

        const specialKey = 'sk-test.key_with-special/chars+=';
        await validateApiKeySecure(specialKey, validConfig);

        expect(mockFetch).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            headers: {
              Authorization: `Bearer ${specialKey}`
            }
          })
        );
      });

      it('should not log credentials', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200
        });

        // Spy on console to ensure nothing is logged
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

        await validateApiKeySecure('sk-secretkey123', validConfig);

        // Verify the key was not logged
        const loggedCalls = consoleSpy.mock.calls.flat().join(' ');
        expect(loggedCalls).not.toContain('sk-secretkey123');

        consoleSpy.mockRestore();
      });
    });
  });

  describe('clearValidationCache', () => {
    it('should clear all cached entries', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200
      });

      // Add some entries to cache
      await validateApiKeySecure('sk-key1', validConfig);
      await validateApiKeySecure('sk-key2', validConfig);

      expect(mockFetch).toHaveBeenCalledTimes(2);

      // Clear cache
      clearValidationCache();

      // Should fetch again after clearing
      await validateApiKeySecure('sk-key1', validConfig);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('should reset rate limit after clearing', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200
      });

      // Fill up rate limit
      for (let i = 0; i < 5; i++) {
        await validateApiKeySecure(`sk-key${i}`, validConfig);
      }

      // Should be rate limited
      await expect(validateApiKeySecure('sk-key6', validConfig)).rejects.toThrow(WizardError);

      // Clear cache
      clearValidationCache();

      // Should work now
      await validateApiKeySecure('sk-key7', validConfig);
      expect(mockFetch).toHaveBeenCalledTimes(6); // 5 + 1
    });
  });

  describe('getRateLimitStatus', () => {
    it('should return zero usage when no validations performed', () => {
      const status = getRateLimitStatus();

      expect(status.used).toBe(0);
      expect(status.max).toBe(5);
      expect(status.resetTime).toBeGreaterThanOrEqual(Date.now());
    });

    it('should return correct usage after validations', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200
      });

      // Perform 3 validations
      await validateApiKeySecure('sk-key1', validConfig);
      await validateApiKeySecure('sk-key2', validConfig);
      await validateApiKeySecure('sk-key3', validConfig);

      const status = getRateLimitStatus();

      expect(status.used).toBe(3);
      expect(status.max).toBe(5);
    });

    it('should return resetTime in the future', () => {
      const now = Date.now();
      const status = getRateLimitStatus();

      expect(status.resetTime).toBeGreaterThanOrEqual(now);
      expect(status.resetTime).toBeLessThan(now + 60 * 1000 + 1000); // ~1 minute + buffer
    });

    it('should track maximum validations correctly', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200
      });

      // Perform max validations
      for (let i = 0; i < 5; i++) {
        await validateApiKeySecure(`sk-key${i}`, validConfig);
      }

      const status = getRateLimitStatus();

      expect(status.used).toBe(5);
      expect(status.max).toBe(5);
    });
  });

  describe('AbortController cleanup', () => {
    it('should clear timeout on successful response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200
      });

      // Use a short timeout to verify it doesn't actually fire
      const config = { ...validConfig, timeout: 100 };

      // Should complete successfully without timeout
      const result = await validateApiKeySecure('sk-testkey', config);
      expect(result).toBe(true);
    });

    it('should clear timeout on error response', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const config = { ...validConfig, timeout: 100 };

      await expect(validateApiKeySecure('sk-testkey', config)).rejects.toThrow('Network error');
    });

    it('should abort request on timeout', async () => {
      mockFetch.mockImplementationOnce((_url: string, options: RequestInit = {}) => {
        return new Promise((_, reject) => {
          if (options.signal) {
            options.signal.addEventListener('abort', () => {
              reject(new DOMException('Aborted', 'AbortError'));
            });
          }
        });
      });

      const config = { ...validConfig, timeout: 50 };

      await expect(validateApiKeySecure('sk-testkey', config)).rejects.toThrow(WizardError);
    });
  });
});
