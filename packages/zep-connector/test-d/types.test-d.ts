/**
 * Type-surface tests for `@blackunicorn/bonklm-zep`.
 *
 * Locks the public type contract exported from the package barrel:
 *   - `wrapZepClient<TClient extends ZepClientLike>(client, engine, options)`
 *     — a GENERIC factory that PRESERVES the concrete client type. All three
 *     positional args are REQUIRED (the barrel JSDoc shows `options?` but the
 *     implementation signature requires it). `ZepClientLike` is NOT exported;
 *     its `{ thread?: object; graph?: object }` shape is exercised via the
 *     bound-rejection checks below.
 *   - `buildZepAdapter(getTenantId)` → `MemoryAdapter`.
 *   - Re-exports: `WrapMemoryClientOptions` (type, from memory-utils) and
 *     `ConnectorValidationError` (from core connector-utils).
 *
 * Helper types `GuardrailEngine` / `GetTenantId` / `MemoryAdapter` are imported
 * from their canonical packages (not the zep barrel).
 *
 * Run via `pnpm --filter @blackunicorn/bonklm-zep test:types` (tsd).
 */
import { expectType, expectError, expectAssignable, expectNotAssignable } from 'tsd';
import type { GuardrailEngine } from '@blackunicorn/bonklm';
import type { GetTenantId, MemoryAdapter } from '@blackunicorn/bonklm-memory-utils';
import {
  wrapZepClient,
  buildZepAdapter,
  ConnectorValidationError,
  type WrapMemoryClientOptions
} from '@blackunicorn/bonklm-zep';

declare const engine: GuardrailEngine;
declare const getTenantId: GetTenantId;
declare const options: WrapMemoryClientOptions;

// --- wrapZepClient<TClient extends ZepClientLike>(client, engine, options) ---
// Generic preserves the concrete client type (thread/graph namespaces + any
// extra vendor fields the consumer's client carries).
declare const client: { thread: object; graph: object; extra: number };
expectType<{ thread: object; graph: object; extra: number }>(wrapZepClient(client, engine, options));
expectAssignable<{ extra: number }>(wrapZepClient(client, engine, options));
expectNotAssignable<{ extra: string }>(wrapZepClient(client, engine, options)); // discriminating control

// Arity / required-arg enforcement (all 3 positional args required).
expectError(wrapZepClient(client, engine)); // options required
expectError(wrapZepClient(client)); // engine + options required
expectError(wrapZepClient(client, engine, {})); // getTenantId required in options

// Bound rejection: a client whose `thread` is present but not an object
// violates `ZepClientLike` (structural); a primitive has no properties in
// common with the weak `ZepClientLike` type and is likewise rejected.
expectError(wrapZepClient({ thread: 'not-an-object' }, engine, options));
expectError(wrapZepClient('nope', engine, options));

// --- buildZepAdapter(getTenantId) ---
expectType<MemoryAdapter>(buildZepAdapter(getTenantId));
expectError(buildZepAdapter()); // getTenantId required
expectError(buildZepAdapter('literal')); // must be a function

// --- WrapMemoryClientOptions (re-exported type) ---
expectAssignable<WrapMemoryClientOptions>({ getTenantId });
expectNotAssignable<WrapMemoryClientOptions>({}); // getTenantId required
expectNotAssignable<WrapMemoryClientOptions>({ getTenantId: 'literal' }); // must be a function

// --- GetTenantId helper contract ---
expectAssignable<GetTenantId>((_ctx: unknown) => 'tenant');
expectNotAssignable<GetTenantId>((_ctx: unknown) => 123); // must return string

// --- MemoryAdapter helper contract ---
expectAssignable<MemoryAdapter>({
  vendor: 'zep',
  methods: new Set<string>(),
  route: () => ({ surface: null })
});
expectNotAssignable<MemoryAdapter>({ vendor: 'zep' }); // methods + route required

// --- ConnectorValidationError (re-exported from core connector-utils) ---
const cve = new ConnectorValidationError('msg');
expectType<ConnectorValidationError>(cve);
expectType<string>(cve.category);
expectType<number | undefined>(cve.statusCode);
new ConnectorValidationError('m', 'configuration_error', 400);
expectError(new ConnectorValidationError()); // message required
