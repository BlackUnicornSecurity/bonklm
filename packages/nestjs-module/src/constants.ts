/**
 * NestJS Module Constants
 * =======================
 * Internal constants for the GuardrailsModule.
 */

/**
 * Metadata key for the @UseGuardrails() decorator.
 */
export const USE_GUARDRAILS_KEY = 'llm_guardrails';

/**
 * Default validation timeout in milliseconds.
 */
export const DEFAULT_VALIDATION_TIMEOUT = 5000;

/**
 * Default maximum content length in bytes (1MB).
 */
export const DEFAULT_MAX_CONTENT_LENGTH = 1024 * 1024;

/**
 * Guardrails options provider token.
 */
export const GUARDRAILS_OPTIONS = 'GUARDRAILS_OPTIONS';

/**
 * Guardrails service provider token.
 */
export const GUARDRAILS_SERVICE = 'GUARDRAILS_SERVICE';
