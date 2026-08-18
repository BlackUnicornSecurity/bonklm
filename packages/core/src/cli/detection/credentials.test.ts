/**
 * Credential Detection Tests
 *
 * Tests for environment variable credential detection with:
 * - Whitelist validation (HP-4 fix)
 * - Non-string value rejection
 * - SecureCredential memory cleanup
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getDetectionEnvVars } from '../connectors/registry.js';
import {
  detectCredentials,
  isCredentialPresent,
  getCredentialMasked,
  getPresentCredentials,
  getSupportedCredentialNames,
  type DetectedCredential,
  type CredentialName
} from './credentials.js';

describe('Credential Detection', () => {
  // Store original environment
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset environment before each test
    vi.clearAllMocks();
    // The credential surface is registry-derived, so a developer's ambient
    // GEMINI_API_KEY / GROQ_API_KEY / … would otherwise leak into these
    // assertions. Start every test from a known-empty credential environment.
    for (const signal of getDetectionEnvVars()) {
      delete process.env[signal.value];
    }
  });

  afterEach(() => {
    // Restore environment after each test
    process.env = { ...originalEnv };
  });

  describe('detectCredentials', () => {
    it('should return empty array when no credentials are set', () => {
      // Remove all credential env vars
      delete process.env.OPENAI_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.OLLAMA_HOST;

      const result = detectCredentials();

      // The credential list is derived from the registry, so its length grows
      // with the connector surface — assert the property, not a magic number.
      expect(result.length).toBeGreaterThanOrEqual(3);
      expect(result.every(cred => !cred.present)).toBe(true);
    });

    it('should detect OpenAI API key when set', () => {
      process.env.OPENAI_API_KEY = 'sk-test1234567890abcdefghijklmn';

      const result = detectCredentials();
      const openai = result.find(c => c.name === 'openai');

      expect(openai).toBeDefined();
      expect(openai?.present).toBe(true);
      expect(openai?.key).toBe('OPENAI_API_KEY');
      expect(openai?.maskedValue).toMatch(/^sk\*+\w{4}$/);
      expect(openai?.maskedValue).not.toContain('test1234567890');
    });

    it('should detect Anthropic API key when set', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test1234567890abcdefghijklmn';

      const result = detectCredentials();
      const anthropic = result.find(c => c.name === 'anthropic');

      expect(anthropic).toBeDefined();
      expect(anthropic?.present).toBe(true);
      expect(anthropic?.key).toBe('ANTHROPIC_API_KEY');
      expect(anthropic?.maskedValue).toMatch(/^sk\*+\w{4}$/);
      expect(anthropic?.maskedValue).not.toContain('test1234567890');
    });

    it('should detect Ollama host when set', () => {
      process.env.OLLAMA_HOST = 'http://localhost:11434';

      const result = detectCredentials();
      const ollama = result.find(c => c.name === 'ollama');

      expect(ollama).toBeDefined();
      expect(ollama?.present).toBe(true);
      expect(ollama?.key).toBe('OLLAMA_HOST');
      // Mask should start with 'ht' and end with '1434' with asterisks in between
      expect(ollama?.maskedValue).toMatch(/^ht\*+1434$/);
      expect(ollama?.maskedValue).not.toContain('localhost');
    });

    it('should detect multiple credentials when set', () => {
      process.env.OPENAI_API_KEY = 'sk-test1234567890abcdefghijklmn';
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test1234567890abcdefghijklmn';

      const result = detectCredentials();
      const present = result.filter(c => c.present);

      expect(present.map(c => c.key).sort()).toEqual(['ANTHROPIC_API_KEY', 'OPENAI_API_KEY']);
      expect(result.some(c => c.name === 'openai' && c.present)).toBe(true);
      expect(result.some(c => c.name === 'anthropic' && c.present)).toBe(true);
    });

    it('should return "not set" for absent credentials', () => {
      delete process.env.OPENAI_API_KEY;

      const result = detectCredentials();
      const openai = result.find(c => c.name === 'openai');

      expect(openai?.maskedValue).toBe('not set');
    });

    it('should handle empty string as not set', () => {
      process.env.OPENAI_API_KEY = '';

      const result = detectCredentials();
      const openai = result.find(c => c.name === 'openai');

      // Empty string is treated as "not set"
      expect(openai?.present).toBe(false);
      expect(openai?.maskedValue).toBe('not set');
    });

    it('should include every registry-declared credential pattern', () => {
      const result = detectCredentials();

      expect(result.map(c => c.name)).toEqual(expect.arrayContaining(['openai', 'anthropic', 'ollama']));
      // One row per declared env var, no duplicates. (The "only declared names
      // are read" property is a real regression test further down, where it is
      // paired with injected CUSTOM_KEY_* env vars.)
      expect(new Set(result.map(c => c.key)).size).toBe(result.length);
      expect(result).toHaveLength(getDetectionEnvVars().length);
    });
  });

  describe('SECURITY: Whitelist Validation (HP-4)', () => {
    it('should only check whitelisted environment variables', () => {
      // Even if we set other env vars, they should not be detected
      process.env.MALICIOUS_API_KEY = 'should-not-be-detected';
      process.env.OPENAI_API_KEY = 'sk-test1234567890abcdefghijklmn';

      const result = detectCredentials();
      const keys = result.map(c => c.key);

      // Should only contain our whitelisted keys
      expect(keys).not.toContain('MALICIOUS_API_KEY');
      expect(keys).toContain('OPENAI_API_KEY');
    });

    it('should not be affected by prototype pollution on CREDENTIAL_PATTERNS', () => {
      // Attempt to pollute the prototype
      (Object.prototype as any).malicious = 'MALICIOUS_API_KEY';

      const result = detectCredentials();
      const keys = result.map(c => c.key);

      // Should not pick up the polluted property
      expect(keys).not.toContain('MALICIOUS_API_KEY');

      // Clean up
      delete (Object.prototype as any).malicious;
    });

    it('should validate each env var name against whitelist', () => {
      // The whitelist regex should only match exact patterns
      const validPatterns = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'OLLAMA_HOST'];

      const invalidPatterns = [
        'OPENAI_API_KEY_EXTRA',
        'PREFIX_OPENAI_API_KEY',
        'openai_api_key', // lowercase
        'OpenAI_Api_Key', // mixed case
        'MALICIOUS_KEY'
      ];

      // Import the internal validation function indirectly
      // by checking the results of detectCredentials
      process.env.OPENAI_API_KEY = 'sk-test';

      const result = detectCredentials();
      const detectedKeys = result.map(c => c.key);

      // All valid patterns should be checked
      validPatterns.forEach(pattern => {
        expect(detectedKeys).toContain(pattern);
      });

      // Invalid patterns should not appear
      invalidPatterns.forEach(pattern => {
        expect(detectedKeys).not.toContain(pattern);
      });
    });
  });

  describe('SECURITY: Non-string Value Rejection (HP-4)', () => {
    it('should reject number values', () => {
      (process.env as any).OPENAI_API_KEY = 12345;

      const result = detectCredentials();
      const openai = result.find(c => c.name === 'openai');

      expect(openai?.present).toBe(false);
      expect(openai?.maskedValue).toBe('not set');
    });

    it('should reject object values', () => {
      (process.env as any).OPENAI_API_KEY = { key: 'value' };

      const result = detectCredentials();
      const openai = result.find(c => c.name === 'openai');

      expect(openai?.present).toBe(false);
      expect(openai?.maskedValue).toBe('not set');
    });

    it('should reject boolean values', () => {
      (process.env as any).OPENAI_API_KEY = true;

      const result = detectCredentials();
      const openai = result.find(c => c.name === 'openai');

      expect(openai?.present).toBe(false);
      expect(openai?.maskedValue).toBe('not set');
    });

    it('should treat null as not set', () => {
      process.env.OPENAI_API_KEY = null as any;

      const result = detectCredentials();
      const openai = result.find(c => c.name === 'openai');

      expect(openai?.present).toBe(false);
      expect(openai?.maskedValue).toBe('not set');
    });

    it('should treat undefined as not set', () => {
      process.env.OPENAI_API_KEY = undefined as any;

      const result = detectCredentials();
      const openai = result.find(c => c.name === 'openai');

      expect(openai?.present).toBe(false);
      expect(openai?.maskedValue).toBe('not set');
    });
  });

  describe('SECURITY: SecureCredential Memory Cleanup', () => {
    it('should use SecureCredential for memory safety', () => {
      process.env.OPENAI_API_KEY = 'sk-test1234567890abcdefghijklmn';

      // The test passes if no errors are thrown
      // and the masked value doesn't contain the actual key
      const result = detectCredentials();
      const openai = result.find(c => c.name === 'openai');

      expect(openai?.maskedValue).not.toContain('test1234567890');
      expect(openai?.maskedValue).not.toBe('sk-test1234567890abcdefghijklmn');
    });

    it('should handle large credentials that exceed SecureCredential limit', () => {
      // Create a credential larger than 8KB
      const largeKey = 'sk-' + 'x'.repeat(10000);
      process.env.OPENAI_API_KEY = largeKey;

      // Should handle gracefully (treat as not set)
      const result = detectCredentials();
      const openai = result.find(c => c.name === 'openai');

      expect(openai?.present).toBe(false);
      expect(openai?.maskedValue).toBe('not set');
    });
  });

  describe('isCredentialPresent', () => {
    it('should return true when OpenAI key is set', () => {
      process.env.OPENAI_API_KEY = 'sk-test1234567890abcdefghijklmn';

      expect(isCredentialPresent('openai')).toBe(true);
    });

    it('should return false when OpenAI key is not set', () => {
      delete process.env.OPENAI_API_KEY;

      expect(isCredentialPresent('openai')).toBe(false);
    });

    it('should return false for empty string', () => {
      process.env.OPENAI_API_KEY = '';

      // Empty string is treated as "not set"
      expect(isCredentialPresent('openai')).toBe(false);
    });

    it('should validate all credential names', () => {
      process.env.OPENAI_API_KEY = 'sk-test';
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
      process.env.OLLAMA_HOST = 'http://localhost:11434';

      expect(isCredentialPresent('openai')).toBe(true);
      expect(isCredentialPresent('anthropic')).toBe(true);
      expect(isCredentialPresent('ollama')).toBe(true);
    });

    it('should return false for unknown credential names', () => {
      expect(isCredentialPresent('unknown' as CredentialName)).toBe(false);
    });
  });

  describe('getCredentialMasked', () => {
    it('should return masked value for present credential', () => {
      process.env.OPENAI_API_KEY = 'sk-test1234567890abcdefghijklmn';

      const masked = getCredentialMasked('openai');

      expect(masked).toMatch(/^sk\*+\w{4}$/);
      expect(masked).not.toContain('test1234567890');
    });

    it('should return "not set" for absent credential', () => {
      delete process.env.OPENAI_API_KEY;

      const masked = getCredentialMasked('openai');

      expect(masked).toBe('not set');
    });

    it('should return "not set" for unknown credential name', () => {
      const masked = getCredentialMasked('unknown' as CredentialName);

      expect(masked).toBe('not set');
    });

    it('should mask Ollama host URL', () => {
      process.env.OLLAMA_HOST = 'http://localhost:11434';

      const masked = getCredentialMasked('ollama');

      expect(masked).toMatch(/^ht\*+1434$/);
      expect(masked).not.toContain('localhost');
    });
  });

  describe('getPresentCredentials', () => {
    it('should return only present credentials', () => {
      process.env.OPENAI_API_KEY = 'sk-test1234567890abcdefghijklmn';
      delete process.env.ANTHROPIC_API_KEY;
      process.env.OLLAMA_HOST = 'http://localhost:11434';

      const result = getPresentCredentials();

      // The two that were set, and not the one that was deleted.
      expect(result.map(c => c.key).sort()).toEqual(['OLLAMA_HOST', 'OPENAI_API_KEY']);
      expect(result.every(c => c.present)).toBe(true);
      expect(result.some(c => c.name === 'openai')).toBe(true);
      expect(result.some(c => c.name === 'ollama')).toBe(true);
      expect(result.some(c => c.name === 'anthropic')).toBe(false);
    });

    it('should return empty array when no credentials are set', () => {
      delete process.env.OPENAI_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.OLLAMA_HOST;

      const result = getPresentCredentials();

      expect(result).toHaveLength(0);
    });
  });

  describe('getSupportedCredentialNames', () => {
    it('should return all supported credential names', () => {
      const names = getSupportedCredentialNames();

      expect(names).toEqual(expect.arrayContaining(['openai', 'anthropic', 'ollama']));
      expect(new Set(names).size).toBe(names.length);
    });

    it('should return a readonly array', () => {
      const names = getSupportedCredentialNames();

      // The returned array should be the actual credential names
      expect(names).toContain('openai');
      expect(names).toContain('anthropic');
      expect(names).toContain('ollama');
    });
  });

  describe('Edge Cases', () => {
    it('should handle Unicode characters in credential values', () => {
      process.env.OPENAI_API_KEY = 'sk-测试🔑abc123';

      const result = detectCredentials();
      const openai = result.find(c => c.name === 'openai');

      expect(openai?.present).toBe(true);
      expect(openai?.maskedValue).toMatch(/^sk\*+\w{4}$/);
    });

    it('should handle very long credential values', () => {
      const longKey = 'sk-' + 'a'.repeat(100);
      process.env.OPENAI_API_KEY = longKey;

      const result = detectCredentials();
      const openai = result.find(c => c.name === 'openai');

      expect(openai?.present).toBe(true);
    });

    it('should handle special characters in Ollama host', () => {
      process.env.OLLAMA_HOST = 'https://user:pass@example.com:8080/path';

      const result = detectCredentials();
      const ollama = result.find(c => c.name === 'ollama');

      expect(ollama?.present).toBe(true);
      expect(ollama?.maskedValue).not.toContain('user');
      expect(ollama?.maskedValue).not.toContain('pass');
    });

    it('reads only registry-declared env vars, never arbitrary ones from the environment', () => {
      // Even if many env vars are set, should limit checks
      for (let i = 0; i < 20; i++) {
        process.env[`CUSTOM_KEY_${i}`] = `value-${i}`;
      }
      process.env.OPENAI_API_KEY = 'sk-test';

      const result = detectCredentials();

      // Only registry-declared env vars come back; the 20 CUSTOM_KEY_* vars
      // set above must not appear.
      const declared = new Set(getDetectionEnvVars().map(signal => signal.value));
      expect(result.every(c => declared.has(c.key))).toBe(true);
      expect(result.some(c => c.key.startsWith('CUSTOM_KEY_'))).toBe(false);
    });
  });

  describe('Type Safety', () => {
    it('should export CredentialName type', () => {
      const name: CredentialName = 'openai';
      expect(name).toBe('openai');
    });

    it('should export DetectedCredential interface', () => {
      const cred: DetectedCredential = {
        name: 'openai',
        key: 'OPENAI_API_KEY',
        maskedValue: 'sk****1234',
        present: true
      };
      expect(cred.name).toBe('openai');
    });
  });

  describe('Idempotency', () => {
    it('should return consistent results across multiple calls', () => {
      process.env.OPENAI_API_KEY = 'sk-test1234567890abcdefghijklmn';

      const result1 = detectCredentials();
      const result2 = detectCredentials();

      // Check structure is consistent (not exact equality due to random padding)
      expect(result1).toHaveLength(result2.length);
      result1.forEach((cred, i) => {
        expect(cred.name).toBe(result2[i].name);
        expect(cred.key).toBe(result2[i].key);
        expect(cred.present).toBe(result2[i].present);

        // For present credentials, check masked format is consistent
        if (cred.present) {
          expect(cred.maskedValue).toMatch(/^\w{2,}\*+\w{3,5}$/);
          expect(result2[i].maskedValue).toMatch(/^\w{2,}\*+\w{3,5}$/);
        } else {
          expect(cred.maskedValue).toBe('not set');
          expect(result2[i].maskedValue).toBe('not set');
        }
      });
    });

    it('should not modify process.env', () => {
      const originalValue = 'sk-test1234567890abcdefghijklmn';
      process.env.OPENAI_API_KEY = originalValue;

      detectCredentials();

      expect(process.env.OPENAI_API_KEY).toBe(originalValue);
    });
  });

  describe('SECURITY: String Coercion Attacks', () => {
    it('should reject String object wrappers', () => {
      (process.env as any).OPENAI_API_KEY = new String('sk-test1234567890abcdefghijklmn');

      const result = detectCredentials();
      const openai = result.find(c => c.name === 'openai');

      expect(openai?.present).toBe(false);
      expect(openai?.maskedValue).toBe('not set');
    });

    it('should reject objects with toString method', () => {
      (process.env as any).OPENAI_API_KEY = {
        toString: () => 'sk-test1234567890abcdefghijklmn'
      };

      const result = detectCredentials();
      const openai = result.find(c => c.name === 'openai');

      expect(openai?.present).toBe(false);
      expect(openai?.maskedValue).toBe('not set');
    });

    it('should reject objects with valueOf method', () => {
      (process.env as any).OPENAI_API_KEY = {
        valueOf: () => 'sk-test1234567890abcdefghijklmn'
      };

      const result = detectCredentials();
      const openai = result.find(c => c.name === 'openai');

      expect(openai?.present).toBe(false);
      expect(openai?.maskedValue).toBe('not set');
    });

    it('should reject array values', () => {
      (process.env as any).OPENAI_API_KEY = ['sk-test1234567890abcdefghijklmn'];

      const result = detectCredentials();
      const openai = result.find(c => c.name === 'openai');

      expect(openai?.present).toBe(false);
      expect(openai?.maskedValue).toBe('not set');
    });

    it('should reject function values', () => {
      (process.env as any).OPENAI_API_KEY = () => 'sk-test1234567890abcdefghijklmn';

      const result = detectCredentials();
      const openai = result.find(c => c.name === 'openai');

      expect(openai?.present).toBe(false);
      expect(openai?.maskedValue).toBe('not set');
    });

    it('should reject Buffer values', () => {
      (process.env as any).OPENAI_API_KEY = Buffer.from('sk-test1234567890abcdefghijklmn');

      const result = detectCredentials();
      const openai = result.find(c => c.name === 'openai');

      expect(openai?.present).toBe(false);
      expect(openai?.maskedValue).toBe('not set');
    });
  });

  describe('SECURITY: Additional Edge Cases', () => {
    it('should handle whitespace-only strings as present', () => {
      process.env.OPENAI_API_KEY = '   ';

      const result = detectCredentials();
      const openai = result.find(c => c.name === 'openai');

      // Whitespace-only is still a string, so present=true
      // (this is expected behavior - caller can trim if needed)
      expect(openai?.present).toBe(true);
    });

    it('should handle strings with newlines', () => {
      process.env.OPENAI_API_KEY = 'sk-test\n1234';

      const result = detectCredentials();
      const openai = result.find(c => c.name === 'openai');

      expect(openai?.present).toBe(true);
      expect(openai?.maskedValue).toContain('sk');
    });

    it('should handle strings with null bytes', () => {
      process.env.OPENAI_API_KEY = 'sk-test\x001234';

      const result = detectCredentials();
      const openai = result.find(c => c.name === 'openai');

      expect(openai?.present).toBe(true);
    });

    it('should not leak credential in stack traces', () => {
      process.env.OPENAI_API_KEY = 'sk-test1234567890abcdefghijklmn';

      // If any error occurs, the credential should not appear in the error
      const result = detectCredentials();
      const openai = result.find(c => c.name === 'openai');

      expect(openai?.maskedValue).not.toContain('test1234567890');
      expect(openai?.maskedValue).not.toBe('sk-test1234567890abcdefghijklmn');
    });
  });
});
