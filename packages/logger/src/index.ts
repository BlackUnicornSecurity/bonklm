/**
 * @blackunicorn/bonklm-logger
 * ===================================
 *
 * Attack Logger & Awareness Display for BonkLM
 *
 * @example
 * ```typescript
 * import { AttackLogger } from '@blackunicorn/bonklm-logger';
 *
 * const logger = new AttackLogger({ max_logs: 1000 });
 *
 * // Use with GuardrailEngine
 * import { GuardrailEngine } from '@blackunicorn/bonklm';
 * const engine = new GuardrailEngine({ ... });
 * engine.onIntercept(logger.getInterceptCallback());
 *
 * // Display summary
 * logger.show('summary');
 * ```
 */

// Main class
export { AttackLogger, resetSessionId, setExportDirectory } from './AttackLogger.js';

// Store (for advanced usage)
export { AttackLogStore } from './AttackLogStore.js';

// Configuration
export { createConfig, validateConfig, getDefaultConfig, mergeConfig } from './config.js';
export type { ValidatedConfig } from './config.js';

// Transformation utilities
export {
  transformToAttackLogEntry,
  deriveInjectionType,
  deriveAttackVector,
  sanitizeContent_ as sanitizeContent,
  truncateContent,
  escapeControlCharacters,
  stripAnsiEscapes,
  sanitizeForJSON
} from './transform.js';

// Types
export type {
  AttackLogEntry,
  InjectionType,
  AttackVector,
  RiskLevel,
  OriginType,
  DisplayFormat,
  Finding,
  AttackLoggerConfig,
  LogFilter,
  DisplayOptions,
  ExportOptions,
  AttackSummary,
  InterceptCallback,
  EngineResult,
  ValidatorResult
} from './types.js';
