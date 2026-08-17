/**
 * tsd type-surface suite — @blackunicorn/bonklm-express (ST-04-217).
 *
 * Locks the published public type surface (imports by package name) and proves
 * the Express middleware factory's signature + config typing. Run via `pnpm exec tsd`.
 * Lives in test-d/ so the vitest test files stay out of tsd's program.
 */
import { expectType, expectError, expectAssignable, expectNotAssignable } from 'tsd';
import type { Response, NextFunction } from 'express';
import { createGuardrailsMiddleware } from '@blackunicorn/bonklm-express';
import type {
  GuardrailsMiddlewareConfig,
  GuardrailsRequest,
  ErrorHandler,
  BodyExtractor
} from '@blackunicorn/bonklm-express';

// --- factory: optional config, returns an Express middleware ----------------
type ExpressMw = (req: GuardrailsRequest, res: Response, next: NextFunction) => void;
expectType<ExpressMw>(createGuardrailsMiddleware());
expectType<ExpressMw>(createGuardrailsMiddleware({ validateRequest: true, validationTimeout: 1000 }));
expectError(createGuardrailsMiddleware({ notAConfigKey: true }));

// --- GuardrailsMiddlewareConfig shape ---------------------------------------
expectAssignable<GuardrailsMiddlewareConfig>({});
expectAssignable<GuardrailsMiddlewareConfig>({
  validateRequest: true,
  validateResponse: false,
  validateResponseMode: 'buffer',
  onRequestOnly: true,
  paths: ['/api/ai'],
  excludePaths: ['/health'],
  productionMode: true,
  validationTimeout: 5000,
  maxContentLength: 1_048_576,
  enableSessionTracking: false
});
expectNotAssignable<GuardrailsMiddlewareConfig>({ validateResponseMode: 'stream' });
expectNotAssignable<GuardrailsMiddlewareConfig>({ validateRequest: 'yes' });

// --- exported function-type aliases -----------------------------------------
expectAssignable<ErrorHandler>((_result, _req, _res) => {});
expectAssignable<BodyExtractor>(_req => 'text');
expectAssignable<BodyExtractor>(_req => ['a', 'b']);
expectNotAssignable<BodyExtractor>(42); // not a function

// --- GuardrailsRequest augmented shape ---------------------------------------
declare const gr: GuardrailsRequest;
expectType<string>(gr.path);
expectType<boolean | undefined>(gr._guardrailsValidated);
