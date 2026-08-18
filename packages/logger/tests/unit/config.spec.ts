/**
 * Config Unit Tests
 */

import { describe, it, expect, vi } from 'vitest';
import { validateConfig, getDefaultConfig, createConfig } from '../../src/config.js';

describe('validateConfig', () => {
  it('should use defaults when no config provided', () => {
    const config = validateConfig();
    expect(config.max_logs).toBe(1000);
    expect(config.ttl).toBe(2592000000); // 30 days
    expect(config.enabled).toBe(true);
    expect(config.origin_type).toBe('sessionId');
    expect(config.warn_before_ttl_clear).toBe(true);
    expect(config.sanitize_pii).toBe(true);
    expect(config.max_content_size).toBe(1048576); // 1MB (S014-005)
  });

  it('should accept valid custom config', () => {
    const config = validateConfig({
      max_logs: 500,
      ttl: 3600000,
      enabled: false,
      origin_type: 'custom',
      custom_origin: 'my-app'
    });
    expect(config.max_logs).toBe(500);
    expect(config.ttl).toBe(3600000);
    expect(config.enabled).toBe(false);
    expect(config.origin_type).toBe('custom');
    expect(config.custom_origin).toBe('my-app');
  });

  it('should reject invalid max_logs (negative)', () => {
    expect(() => validateConfig({ max_logs: -1 })).toThrow('Invalid max_logs');
  });

  it('should reject invalid max_logs (zero)', () => {
    expect(() => validateConfig({ max_logs: 0 })).toThrow('Invalid max_logs');
  });

  it('should reject max_logs > 100000', () => {
    expect(() => validateConfig({ max_logs: 100001 })).toThrow('Maximum allowed is 100000');
  });

  it('should reject invalid ttl (too small)', () => {
    expect(() => validateConfig({ ttl: 500 })).toThrow('Invalid ttl');
  });

  it('should reject invalid origin_type', () => {
    expect(() => validateConfig({ origin_type: 'invalid' as any })).toThrow('Invalid origin_type');
  });

  it('should use default custom_origin when origin_type is custom but no origin provided', () => {
    const config = validateConfig({ origin_type: 'custom' });
    expect(config.custom_origin).toBe('custom');
  });

  it('should accept all valid origin types', () => {
    const validTypes = ['sessionId', 'custom', 'none'] as const;
    for (const type of validTypes) {
      const config = validateConfig({ origin_type: type });
      expect(config.origin_type).toBe(type);
    }
  });

  it('should default sanitize_pii to true', () => {
    const config = validateConfig();
    expect(config.sanitize_pii).toBe(true);
  });

  it('should allow explicit sanitize_pii true', () => {
    const config = validateConfig({ sanitize_pii: true });
    expect(config.sanitize_pii).toBe(true);
  });

  it('should allow explicit sanitize_pii false with deprecation warning', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const config = validateConfig({ sanitize_pii: false });
    expect(config.sanitize_pii).toBe(false);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('sanitize_pii is set to false'));
    spy.mockRestore();
  });
});

describe('getDefaultConfig', () => {
  it('should return the default configuration', () => {
    const config = getDefaultConfig();
    expect(config.max_logs).toBe(1000);
    expect(config.ttl).toBe(2592000000);
    expect(config.enabled).toBe(true);
    expect(config.origin_type).toBe('sessionId');
  });
});

describe('createConfig', () => {
  it('should be an alias for validateConfig', () => {
    const config1 = validateConfig({ max_logs: 500 });
    const config2 = createConfig({ max_logs: 500 });
    expect(config1.max_logs).toBe(config2.max_logs);
  });
});
