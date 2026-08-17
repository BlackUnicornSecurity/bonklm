/**
 * tsd type-surface suite — @blackunicorn/bonklm-elysia (ST-04-221).
 *
 * Locks the published public type surface (imports by package name): the
 * `bonklmGuardrails` plugin factory + its `BonklmElysiaOptions` config. The
 * Elysia app type is structural/internal, so the factory's plugin return is
 * asserted via arity + its public-options surface. The internal Elysia
 * context shape is referenced through `Parameters<...>` (GOTCHA 6) rather
 * than imported. Run via `pnpm exec tsd`. Lives in test-d/ (tsd's default dir).
 */
import { expectType, expectError, expectAssignable, expectNotAssignable } from 'tsd';
import type { GuardrailEngine } from '@blackunicorn/bonklm';
import { bonklmGuardrails, type BonklmElysiaOptions } from '@blackunicorn/bonklm-elysia';

declare const engine: GuardrailEngine;

// --- bonklmGuardrails factory: options.engine is required -------------------
expectError(bonklmGuardrails());
expectError(bonklmGuardrails({})); // engine missing
const plugin = bonklmGuardrails({ engine });
// The returned plugin is a unary `app -> app` function. The Elysia app type
// is internal/structural — assert it is callable returning a value.
expectAssignable<(app: never) => unknown>(plugin);

// --- BonklmElysiaOptions shape ----------------------------------------------
expectAssignable<BonklmElysiaOptions>({ engine });
expectAssignable<BonklmElysiaOptions>({
  engine,
  shouldValidate: (_body, _ctx) => true,
  onBlock: _event => {},
  onError: _err => {},
  blockedResponse: _event => ({ error: 'request_blocked' })
});
expectNotAssignable<BonklmElysiaOptions>({}); // engine required
expectNotAssignable<BonklmElysiaOptions>({ engine, shouldValidate: () => 'yes' }); // must return boolean

// --- shouldValidate signature: (body: string, ctx: <internal>) => boolean ---
type ShouldValidate = NonNullable<BonklmElysiaOptions['shouldValidate']>;
declare const shouldValidate: ShouldValidate;
expectType<boolean>(shouldValidate('body', {} as Parameters<ShouldValidate>[1]));
// The internal Elysia context shape, reached through the public option type.
expectAssignable<Parameters<ShouldValidate>[1]>({ body: 'x', set: { status: 403 }, request: { method: 'POST' } });

// --- onBlock receives a WebMiddlewareBlockEvent (kind discriminator locked) --
type OnBlock = NonNullable<BonklmElysiaOptions['onBlock']>;
expectAssignable<Parameters<OnBlock>[0]>({ kind: 'web-middleware', phase: 'request', reason: 'r' });
expectNotAssignable<Parameters<OnBlock>[0]>({ kind: 'durable-exec', phase: 'request', reason: 'r' });
