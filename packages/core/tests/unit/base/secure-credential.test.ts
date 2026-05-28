/**
 * SecureCredential Unit Tests (S011-004a)
 * ========================================
 * Tests for the SecureCredential class exported from base package.
 */

import { describe, it, expect } from 'vitest';
import {
  SecureCredential,
  SecureCredentialError,
  type CredentialCallback,
  type CredentialCallbackSync
} from '../../../src/base/index.js';

describe('SecureCredential (S011-004a)', () => {
  describe('Base Package Export', () => {
    it('should export SecureCredential from base package', () => {
      expect(SecureCredential).toBeDefined();
      expect(typeof SecureCredential).toBe('function');
    });

    it('should export CredentialCallback type', () => {
      const callback: CredentialCallback<string> = async cred => cred;
      expect(typeof callback).toBe('function');
    });

    it('should export CredentialCallbackSync type', () => {
      const callback: CredentialCallbackSync<string> = cred => cred;
      expect(typeof callback).toBe('function');
    });

    it('should export SecureCredentialError codes', () => {
      expect(SecureCredentialError).toBeDefined();
      expect(SecureCredentialError.TOO_LARGE).toBe('CREDENTIAL_TOO_LARGE');
      expect(SecureCredentialError.DISPOSED).toBe('CREDENTIAL_DISPOSED');
      expect(SecureCredentialError.IN_USE).toBe('CREDENTIAL_IN_USE');
    });
  });

  describe('Memory Safety', () => {
    it('should use Buffer.alloc for clean memory', () => {
      const credential = new SecureCredential('test-key-12345');
      expect(credential.toString()).toBe('test-key-12345');
      credential.dispose();
      expect(credential.toString()).toBe('');
    });

    it('should enforce 8KB size limit', () => {
      const largeKey = 'x'.repeat(8193); // Exceeds 8KB
      expect(() => new SecureCredential(largeKey)).toThrow();
    });

    it('should allow 8KB credential', () => {
      const maxSizeKey = 'x'.repeat(8192); // Exactly 8KB
      const credential = new SecureCredential(maxSizeKey);
      expect(credential.toString()).toHaveLength(8192);
      credential.dispose();
    });

    it('should zero memory on dispose', () => {
      const credential = new SecureCredential('sensitive-data');
      credential.dispose();
      expect(credential.isDisposed).toBe(true);
      expect(credential.toString()).toBe('');
    });

    it('should be idempotent when disposing', () => {
      const credential = new SecureCredential('test-key');
      credential.dispose();
      expect(() => credential.dispose()).not.toThrow();
      expect(credential.isDisposed).toBe(true);
    });
  });

  describe('use() Method', () => {
    it('should automatically cleanup after use', async () => {
      const credential = new SecureCredential('api-key-123');
      let capturedKey: string | undefined;

      const result = await credential.use(async key => {
        capturedKey = key;
        return 'success';
      });

      expect(result).toBe('success');
      expect(capturedKey).toBe('api-key-123');
      expect(credential.isDisposed).toBe(true);
    });

    it('should cleanup even when callback throws', async () => {
      const credential = new SecureCredential('api-key-123');

      await expect(
        credential.use(async () => {
          throw new Error('Test error');
        })
      ).rejects.toThrow('Test error');

      expect(credential.isDisposed).toBe(true);
    });

    it('should reject use after dispose', async () => {
      const credential = new SecureCredential('api-key-123');
      credential.dispose();

      await expect(credential.use(async () => 'result')).rejects.toThrow();
    });

    it('should reject re-entry during use', async () => {
      const credential = new SecureCredential('api-key-123');

      // Create a scenario where use() is called again while in progress
      let nestedCall: Promise<string> | null = null;

      const result = await credential.use(async key => {
        // Try to call use() again from within the callback
        nestedCall = credential.use(async k => `nested: ${k}`);
        return `first: ${key}`;
      });

      expect(result).toBe('first: api-key-123');
      await expect(nestedCall).rejects.toThrow('while already');
    });
  });

  describe('useSync() Method', () => {
    it('should automatically cleanup after useSync', () => {
      const credential = new SecureCredential('api-key-123');
      let capturedKey: string | undefined;

      const result = credential.useSync(key => {
        capturedKey = key;
        return 'success';
      });

      expect(result).toBe('success');
      expect(capturedKey).toBe('api-key-123');
      expect(credential.isDisposed).toBe(true);
    });

    it('should cleanup even when callback throws', () => {
      const credential = new SecureCredential('api-key-123');

      expect(() => {
        credential.useSync(() => {
          throw new Error('Test error');
        });
      }).toThrow('Test error');

      expect(credential.isDisposed).toBe(true);
    });

    it('should reject useSync after dispose', () => {
      const credential = new SecureCredential('api-key-123');
      credential.dispose();

      expect(() => {
        credential.useSync(() => 'result');
      }).toThrow();
    });

    it('should reject re-entry during useSync', () => {
      const credential = new SecureCredential('api-key-123');

      const result = credential.useSync(key => {
        // Try to call useSync() again from within the callback
        expect(() => {
          credential.useSync(k => `nested: ${k}`);
        }).toThrow('while already');
        return `first: ${key}`;
      });

      expect(result).toBe('first: api-key-123');
    });
  });

  describe('Inspection Protection', () => {
    it('should not leak credential in console.log', () => {
      const credential = new SecureCredential('secret-key-123');
      const inspectResult = credential[Symbol.for('nodejs.util.inspect.custom')]();
      expect(inspectResult).toContain('REDACTED');
      expect(inspectResult).not.toContain('secret-key-123');
      credential.dispose();
    });

    it('should show disposed in inspect after dispose', () => {
      const credential = new SecureCredential('secret-key-123');
      credential.dispose();
      const inspectResult = credential[Symbol.for('nodejs.util.inspect.custom')]();
      expect(inspectResult).toContain('disposed');
    });

    it('should not leak credential in JSON.stringify', () => {
      const credential = new SecureCredential('secret-key-123');
      const jsonResult = credential.toJSON();
      expect(jsonResult).toContain('REDACTED');
      expect(jsonResult).not.toContain('secret-key-123');
      credential.dispose();
    });

    it('should return undefined from valueOf', () => {
      const credential = new SecureCredential('secret-key-123');
      expect(credential.valueOf()).toBeUndefined();
      credential.dispose();
    });
  });

  describe('Security Properties', () => {
    it('should return empty string after dispose', () => {
      const credential = new SecureCredential('my-credential');
      credential.dispose();
      expect(credential.toString()).toBe('');
    });

    it('should handle UTF-8 credentials correctly', () => {
      const credential = new SecureCredential('key-with-unicode-ñ-é');
      expect(credential.toString()).toBe('key-with-unicode-ñ-é');
      credential.dispose();
    });

    it('should handle empty string', () => {
      const credential = new SecureCredential('');
      expect(credential.toString()).toBe('');
      credential.dispose();
    });

    it('should calculate byte length correctly for UTF-8', () => {
      // Each emoji is 4 bytes in UTF-8
      const emojiKey = '🔑🔑🔑'; // 12 bytes
      const credential = new SecureCredential(emojiKey);
      expect(credential.toString()).toBe(emojiKey);
      credential.dispose();
    });
  });
});
