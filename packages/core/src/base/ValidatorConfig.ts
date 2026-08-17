/**
 * Validator Configuration
 * =======================
 * Common configuration schema for all validators.
 */

import { LogLevel } from './GenericLogger.js';
import { RiskLevel } from './GuardrailResult.js';

export type SensitivityLevel = 'strict' | 'standard' | 'permissive';

export type ActionMode = 'block' | 'sanitize' | 'log' | 'allow';

export interface BaseValidatorConfig {
  /**
   * Sensitivity level for detection
   * - strict: Block on any suspicion
   * - standard: Balanced detection (default)
   * - permissive: Only block on high confidence
   */
  sensitivity?: SensitivityLevel;

  /**
   * Action to take when violations are detected
   * - block: Block the operation (default)
   * - sanitize: Remove/detect and continue
   * - log: Log but allow
   * - allow: Allow without action
   */
  action?: ActionMode;

  /**
   * Minimum risk level to trigger blocking
   */
  blockThreshold?: RiskLevel;

  /**
   * Enable/disable this validator
   */
  enabled?: boolean;

  /**
   * Log level for output
   */
  logLevel?: LogLevel;
}

export interface ValidatorConfig extends BaseValidatorConfig {
  /**
   * Custom logger (optional, uses console by default)
   */
  logger?: import('./GenericLogger.js').Logger;

  /**
   * Override token for bypassing validation
   */
  overrideToken?: string;

  /**
   * Include findings in result
   */
  includeFindings?: boolean;
}

export interface PromptInjectionConfig extends ValidatorConfig {
  /**
   * Detect multi-layer encoding
   */
  detectMultiLayerEncoding?: boolean;

  /**
   * Detect base64 payloads
   */
  detectBase64Payloads?: boolean;

  /**
   * Detect HTML comment injection
   */
  detectHtmlComments?: boolean;

  /**
   * Maximum decoding depth for encoded content
   */
  maxDecodeDepth?: number;
}

export interface JailbreakConfig extends ValidatorConfig {
  /**
   * Enable session risk tracking
   */
  enableSessionTracking?: boolean;

  /**
   * Session risk score threshold for escalation
   */
  sessionEscalationThreshold?: number;

  /**
   * Enable fuzzy matching
   */
  enableFuzzyMatching?: boolean;

  /**
   * Enable heuristic detection
   */
  enableHeuristics?: boolean;
}

export interface SecretGuardConfig extends ValidatorConfig {
  /**
   * Check for example/template files
   */
  checkExamples?: boolean;

  /**
   * Entropy threshold for secret detection
   */
  entropyThreshold?: number;

  /**
   * Allowed secret patterns (whitelist)
   */
  allowedPatterns?: RegExp[];
}

export interface GuardConfig extends ValidatorConfig {
  /**
   * Guard-specific settings
   */
  guardName?: string;
}

export interface ReformulationConfig extends ValidatorConfig {
  /**
   * Enable code format injection detection
   */
  detectCodeFormat?: boolean;

  /**
   * Enable character-level encoding detection
   */
  detectCharacterEncoding?: boolean;

  /**
   * Enable context overload detection
   */
  detectContextOverload?: boolean;

  /**
   * Enable math/logic encoding detection
   */
  detectMathLogic?: boolean;

  /**
   * Maximum content size for character-level decoding (performance guard)
   */
  maxDecodeSize?: number;

  /**
   * Enable session tracking for fragmentation buffer
   */
  enableSessionTracking?: boolean;

  /**
   * Session ID for tracking state across turns
   */
  sessionId?: string;
}

export interface EncodedRescanConfig extends ValidatorConfig {
  /**
   * Maximum multi-layer decode depth for chained encodings (performance guard).
   */
  maxDecodeDepth?: number;
}

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG: Required<
  Pick<ValidatorConfig, 'sensitivity' | 'action' | 'enabled' | 'logLevel' | 'includeFindings'>
> = {
  sensitivity: 'standard',
  action: 'block',
  enabled: true,
  logLevel: LogLevel.INFO,
  includeFindings: true
};

/**
 * Merge user config with defaults
 */
export function mergeConfig<T extends ValidatorConfig>(
  userConfig?: T
): T & Required<Pick<ValidatorConfig, 'sensitivity' | 'action' | 'enabled' | 'logLevel' | 'includeFindings'>> {
  return {
    ...DEFAULT_CONFIG,
    ...userConfig
  } as T & Required<Pick<ValidatorConfig, 'sensitivity' | 'action' | 'enabled' | 'logLevel' | 'includeFindings'>>;
}

/**
 * Get risk threshold based on sensitivity level
 */
export function getRiskThreshold(sensitivity: SensitivityLevel): number {
  switch (sensitivity) {
    case 'strict':
      return 5; // Block at low risk
    case 'permissive':
      return 25; // Only block at high risk
    case 'standard':
    default:
      return 15; // Balanced threshold
  }
}
