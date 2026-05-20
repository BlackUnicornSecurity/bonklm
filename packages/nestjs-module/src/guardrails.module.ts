/**
 * NestJS Guardrails Module
 * =========================
 * Dynamic module for configuring LLM guardrails in NestJS applications.
 *
 * @package @blackunicorn/bonklm-nestjs
 */

import {
  DynamicModule,
  Module,
  Provider,
} from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import type {
  GuardrailsModuleAsyncOptions,
  GuardrailsModuleOptions,
} from './types.js';
import { GuardrailsService } from './guardrails.service.js';
import { GuardrailsInterceptor } from './guardrails.interceptor.js';
import {
  GUARDRAILS_OPTIONS,
} from './constants.js';

/**
 * NestJS Module for BonkLM integration.
 *
 * This module provides:
 * - GuardrailsService: Service for validating content
 * - GuardrailsInterceptor: Interceptor for automatic validation
 * - @UseGuardrails() decorator: Marks endpoints for validation
 *
 * @example
 * ```typescript
 * import { Module } from '@nestjs/common';
 * import { GuardrailsModule } from '@blackunicorn/bonklm-nestjs';
 * import { PromptInjectionValidator } from '@blackunicorn/bonklm';
 *
 * @Module({
 *   imports: [
 *     GuardrailsModule.forRoot({
 *       validators: [new PromptInjectionValidator()],
 *       global: true,
 *     }),
 *   ],
 * })
 * export class AppModule {}
 * ```
 *
 * @example
 * ```typescript
 * // Async configuration
 * @Module({
 *   imports: [
 *     GuardrailsModule.forRootAsync({
 *       useFactory: (config: ConfigService) => ({
 *         validators: config.get('validators'),
 *         productionMode: config.get('NODE_ENV') === 'production',
 *       }),
 *       inject: [ConfigService],
 *       global: true,
 *     }),
 *   ],
 * })
 * export class AppModule {}
 * ```
 */
@Module({})
export class GuardrailsModule {
  /**
   * Configure the module with static options.
   *
   * @param options - Module configuration options
   * @returns Dynamic module configuration
   */
  static forRoot(options: GuardrailsModuleOptions = {}): DynamicModule {
    const optionsProvider: Provider = {
      provide: GUARDRAILS_OPTIONS,
      useValue: options,
    };

    return {
      module: GuardrailsModule,
      providers: [
        optionsProvider,
        GuardrailsService,
        {
          provide: APP_INTERCEPTOR,
          useClass: GuardrailsInterceptor,
        },
      ],
      exports: [GuardrailsService],
      global: options.global ?? false,
    };
  }

  /**
   * Configure the module with async options.
   *
   * @param options - Async module configuration options
   * @returns Dynamic module configuration
   */
  static forRootAsync(options: GuardrailsModuleAsyncOptions): DynamicModule {
    const optionsProvider: Provider = {
      provide: GUARDRAILS_OPTIONS,
      useFactory: options.useFactory,
      inject: options.inject || [],
    };

    return {
      module: GuardrailsModule,
      providers: [
        optionsProvider,
        GuardrailsService,
        {
          provide: APP_INTERCEPTOR,
          useClass: GuardrailsInterceptor,
        },
      ],
      exports: [GuardrailsService],
      global: options.global ?? false,
    };
  }

  /**
   * Register the module without global interceptor.
   *
   * Use this when you want to manually apply the interceptor to specific
   * controllers using @UseGuards() or @UseInterceptors().
   *
   * @param options - Module configuration options
   * @returns Dynamic module configuration
   */
  static forFeature(options: GuardrailsModuleOptions = {}): DynamicModule {
    const optionsProvider: Provider = {
      provide: GUARDRAILS_OPTIONS,
      useValue: options,
    };

    return {
      module: GuardrailsModule,
      providers: [
        optionsProvider,
        GuardrailsService,
        GuardrailsInterceptor,
      ],
      exports: [GuardrailsService, GuardrailsInterceptor],
    };
  }

  /**
   * Register the module with async options without global interceptor.
   *
   * @param options - Async module configuration options
   * @returns Dynamic module configuration
   */
  static forFeatureAsync(options: GuardrailsModuleAsyncOptions): DynamicModule {
    const optionsProvider: Provider = {
      provide: GUARDRAILS_OPTIONS,
      useFactory: options.useFactory,
      inject: options.inject || [],
    };

    return {
      module: GuardrailsModule,
      providers: [
        optionsProvider,
        GuardrailsService,
        GuardrailsInterceptor,
      ],
      exports: [GuardrailsService, GuardrailsInterceptor],
    };
  }
}

/**
 * Re-export types for convenience.
 */
export type {
  GuardrailsModuleOptions,
  GuardrailsModuleAsyncOptions,
  UseGuardrailsDecoratorOptions,
  GuardrailsRequest,
  GuardrailsExecutionContext,
} from './types.js';

/**
 * Re-export decorator for convenience.
 */
export { UseGuardrails, isUseGuardrailsOptions } from './use-guardrails.decorator.js';

/**
 * Re-export interceptor for manual application.
 */
export { GuardrailsInterceptor } from './guardrails.interceptor.js';

/**
 * Re-export service for direct injection.
 */
export { GuardrailsService } from './guardrails.service.js';

/**
 * Re-export core types from @blackunicorn/bonklm.
 */
export type {
  Validator,
  Guard,
  GuardrailResult,
  Logger,
} from '@blackunicorn/bonklm';
