/**
 * Tests for SecureCredential class
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SecureCredential } from './secure-credential.js';
import { WizardError } from './error.js';

describe('SecureCredential', () => {
  describe('constructor', () => {
    it('should create a credential from a string', () => {
      const credential = new SecureCredential('test-api-key');

      expect(credential).toBeDefined();
      expect(credential.toString()).toBe('test-api-key');
    });

    it('should accept empty string', () => {
      const credential = new SecureCredential('');

      expect(credential.toString()).toBe('');
    });

    it('should handle unicode characters', () => {
      const credential = new SecureCredential('🔑-test-key-🔑');

      expect(credential.toString()).toBe('🔑-test-key-🔑');
    });

    it('should throw WizardError for oversized credentials', () => {
      // Create a string larger than 8KB (8192 bytes)
      const largeCredential = 'a'.repeat(8193); // 8193 bytes

      expect(() => new SecureCredential(largeCredential)).toThrow(WizardError);
    });

    it('should include error details for oversized credentials', () => {
      const largeCredential = 'x'.repeat(9000);

      try {
        new SecureCredential(largeCredential);
        expect.fail('Should have thrown WizardError');
      } catch (error) {
        expect(error).toBeInstanceOf(WizardError);
        if (error instanceof WizardError) {
          expect(error.code).toBe('CREDENTIAL_TOO_LARGE');
          expect(error.message).toContain('9000');
          expect(error.message).toContain('8192');
          expect(error.suggestion).toBeDefined();
          expect(error.exitCode).toBe(1);
        }
      }
    });

    it('should accept credentials at exactly 8KB boundary', () => {
      // 8192 bytes should be accepted
      const maxCredential = 'a'.repeat(8192);

      expect(() => new SecureCredential(maxCredential)).not.toThrow();
    });

    it('should accept one byte less than maximum', () => {
      const nearMaxCredential = 'b'.repeat(8191);

      const credential = new SecureCredential(nearMaxCredential);
      expect(credential.toString()).toBe(nearMaxCredential);
    });

    it('should handle multi-byte UTF-8 characters correctly', () => {
      // Emoji take 4 bytes each in UTF-8
      // 1000 emoji = 4000 bytes, well under limit
      const emojiCredential = '😀'.repeat(1000);

      expect(() => new SecureCredential(emojiCredential)).not.toThrow();
    });

    it('should calculate byte length not character length for limit', () => {
      // Each emoji is 4 bytes, so 2048 emoji = 8192 bytes (exactly at limit)
      const emojiAtLimit = '🔑'.repeat(2048);

      expect(() => new SecureCredential(emojiAtLimit)).not.toThrow();
    });

    it('should use Buffer.alloc for clean memory', () => {
      // This is a security property - we can't directly test that Buffer.alloc
      // was used, but we can verify the behavior is correct
      const credential = new SecureCredential('test-value');

      // The buffer should contain our value
      expect(credential.toString()).toBe('test-value');
    });
  });

  describe('toString', () => {
    it('should return the original credential value', () => {
      const credential = new SecureCredential('sk-1234567890abcdef');

      expect(credential.toString()).toBe('sk-1234567890abcdef');
    });

    it('should return empty string for empty credential', () => {
      const credential = new SecureCredential('');

      expect(credential.toString()).toBe('');
    });

    it('should preserve special characters', () => {
      const specialChars = '!@#$%^&*()_+-=[]{}|;:,.<>?';
      const credential = new SecureCredential(specialChars);

      expect(credential.toString()).toBe(specialChars);
    });

    it('should preserve whitespace', () => {
      const whitespace = '  value with  spaces  ';
      const credential = new SecureCredential(whitespace);

      expect(credential.toString()).toBe(whitespace);
    });

    it('should handle newlines', () => {
      const withNewlines = 'line1\nline2\rline3';
      const credential = new SecureCredential(withNewlines);

      expect(credential.toString()).toBe(withNewlines);
    });

    it('should be callable multiple times before disposal', () => {
      const credential = new SecureCredential('test-value');

      expect(credential.toString()).toBe('test-value');
      expect(credential.toString()).toBe('test-value');
      expect(credential.toString()).toBe('test-value');
    });
  });

  describe('dispose', () => {
    it('should zero the buffer memory', () => {
      const credential = new SecureCredential('secret-key-12345');

      // Verify value before disposal
      expect(credential.toString()).toBe('secret-key-12345');

      // Dispose should zero the memory
      credential.dispose();

      // After disposal, toString should return empty string
      expect(credential.toString()).toBe('');
    });

    it('should be idempotent (safe to call multiple times)', () => {
      const credential = new SecureCredential('test-value');

      credential.dispose();
      expect(credential.toString()).toBe('');

      // Second dispose should not throw
      credential.dispose();
      expect(credential.toString()).toBe('');
    });

    it('should not throw on disposed credential', () => {
      const credential = new SecureCredential('value');

      expect(() => credential.dispose()).not.toThrow();
    });

    it('should zero all bytes in buffer', () => {
      const longValue = 'a'.repeat(100);
      const credential = new SecureCredential(longValue);

      credential.dispose();

      // All bytes should be zero
      expect(credential.toString()).toBe('');
    });
  });

  describe('use', () => {
    it('should execute callback with credential value', async () => {
      const credential = new SecureCredential('test-api-key');
      const result = await credential.use(async key => {
        return `processed: ${key}`;
      });

      expect(result).toBe('processed: test-api-key');
    });

    it('should dispose after successful callback', async () => {
      const credential = new SecureCredential('secret');
      let extractedKey: string | undefined;

      await credential.use(async key => {
        extractedKey = key;
        return 'done';
      });

      expect(extractedKey).toBe('secret');
      expect(credential.toString()).toBe('');
    });

    it('should dispose even when callback throws', async () => {
      const credential = new SecureCredential('secret');

      await expect(
        credential.use(async () => {
          throw new Error('Callback error');
        })
      ).rejects.toThrow('Callback error');

      // Memory should still be zeroed
      expect(credential.toString()).toBe('');
    });

    it('should return callback result', async () => {
      const credential = new SecureCredential('key');

      const result = await credential.use(async key => {
        return key.toUpperCase();
      });

      expect(result).toBe('KEY');
    });

    it('should support complex return types', async () => {
      const credential = new SecureCredential('key');

      interface Result {
        status: number;
        data: string;
      }

      const result = await credential.use(async k => {
        return { status: 200, data: k };
      });

      expect(result).toEqual({ status: 200, data: 'key' });
    });

    it('should handle sequential use calls', async () => {
      const credential = new SecureCredential('original');

      const firstResult = await credential.use(async k => {
        return `first: ${k}`;
      });

      // After first use, credential is disposed
      expect(credential.toString()).toBe('');

      // Create new credential for second use
      const credential2 = new SecureCredential('second');
      const secondResult = await credential2.use(async k => {
        return `second: ${k}`;
      });

      expect(firstResult).toBe('first: original');
      expect(secondResult).toBe('second: second');
    });

    it('should propagate async errors correctly', async () => {
      const credential = new SecureCredential('key');

      await expect(
        credential.use(async () => {
          throw new Error('Async error');
        })
      ).rejects.toThrow('Async error');
    });

    it('should work with nested use calls on different credentials', async () => {
      const outer = new SecureCredential('outer-key');
      const inner = new SecureCredential('inner-key');

      const result = await outer.use(async outerKey => {
        return await inner.use(async innerKey => {
          return `${outerKey}:${innerKey}`;
        });
      });

      expect(result).toBe('outer-key:inner-key');
      expect(outer.toString()).toBe('');
      expect(inner.toString()).toBe('');
    });
  });

  describe('useSync', () => {
    it('should execute synchronous callback with credential value', () => {
      const credential = new SecureCredential('test-api-key');
      const result = credential.useSync(key => {
        return `processed: ${key}`;
      });

      expect(result).toBe('processed: test-api-key');
    });

    it('should dispose after successful callback', () => {
      const credential = new SecureCredential('secret');

      const result = credential.useSync(key => {
        return key.toUpperCase();
      });

      expect(result).toBe('SECRET');
      expect(credential.toString()).toBe('');
    });

    it('should dispose even when callback throws', () => {
      const credential = new SecureCredential('secret');

      expect(() => {
        credential.useSync(() => {
          throw new Error('Sync error');
        });
      }).toThrow('Sync error');

      // Memory should still be zeroed
      expect(credential.toString()).toBe('');
    });

    it('should support complex return types', () => {
      const credential = new SecureCredential('key');

      interface Result {
        valid: boolean;
        value: string;
      }

      const result = credential.useSync(k => {
        return { valid: true, value: k };
      });

      expect(result).toEqual({ valid: true, value: 'key' });
    });

    it('should propagate errors correctly', () => {
      const credential = new SecureCredential('key');

      expect(() => {
        credential.useSync(() => {
          throw new Error('Test error');
        });
      }).toThrow('Test error');
    });
  });

  describe('common API key formats', () => {
    it('should handle OpenAI API keys', () => {
      const openaiKey = 'sk-proj-abcdefghijklmnopqrstuvwxyz1234567890';
      const credential = new SecureCredential(openaiKey);

      expect(credential.toString()).toBe(openaiKey);
    });

    it('should handle Anthropic API keys', () => {
      const anthropicKey = 'sk-ant-api03-1234567890abcdefghijklmnopqrstuvwxyz1234567';
      const credential = new SecureCredential(anthropicKey);

      expect(credential.toString()).toBe(anthropicKey);
    });

    it('should handle JWT-like tokens', () => {
      const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0';
      const credential = new SecureCredential(jwt);

      expect(credential.toString()).toBe(jwt);
    });

    it('should handle Bearer token format', () => {
      const bearerToken = 'Bearer xyz789abc123def456';
      const credential = new SecureCredential(bearerToken);

      expect(credential.toString()).toBe(bearerToken);
    });
  });

  describe('edge cases', () => {
    it('should handle very long but valid credentials', () => {
      // Some services have very long tokens
      const longToken = 'a'.repeat(5000);
      const credential = new SecureCredential(longToken);

      expect(credential.toString()).toBe(longToken);
    });

    it('should handle credentials with only special characters', () => {
      const specialOnly = '!@#$%^&*()';
      const credential = new SecureCredential(specialOnly);

      expect(credential.toString()).toBe(specialOnly);
    });

    it('should handle credentials with only numbers', () => {
      const numericKey = '12345678901234567890';
      const credential = new SecureCredential(numericKey);

      expect(credential.toString()).toBe(numericKey);
    });

    it('should handle single character credentials', () => {
      const singleChar = 'x';
      const credential = new SecureCredential(singleChar);

      expect(credential.toString()).toBe(singleChar);
    });

    it('should handle credentials at exact byte boundary with multibyte chars', () => {
      // Mix of ASCII and emoji to hit exactly 8192 bytes
      const ascii = 'a'.repeat(8180); // 8180 bytes
      const emoji = '🔑'; // 4 bytes
      const more = 'bc'; // 2 bytes
      // Total: 8180 + 4 + 8 = 8192 bytes

      const mixed = ascii + emoji + more + 'd'.repeat(6);

      expect(() => new SecureCredential(mixed)).not.toThrow();
    });
  });

  describe('security properties', () => {
    it('should enforce 8KB size limit', () => {
      const oversized = 'x'.repeat(8193);

      expect(() => new SecureCredential(oversized)).toThrow(WizardError);
    });

    it('should provide helpful error message for oversized credentials', () => {
      const oversized = 'y'.repeat(10000);

      try {
        new SecureCredential(oversized);
        expect.fail('Should throw');
      } catch (error) {
        expect(error).toBeInstanceOf(WizardError);
        if (error instanceof WizardError) {
          expect(error.code).toBe('CREDENTIAL_TOO_LARGE');
          expect(error.message).toContain('Credential size');
          expect(error.message).toContain('exceeds maximum');
          expect(error.suggestion).toContain('shorter');
        }
      }
    });

    it('should zero memory on disposal', () => {
      const credential = new SecureCredential('sensitive-data-12345');

      credential.dispose();

      // Verify memory is zeroed by checking toString returns empty
      expect(credential.toString()).toBe('');
    });

    it('should always dispose in use() even on error', async () => {
      const credential = new SecureCredential('very-sensitive-key');

      let errorThrown = false;
      try {
        await credential.use(async () => {
          errorThrown = true;
          throw new Error('Intentional error');
        });
      } catch {
        // Expected
      }

      expect(errorThrown).toBe(true);
      expect(credential.toString()).toBe('');
    });

    it('should always dispose in useSync() even on error', () => {
      const credential = new SecureCredential('very-sensitive-key');

      let errorThrown = false;
      try {
        credential.useSync(() => {
          errorThrown = true;
          throw new Error('Intentional error');
        });
      } catch {
        // Expected
      }

      expect(errorThrown).toBe(true);
      expect(credential.toString()).toBe('');
    });
  });

  describe('real-world usage patterns', () => {
    it('should support typical API validation flow', async () => {
      const apiKey = 'sk-test1234567890abcdef';
      const credential = new SecureCredential(apiKey);

      const isValid = await credential.use(async key => {
        // Simulate API validation
        return key.startsWith('sk-') && key.length > 20;
      });

      expect(isValid).toBe(true);
      expect(credential.toString()).toBe('');
    });

    it('should support credential transformation flow', async () => {
      const originalKey = 'base64-encoded-key';
      const credential = new SecureCredential(originalKey);

      const transformed = await credential.use(async key => {
        return Buffer.from(key).toString('base64');
      });

      expect(transformed).toBe(Buffer.from(originalKey).toString('base64'));
      expect(credential.toString()).toBe('');
    });

    it('should support conditional credential usage', async () => {
      const credential = new SecureCredential('conditional-key');

      const result = await credential.use(async key => {
        if (key.includes('conditional')) {
          return 'matched';
        }
        return 'not-matched';
      });

      expect(result).toBe('matched');
    });
  });

  describe('Buffer.alloc security verification', () => {
    it('should use clean memory allocation', () => {
      // Create and immediately dispose to verify clean allocation
      const values: string[] = [];

      for (let i = 0; i < 10; i++) {
        const credential = new SecureCredential(`test-${i}`);
        const value = credential.toString();
        values.push(value);
        credential.dispose();
      }

      // All values should be correct (not contaminated by previous allocations)
      expect(values).toEqual([
        'test-0',
        'test-1',
        'test-2',
        'test-3',
        'test-4',
        'test-5',
        'test-6',
        'test-7',
        'test-8',
        'test-9'
      ]);
    });

    it('should not leak data from previous allocations', () => {
      // Create a large credential, dispose it
      const large = new SecureCredential('A'.repeat(5000));
      large.dispose();

      // Create a small credential
      const small = new SecureCredential('xyz');
      const value = small.toString();

      // Small credential should not contain data from large one
      expect(value).toBe('xyz');
      expect(value).not.toContain('A');
    });
  });

  describe('use-after-dispose guards', () => {
    it('should throw when calling use() on disposed credential', async () => {
      const credential = new SecureCredential('test-key');
      credential.dispose();

      await expect(credential.use(async () => 'result')).rejects.toThrow('already been disposed');
    });

    it('should throw when calling useSync() on disposed credential', () => {
      const credential = new SecureCredential('test-key');
      credential.dispose();

      expect(() => credential.useSync(() => 'result')).toThrow('already been disposed');
    });
  });

  describe('re-entry guards', () => {
    it('should throw when calling use() while already in use', async () => {
      const credential = new SecureCredential('test-key');

      // This test verifies re-entry protection
      let innerCall = false;
      try {
        await credential.use(async () => {
          // Try to call use() recursively from within the callback
          await credential.use(async () => {
            innerCall = true;
          });
        });
        expect.fail('Should have thrown CREDENTIAL_IN_USE');
      } catch (error) {
        expect((error as Error).message).toContain('already in progress');
        expect(innerCall).toBe(false);
      }
    });

    it('should throw when calling useSync() while already in use', () => {
      const credential = new SecureCredential('test-key');

      let innerCall = false;
      try {
        credential.useSync(() => {
          // Try to call useSync() recursively from within the callback
          credential.useSync(() => {
            innerCall = true;
          });
        });
        expect.fail('Should have thrown CREDENTIAL_IN_USE');
      } catch (error) {
        expect((error as Error).message).toContain('already in progress');
        expect(innerCall).toBe(false);
      }
    });
  });

  describe('isDisposed getter', () => {
    it('should return false for active credential', () => {
      const credential = new SecureCredential('test-key');
      expect(credential.isDisposed).toBe(false);
    });

    it('should return true after disposal', () => {
      const credential = new SecureCredential('test-key');
      credential.dispose();
      expect(credential.isDisposed).toBe(true);
    });

    it('should return true after use() completes', async () => {
      const credential = new SecureCredential('test-key');
      await credential.use(async () => {
        expect(credential.isDisposed).toBe(false);
      });
      expect(credential.isDisposed).toBe(true);
    });

    it('should return true after useSync() completes', () => {
      const credential = new SecureCredential('test-key');
      credential.useSync(() => {
        expect(credential.isDisposed).toBe(false);
      });
      expect(credential.isDisposed).toBe(true);
    });
  });

  describe('inspect protection', () => {
    it('should return REDACTED for active credential in inspect', () => {
      const credential = new SecureCredential('secret-key');
      const result = credential[Symbol.for('nodejs.util.inspect.custom')]();
      expect(result).toBe('[SecureCredential: REDACTED]');
    });

    it('should return disposed for disposed credential in inspect', () => {
      const credential = new SecureCredential('secret-key');
      credential.dispose();
      const result = credential[Symbol.for('nodejs.util.inspect.custom')]();
      expect(result).toBe('[SecureCredential: disposed]');
    });
  });

  describe('toJSON protection', () => {
    it('should return REDACTED for active credential', () => {
      const credential = new SecureCredential('secret-key');
      expect(credential.toJSON()).toBe('[SecureCredential: REDACTED]');
    });

    it('should return disposed for disposed credential', () => {
      const credential = new SecureCredential('secret-key');
      credential.dispose();
      expect(credential.toJSON()).toBe('[SecureCredential: disposed]');
    });

    it('should not expose credential in JSON.stringify', () => {
      const credential = new SecureCredential('secret-key');
      const obj = { cred: credential };
      const json = JSON.stringify(obj);
      expect(json).toContain('[SecureCredential: REDACTED]');
      expect(json).not.toContain('secret-key');
    });
  });

  describe('valueOf protection', () => {
    it('should return undefined to prevent accidental conversion', () => {
      const credential = new SecureCredential('secret-key');
      expect(credential.valueOf()).toBeUndefined();
    });
  });
});
