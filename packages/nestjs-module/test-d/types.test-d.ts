/**
 * tsd type-surface suite — @blackunicorn/bonklm-nestjs (ST-04-219).
 *
 * Locks the published public type surface (imports by package name) — the
 * module/service/interceptor, the decorator, the DI-token constants, the
 * config types, and the re-exported core types. Run via `pnpm exec tsd`.
 * Lives in test-d/ so the vitest test files stay out of tsd's program.
 */
import { expectType, expectError, expectAssignable, expectNotAssignable } from 'tsd';
import type { DynamicModule, ExecutionContext } from '@nestjs/common';
import type { AttackLogger } from '@blackunicorn/bonklm-logger';
import {
  GuardrailsModule,
  GuardrailsService,
  GuardrailsInterceptor,
  UseGuardrails,
  isUseGuardrailsOptions,
  USE_GUARDRAILS_KEY,
  DEFAULT_VALIDATION_TIMEOUT,
  DEFAULT_MAX_CONTENT_LENGTH,
  GUARDRAILS_OPTIONS,
  GUARDRAILS_SERVICE,
  type GuardrailsModuleOptions,
  type GuardrailsModuleAsyncOptions,
  type UseGuardrailsDecoratorOptions,
  type GuardrailsRequest,
  type GuardrailsExecutionContext,
  type Validator,
  type Guard,
  type GuardrailResult,
  type Logger
} from '@blackunicorn/bonklm-nestjs';

// --- classes are exported as constructors -----------------------------------
expectAssignable<new (...args: any[]) => GuardrailsService>(GuardrailsService);
expectAssignable<new (...args: any[]) => GuardrailsInterceptor>(GuardrailsInterceptor);

// --- GuardrailsModule static factories return Nest DynamicModule ------------
expectType<DynamicModule>(GuardrailsModule.forRoot());
expectType<DynamicModule>(GuardrailsModule.forRoot({ global: true }));
expectType<DynamicModule>(GuardrailsModule.forRootAsync({ useFactory: () => ({}) }));
expectError(GuardrailsModule.forRoot({ global: 'yes' })); // global is boolean
expectError(GuardrailsModule.forRootAsync({})); // useFactory required

// --- @UseGuardrails() decorator factory + type guard ------------------------
expectType<MethodDecorator & ClassDecorator>(UseGuardrails());
expectType<MethodDecorator & ClassDecorator>(UseGuardrails({ validateInput: true, validateOutput: false }));
expectError(UseGuardrails({ validateInput: 'yes' }));
declare const u: unknown;
expectType<boolean>(isUseGuardrailsOptions(u));
expectError(isUseGuardrailsOptions()); // value required

// --- DI-token + default constants (literal types) ---------------------------
expectType<'llm_guardrails'>(USE_GUARDRAILS_KEY);
expectType<5000>(DEFAULT_VALIDATION_TIMEOUT);
expectType<number>(DEFAULT_MAX_CONTENT_LENGTH); // `1024 * 1024` widens to number
expectType<'GUARDRAILS_OPTIONS'>(GUARDRAILS_OPTIONS);
expectType<'GUARDRAILS_SERVICE'>(GUARDRAILS_SERVICE);

// --- config type shapes (also exercises the re-exported core types) ---------
declare const validators: Validator[];
declare const guards: Guard[];
declare const logger: Logger;
declare const attackLogger: AttackLogger;
expectAssignable<GuardrailsModuleOptions>({});
expectAssignable<GuardrailsModuleOptions>({
  validators,
  guards,
  logger,
  global: true,
  productionMode: true,
  validationTimeout: 5000,
  maxContentLength: 1_048_576,
  enableSessionTracking: false,
  onError: (_result: GuardrailResult, _ctx: ExecutionContext) => {},
  bodyExtractor: (_request: unknown) => 'text',
  responseExtractor: (_response: unknown) => 'text',
  sessionIdExtractor: (_request: unknown) => 'session-id',
  attackLogger
});
expectNotAssignable<GuardrailsModuleOptions>({ global: 'yes' });

expectAssignable<GuardrailsModuleAsyncOptions>({ useFactory: () => ({}) });
expectAssignable<GuardrailsModuleAsyncOptions>({
  useFactory: async () => ({ global: true }),
  inject: [],
  global: true
});
expectNotAssignable<GuardrailsModuleAsyncOptions>({}); // useFactory required

expectAssignable<UseGuardrailsDecoratorOptions>({});
expectAssignable<UseGuardrailsDecoratorOptions>({
  validateInput: true,
  validateOutput: false,
  bodyField: 'message',
  responseField: 'reply',
  maxContentLength: 1000
});
expectNotAssignable<UseGuardrailsDecoratorOptions>({ validateInput: 'yes' });

// --- GuardrailsRequest + GuardrailsExecutionContext -------------------------
declare const greq: GuardrailsRequest;
expectType<boolean | undefined>(greq._guardrailsValidated);
expectType<GuardrailResult[] | undefined>(greq._guardrailsResults);

declare const gec: GuardrailsExecutionContext;
expectAssignable<ExecutionContext>(gec);
expectType<GuardrailsRequest>(gec.getRequest());
