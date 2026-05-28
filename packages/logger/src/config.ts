/**
 * Attack Logger - Configuration Handling
 * ======================================
 *
 * Configuration validation and defaults for AttackLogger.
 *
 * @package @blackunicorn/bonklm-logger
 */

import type { AttackLoggerConfig, OriginType } from './types.js';

/**
 * Default configuration values.
 */
const DEFAULTS = {
  max_logs: 1000,
  ttl: 2592000000, // 30 days in milliseconds
  enabled: true,
  origin_type: 'sessionId' as OriginType,
  custom_origin: '',
  warn_before_ttl_clear: true,
  sanitize_pii: true,
  max_content_size: 1048576 // 1MB in bytes (S014-005)
};

/**
 * Validated and merged configuration for AttackLogger.
 */
export interface ValidatedConfig {
  max_logs: number;
  ttl: number;
  enabled: boolean;
  origin_type: OriginType;
  custom_origin: string;
  warn_before_ttl_clear: boolean;
  sanitize_pii: boolean;
  max_content_size: number; // S014-005: Memory bounds
}

/**
 * Validate and merge configuration with defaults.
 *
 * @param config - User-provided configuration
 * @returns Validated configuration with defaults applied
 * @throws Error if configuration is invalid
 */
export function validateConfig(config: AttackLoggerConfig = {}): ValidatedConfig {
  const validated: ValidatedConfig = {
    max_logs: config.max_logs ?? DEFAULTS.max_logs,
    ttl: config.ttl ?? DEFAULTS.ttl,
    enabled: config.enabled ?? DEFAULTS.enabled,
    origin_type: config.origin_type ?? DEFAULTS.origin_type,
    custom_origin: config.custom_origin ?? DEFAULTS.custom_origin,
    warn_before_ttl_clear: config.warn_before_ttl_clear ?? DEFAULTS.warn_before_ttl_clear,
    sanitize_pii: config.sanitize_pii ?? DEFAULTS.sanitize_pii,
    max_content_size: config.max_content_size ?? DEFAULTS.max_content_size
  };

  // Validate max_logs
  if (!Number.isFinite(validated.max_logs) || validated.max_logs < 1) {
    throw new Error(`Invalid max_logs: ${validated.max_logs}. Must be a positive number.`);
  }

  if (validated.max_logs > 100000) {
    throw new Error(`Invalid max_logs: ${validated.max_logs}. Maximum allowed is 100000 to prevent memory exhaustion.`);
  }

  // Validate ttl
  if (!Number.isFinite(validated.ttl) || validated.ttl < 1000) {
    throw new Error(`Invalid ttl: ${validated.ttl}. Must be at least 1000ms (1 second).`);
  }

  // Validate origin_type
  const validOriginTypes: OriginType[] = ['sessionId', 'custom', 'none'];
  if (!validOriginTypes.includes(validated.origin_type)) {
    throw new Error(`Invalid origin_type: ${validated.origin_type}. Must be one of: ${validOriginTypes.join(', ')}`);
  }

  // Validate custom_origin when origin_type is 'custom'
  if (validated.origin_type === 'custom' && !validated.custom_origin) {
    validated.custom_origin = 'custom';
  }

  // Validate max_content_size (S014-005)
  if (!Number.isFinite(validated.max_content_size) || validated.max_content_size < 1024) {
    throw new Error(`Invalid max_content_size: ${validated.max_content_size}. Must be at least 1024 bytes (1KB).`);
  }

  if (validated.max_content_size > 10485760) {
    throw new Error(
      `Invalid max_content_size: ${validated.max_content_size}. Maximum allowed is 10485760 bytes (10MB) to prevent memory exhaustion.`
    );
  }

  // Deprecation warning for sanitize_pii: false
  if (config.sanitize_pii === false) {
    console.warn(
      '[BonkLM Logger] WARNING: sanitize_pii is set to false. ' +
        'PII will be logged in plaintext. This is a security risk. ' +
        'The default will be true in future versions. ' +
        'Explicitly set sanitize_pii: true for secure behavior.'
    );
  }

  return validated;
}

/**
 * Get the default configuration.
 */
export function getDefaultConfig(): ValidatedConfig {
  return { ...DEFAULTS } as ValidatedConfig;
}

/**
 * Create a validated configuration object.
 * This is the main entry point for configuration creation.
 *
 * @param config - User-provided configuration
 * @returns Validated configuration
 */
export function createConfig(config: AttackLoggerConfig = {}): ValidatedConfig {
  return validateConfig(config);
}

/**
 * Merge configuration with defaults without validation.
 * This is useful for combining multiple configuration sources.
 *
 * @param configs - Variable number of configuration objects to merge
 * @returns Merged configuration (not validated)
 *
 * @example
 * ```typescript
 * const baseConfig = { max_logs: 500, sanitize_pii: true };
 * const userConfig = { max_logs: 2000 };
 * const merged = mergeConfig(baseConfig, userConfig);
 * // Result: { max_logs: 2000, sanitize_pii: true, ...defaults }
 * ```
 */
export function mergeConfig(...configs: AttackLoggerConfig[]): AttackLoggerConfig {
  const merged: AttackLoggerConfig = { ...DEFAULTS };

  for (const config of configs) {
    if (config.max_logs !== undefined) {
      merged.max_logs = config.max_logs;
    }
    if (config.ttl !== undefined) {
      merged.ttl = config.ttl;
    }
    if (config.enabled !== undefined) {
      merged.enabled = config.enabled;
    }
    if (config.origin_type !== undefined) {
      merged.origin_type = config.origin_type;
    }
    if (config.custom_origin !== undefined) {
      merged.custom_origin = config.custom_origin;
    }
    if (config.warn_before_ttl_clear !== undefined) {
      merged.warn_before_ttl_clear = config.warn_before_ttl_clear;
    }
    if (config.sanitize_pii !== undefined) {
      merged.sanitize_pii = config.sanitize_pii;
    }
    if (config.max_content_size !== undefined) {
      merged.max_content_size = config.max_content_size;
    }
  }

  return merged;
}
