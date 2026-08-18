/**
 * GuardrailsModule Tests
 * ======================
 * Unit tests for the GuardrailsModule.
 */

import { describe, it, expect, vi } from 'vitest';
import { GuardrailsModule } from '../src/index.js';
import { PromptInjectionValidator, JailbreakValidator, SecretGuard, PIIGuard } from '@blackunicorn/bonklm';

describe('GuardrailsModule', () => {
  describe('forRoot', () => {
    it('should create a dynamic module with default options', () => {
      const module = GuardrailsModule.forRoot();

      expect(module).toBeDefined();
      expect(module.module).toBe(GuardrailsModule);
      expect(module.providers).toBeDefined();
      expect(module.exports).toBeDefined();
    });

    it('should create a dynamic module with custom options', () => {
      const validators = [new PromptInjectionValidator(), new JailbreakValidator()];

      const guards = [new SecretGuard(), new PIIGuard()];

      const module = GuardrailsModule.forRoot({
        validators,
        guards,
        global: true,
        productionMode: true,
        validationTimeout: 3000,
        maxContentLength: 2048
      });

      expect(module.module).toBe(GuardrailsModule);
      expect(module.providers).toHaveLength(3); // options, service, APP_INTERCEPTOR
      expect(module.exports).toHaveLength(1); // service
    });

    it('should create a global module when global is true', () => {
      const module = GuardrailsModule.forRoot({
        global: true
      });

      expect(module.module).toBe(GuardrailsModule);
      expect(module.providers).toHaveLength(3);
    });
  });

  describe('forRootAsync', () => {
    it('should create an async dynamic module', () => {
      const module = GuardrailsModule.forRootAsync({
        useFactory: () => ({
          validators: [new PromptInjectionValidator()],
          guards: []
        }),
        inject: [],
        global: true
      });

      expect(module.module).toBe(GuardrailsModule);
      expect(module.providers).toHaveLength(3);
    });

    it('should support dependency injection', () => {
      const module = GuardrailsModule.forRootAsync({
        useFactory: (config: any) => ({
          validators: config.validators || [],
          guards: []
        }),
        inject: ['CONFIG'],
        global: false
      });

      const optionsProvider = module.providers![0];
      expect(optionsProvider.inject).toEqual(['CONFIG']);
    });
  });

  describe('forFeature', () => {
    it('should create a non-global feature module', () => {
      const module = GuardrailsModule.forFeature({
        validators: [new PromptInjectionValidator()],
        guards: []
      });

      expect(module.module).toBe(GuardrailsModule);
      expect(module.providers).toHaveLength(3); // options, service, interceptor
      expect(module.exports).toHaveLength(2); // service, interceptor
    });

    it('should export both service and interceptor', () => {
      const module = GuardrailsModule.forFeature();

      expect(module.exports).toHaveLength(2);
    });
  });

  describe('forFeatureAsync', () => {
    it('should create an async feature module', () => {
      const module = GuardrailsModule.forFeatureAsync({
        useFactory: () => ({
          validators: [new PromptInjectionValidator()],
          guards: []
        }),
        inject: []
      });

      expect(module.module).toBe(GuardrailsModule);
      expect(module.providers).toHaveLength(3);
      expect(module.exports).toHaveLength(2);
    });
  });

  describe('module options', () => {
    it('should accept validators array', () => {
      const validators = [new PromptInjectionValidator(), new JailbreakValidator(), new SecretGuard()];

      const module = GuardrailsModule.forRoot({ validators });

      expect(module).toBeDefined();
    });

    it('should accept guards array', () => {
      const guards = [new SecretGuard(), new PIIGuard()];

      const module = GuardrailsModule.forRoot({ guards });

      expect(module).toBeDefined();
    });

    it('should accept both validators and guards', () => {
      const validators = [new PromptInjectionValidator()];
      const guards = [new SecretGuard()];

      const module = GuardrailsModule.forRoot({ validators, guards });

      expect(module).toBeDefined();
    });

    it('should accept production mode flag', () => {
      const module = GuardrailsModule.forRoot({
        productionMode: true
      });

      expect(module).toBeDefined();
    });

    it('should accept validation timeout', () => {
      const module = GuardrailsModule.forRoot({
        validationTimeout: 10000
      });

      expect(module).toBeDefined();
    });

    it('should accept max content length', () => {
      const module = GuardrailsModule.forRoot({
        maxContentLength: 2048
      });

      expect(module).toBeDefined();
    });

    it('should accept custom error handler', () => {
      const onError = vi.fn();

      const module = GuardrailsModule.forRoot({
        onError
      });

      expect(module).toBeDefined();
    });

    it('should accept custom body extractor', () => {
      const bodyExtractor = vi.fn();

      const module = GuardrailsModule.forRoot({
        bodyExtractor
      });

      expect(module).toBeDefined();
    });

    it('should accept custom response extractor', () => {
      const responseExtractor = vi.fn();

      const module = GuardrailsModule.forRoot({
        responseExtractor
      });

      expect(module).toBeDefined();
    });
  });
});
