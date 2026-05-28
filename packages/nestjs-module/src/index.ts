/**
 * @blackunicorn/bonklm-nestjs
 * ===================================
 * NestJS integration for BonkLM.
 *
 * @package @blackunicorn/bonklm-nestjs
 *
 * @example
 * ```typescript
 * import { Module } from '@nestjs/common';
 * import { GuardrailsModule } from '@blackunicorn/bonklm-nestjs';
 * import { PromptInjectionValidator, JailbreakValidator } from '@blackunicorn/bonklm';
 *
 * @Module({
 *   imports: [
 *     GuardrailsModule.forRoot({
 *       validators: [
 *         new PromptInjectionValidator(),
 *         new JailbreakValidator(),
 *       ],
 *       global: true,
 *       productionMode: process.env.NODE_ENV === 'production',
 *     }),
 *   ],
 * })
 * export class AppModule {}
 * ```
 */

// Module
export { GuardrailsModule } from './guardrails.module.js';

// Service
export { GuardrailsService } from './guardrails.service.js';

// Decorator
export { UseGuardrails, isUseGuardrailsOptions } from './use-guardrails.decorator.js';

// Interceptor
export { GuardrailsInterceptor } from './guardrails.interceptor.js';

// Types
export type {
  GuardrailsModuleOptions,
  GuardrailsModuleAsyncOptions,
  UseGuardrailsDecoratorOptions,
  GuardrailsRequest,
  GuardrailsExecutionContext
} from './types.js';

// Re-export core types for convenience
export type { Validator, Guard, GuardrailResult, Logger } from '@blackunicorn/bonklm';

// Re-export constants
export {
  USE_GUARDRAILS_KEY,
  DEFAULT_VALIDATION_TIMEOUT,
  DEFAULT_MAX_CONTENT_LENGTH,
  GUARDRAILS_OPTIONS,
  GUARDRAILS_SERVICE
} from './constants.js';
