/**
 * tsd type-surface suite — @blackunicorn/bonklm-hono (ST-04-220).
 *
 * Locks the published public type surface (imports by package name) and proves
 * the middleware factory + body extractor + config typing. Run via `pnpm exec tsd`.
 * Lives in test-d/ so the vitest test files stay out of tsd's program.
 */
import { expectType, expectError, expectAssignable, expectNotAssignable } from 'tsd';
import type { GuardrailEngine } from '@blackunicorn/bonklm';
import {
  honoGuardrails,
  ConnectorValidationError,
  extractBody,
  type ExtractedBody,
  type HonoContextLike,
  type HonoGuardrailsErrorResponse,
  type HonoGuardrailsOptions,
  type HonoMiddlewareHandler,
  type HonoNext
} from '@blackunicorn/bonklm-hono';

declare const engine: GuardrailEngine;

// --- honoGuardrails: optional config, returns a Hono MiddlewareHandler ------
expectType<HonoMiddlewareHandler>(honoGuardrails(engine));
expectType<HonoMiddlewareHandler>(honoGuardrails(engine, { productionMode: true }));
expectError(honoGuardrails()); // engine required
expectError(honoGuardrails(engine, { bodyFields: 'message' })); // bodyFields must be string[]

// --- extractBody ------------------------------------------------------------
declare const req: Request;
expectType<Promise<ExtractedBody>>(extractBody(req));
expectType<Promise<ExtractedBody>>(extractBody(req, ['message', 'prompt']));
expectError(extractBody()); // req required

// --- ConnectorValidationError (re-export) -----------------------------------
expectAssignable<Error>(new ConnectorValidationError('reason', 'validation_failed'));

// --- exported type shapes ---------------------------------------------------
expectAssignable<ExtractedBody>({ text: 'x' });
expectAssignable<ExtractedBody>({ text: 'x', fields: { a: 'b' }, charsetUnsupported: false });
expectNotAssignable<ExtractedBody>({}); // text required

expectAssignable<HonoGuardrailsOptions>({});
expectAssignable<HonoGuardrailsOptions>({
  bodyFields: ['message'],
  validateMethods: ['POST', 'PUT'],
  productionMode: true,
  onBlocked: (reason, category) => void [reason, category]
});
expectNotAssignable<HonoGuardrailsOptions>({ productionMode: 'yes' });

expectAssignable<HonoGuardrailsErrorResponse>({ error: 'e', category: 'c' });
expectAssignable<HonoGuardrailsErrorResponse>({ error: 'e', category: 'c', severity: 's' });
expectNotAssignable<HonoGuardrailsErrorResponse>({ error: 'e' }); // category required

expectAssignable<HonoNext>(() => Promise.resolve());
expectNotAssignable<HonoNext>(() => 'sync'); // must return Promise<void>

// --- HonoMiddlewareHandler + HonoContextLike --------------------------------
declare const ctx: HonoContextLike;
declare const next: HonoNext;
declare const mw: HonoMiddlewareHandler;
expectType<Promise<Response | void>>(mw(ctx, next));
expectType<string>(ctx.req.method);
