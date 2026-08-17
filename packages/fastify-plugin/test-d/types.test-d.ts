/**
 * tsd type-surface suite — @blackunicorn/bonklm-fastify (ST-04-218).
 *
 * Locks the published public type surface (imports by package name) and proves
 * the plugin factory + config typing. Run via `pnpm exec tsd`.
 * Lives in test-d/ so the vitest test files stay out of tsd's program.
 */
import { expectType, expectAssignable, expectNotAssignable } from 'tsd';
import type { FastifyPluginAsync, FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import type { GuardrailResult } from '@blackunicorn/bonklm';
import bonklmFastifyPlugin, { guardrailsPlugin } from '@blackunicorn/bonklm-fastify';
import type {
  GuardrailsPluginOptions,
  GuardrailsRequest,
  ErrorHandler,
  ResponseExtractor
} from '@blackunicorn/bonklm-fastify';

// --- plugin: named export is a typed FastifyPluginAsync; default is the same plugin
expectType<FastifyPluginAsync<GuardrailsPluginOptions>>(guardrailsPlugin);
expectAssignable<FastifyPluginAsync<GuardrailsPluginOptions> | FastifyPluginCallback<GuardrailsPluginOptions>>(
  bonklmFastifyPlugin
);

// --- GuardrailsPluginOptions shape ------------------------------------------
expectAssignable<GuardrailsPluginOptions>({});
expectAssignable<GuardrailsPluginOptions>({
  validateRequest: true,
  validateResponse: false,
  paths: ['/api/ai'],
  excludePaths: ['/health'],
  productionMode: true,
  validationTimeout: 5000,
  maxContentLength: 1_048_576,
  enableSessionTracking: false
});
expectNotAssignable<GuardrailsPluginOptions>({ validateRequest: 'yes' });
expectNotAssignable<GuardrailsPluginOptions>({ bodyExtractor: () => 'x' }); // deprecated to `never`

// --- exported function-type aliases -----------------------------------------
expectAssignable<ErrorHandler>((_result: GuardrailResult, _req: FastifyRequest, _reply: FastifyReply) => {});
expectAssignable<ErrorHandler>(async () => {});
expectAssignable<ResponseExtractor>((_payload: unknown) => 'text');
expectNotAssignable<ResponseExtractor>((_payload: unknown) => 42); // must return string

// --- GuardrailsRequest augmented shape --------------------------------------
declare const gr: GuardrailsRequest;
expectType<boolean | undefined>(gr._guardrailsValidated);
expectType<GuardrailResult[] | undefined>(gr._guardrailsResults);
