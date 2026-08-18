/**
 * tsd type-surface suite — @blackunicorn/bonklm-nextjs (ST-04-224).
 *
 * Locks the published public type surface (imports by package name) and proves
 * the three Next.js wrappers + their config typing. Run via `pnpm exec tsd`.
 * Lives in test-d/ so the vitest test files stay out of tsd's program.
 */
import { expectType, expectError, expectAssignable, expectNotAssignable } from 'tsd';
import type { GuardrailEngine } from '@blackunicorn/bonklm';
import {
  withBonklm,
  bonklmRouteHandler,
  bonklmEdgeMiddleware,
  type WithBonklmOptions,
  type ServerAction,
  type BonklmRouteHandlerOptions,
  type RouteHandlerMethods,
  type BonklmEdgeMiddlewareOptions
} from '@blackunicorn/bonklm-nextjs';

declare const engine: GuardrailEngine;

// --- withBonklm — generic preserves the wrapped action signature ------------
declare const action: ServerAction<[FormData], { ok: boolean }>;
expectType<ServerAction<[FormData], { ok: boolean }>>(withBonklm(action, { engine }));
expectError(withBonklm(action)); // options required
expectError(withBonklm(action, {})); // engine required
expectError(withBonklm('not-a-function', { engine }));

// --- bonklmRouteHandler -----------------------------------------------------
declare const handlers: RouteHandlerMethods;
expectType<RouteHandlerMethods>(bonklmRouteHandler(handlers, { engine }));
expectError(bonklmRouteHandler(handlers)); // options required
expectError(bonklmRouteHandler(handlers, {})); // engine required

// --- bonklmEdgeMiddleware ---------------------------------------------------
expectType<(req: Request) => Promise<Response>>(bonklmEdgeMiddleware({ engine }));
expectError(bonklmEdgeMiddleware()); // options required
expectError(bonklmEdgeMiddleware({})); // engine required

// --- ServerAction -----------------------------------------------------------
expectAssignable<ServerAction<[string], number>>(async (_s: string) => 1);
expectNotAssignable<ServerAction<[string], number>>((_s: string) => 1); // must return a Promise

// --- option shapes ----------------------------------------------------------
expectAssignable<WithBonklmOptions>({ engine });
expectAssignable<WithBonklmOptions>({
  engine,
  shouldValidate: s => s.length > 0,
  onBlock: event => void event,
  onError: err => void err
});
expectNotAssignable<WithBonklmOptions>({}); // engine required

expectAssignable<BonklmRouteHandlerOptions>({ engine });
expectAssignable<BonklmRouteHandlerOptions>({ engine, blockedResponse: _event => new Response(null, { status: 403 }) });
expectNotAssignable<BonklmRouteHandlerOptions>({}); // engine required

expectAssignable<BonklmEdgeMiddlewareOptions>({ engine });
expectAssignable<BonklmEdgeMiddlewareOptions>({
  engine,
  nextResponse: () => new Response(null),
  shouldValidate: _req => true
});
expectNotAssignable<BonklmEdgeMiddlewareOptions>({}); // engine required

// --- RouteHandlerMethods (all method keys optional) -------------------------
expectAssignable<RouteHandlerMethods>({});
expectAssignable<RouteHandlerMethods>({ POST: async (_req: Request) => new Response(null) });
expectNotAssignable<RouteHandlerMethods>({ POST: (_req: Request) => new Response(null) }); // must return Promise<Response>
