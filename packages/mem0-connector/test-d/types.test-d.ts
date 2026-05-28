/**
 * tsd type-surface suite — @blackunicorn/bonklm-mem0 (ST-04-235).
 *
 * Locks the published public type surface (imports by package name):
 * the generic `wrapMem0Client` factory (client type `TClient` is
 * preserved, not widened, and bounded by `extends object`), the
 * `buildMem0Adapter` factory + module-scope `mem0Adapter` const, the
 * re-exported `WrapMemoryClientOptions` type (whose `getTenantId` is
 * REQUIRED and must be a function — adversarial #4), and the re-exported
 * `ConnectorValidationError` value. `GetTenantId` / `MemoryAdapter` are
 * NOT in this barrel — imported from `@blackunicorn/bonklm-memory-utils`
 * (the call surface they parameterise). Run via `pnpm exec tsd`.
 */
import { expectType, expectError, expectAssignable, expectNotAssignable } from 'tsd';
import type { GuardrailEngine } from '@blackunicorn/bonklm';
import type { GetTenantId, MemoryAdapter } from '@blackunicorn/bonklm-memory-utils';
import {
  wrapMem0Client,
  buildMem0Adapter,
  mem0Adapter,
  ConnectorValidationError,
  type WrapMemoryClientOptions
} from '@blackunicorn/bonklm-mem0';

declare const engine: GuardrailEngine;
declare const getTenantId: GetTenantId;
declare const options: WrapMemoryClientOptions;

// --- wrapMem0Client: generic <TClient extends object>, preserves client type
declare const client: { search(q: string): Promise<unknown>; extra: number };
expectType<{ search(q: string): Promise<unknown>; extra: number }>(wrapMem0Client(client, engine, options));
// Discriminating control: a preserved `TClient` carries `extra: number`.
expectAssignable<{ extra: number }>(wrapMem0Client(client, engine, options));
expectNotAssignable<{ extra: string }>(wrapMem0Client(client, engine, options));
expectError(wrapMem0Client(client, engine)); // options required (3rd positional)
expectError(wrapMem0Client(client)); // engine + options required
expectError(wrapMem0Client(client, engine, {})); // getTenantId required in options
expectError(wrapMem0Client('nope', engine, options)); // TClient extends object — primitive rejected

// --- buildMem0Adapter + mem0Adapter -----------------------------------------
expectType<MemoryAdapter>(buildMem0Adapter(getTenantId));
expectType<MemoryAdapter>(mem0Adapter);
expectError(buildMem0Adapter()); // getTenantId required
expectError(buildMem0Adapter('literal')); // getTenantId must be a function

// --- WrapMemoryClientOptions (getTenantId REQUIRED + must be a function) -----
expectAssignable<WrapMemoryClientOptions>({ getTenantId });
expectAssignable<WrapMemoryClientOptions>({
  getTenantId,
  getSessionContext: () => ({}),
  validators: [],
  logger: undefined
});
expectNotAssignable<WrapMemoryClientOptions>({}); // getTenantId required
expectNotAssignable<WrapMemoryClientOptions>({ getTenantId: 'literal' }); // adversarial #4: must be a function

// --- GetTenantId / MemoryAdapter (mem0's call surface, owned by memory-utils)
expectAssignable<GetTenantId>((_ctx: unknown) => 'tenant');
expectNotAssignable<GetTenantId>((_ctx: unknown) => 123); // must return string
expectAssignable<MemoryAdapter>({
  vendor: 'mem0',
  methods: new Set<string>(),
  route: () => ({ surface: null })
});
expectNotAssignable<MemoryAdapter>({ vendor: 'mem0' }); // methods + route required

// --- ConnectorValidationError (re-exported value) ---------------------------
const cve = new ConnectorValidationError('msg');
expectType<ConnectorValidationError>(cve);
expectType<string>(cve.category);
expectType<number | undefined>(cve.statusCode);
new ConnectorValidationError('m', 'configuration_error', 400);
expectError(new ConnectorValidationError()); // message required
