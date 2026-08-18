/**
 * tsd type-surface suite — @blackunicorn/bonklm-letta (ST-04-234).
 *
 * Locks the published public type surface (imports by package name):
 * the generic `wrapLettaClient` factory (client type `TClient` is
 * preserved, not widened, and bounded by `extends object`), the
 * `buildLettaAdapter` factory (this barrel exposes NO module-scope
 * adapter const — unlike mem0), the re-exported `WrapMemoryClientOptions`
 * type (whose `getTenantId` is REQUIRED and must be a function —
 * adversarial #4), and the re-exported `ConnectorValidationError` value.
 * `GetTenantId` / `MemoryAdapter` are imported from
 * `@blackunicorn/bonklm-memory-utils`. Run via `pnpm exec tsd`.
 */
import { expectType, expectError, expectAssignable, expectNotAssignable } from 'tsd';
import type { GuardrailEngine } from '@blackunicorn/bonklm';
import type { GetTenantId, MemoryAdapter } from '@blackunicorn/bonklm-memory-utils';
import {
  wrapLettaClient,
  buildLettaAdapter,
  ConnectorValidationError,
  type WrapMemoryClientOptions
} from '@blackunicorn/bonklm-letta';

declare const engine: GuardrailEngine;
declare const getTenantId: GetTenantId;
declare const options: WrapMemoryClientOptions;

// --- wrapLettaClient: generic <TClient extends object>, preserves client type
declare const client: { agents: { messages: unknown }; extra: number };
expectType<{ agents: { messages: unknown }; extra: number }>(wrapLettaClient(client, engine, options));
// Discriminating control: a preserved `TClient` carries `extra: number`.
expectAssignable<{ extra: number }>(wrapLettaClient(client, engine, options));
expectNotAssignable<{ extra: string }>(wrapLettaClient(client, engine, options));
expectError(wrapLettaClient(client, engine)); // options required (3rd positional)
expectError(wrapLettaClient(client)); // engine + options required
expectError(wrapLettaClient(client, engine, {})); // getTenantId required in options
expectError(wrapLettaClient('nope', engine, options)); // TClient extends object — primitive rejected

// --- buildLettaAdapter (no module-scope adapter const in this barrel) -------
expectType<MemoryAdapter>(buildLettaAdapter(getTenantId));
expectError(buildLettaAdapter()); // getTenantId required
expectError(buildLettaAdapter('literal')); // getTenantId must be a function

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

// --- GetTenantId / MemoryAdapter (letta's call surface, owned by memory-utils)
expectAssignable<GetTenantId>((_ctx: unknown) => 'tenant');
expectNotAssignable<GetTenantId>((_ctx: unknown) => 123); // must return string
expectAssignable<MemoryAdapter>({
  vendor: 'letta',
  methods: new Set<string>(),
  route: () => ({ surface: null })
});
expectNotAssignable<MemoryAdapter>({ vendor: 'letta' }); // methods + route required

// --- ConnectorValidationError (re-exported value) ---------------------------
const cve = new ConnectorValidationError('msg');
expectType<ConnectorValidationError>(cve);
expectType<string>(cve.category);
expectType<number | undefined>(cve.statusCode);
new ConnectorValidationError('m', 'configuration_error', 400);
expectError(new ConnectorValidationError()); // message required
