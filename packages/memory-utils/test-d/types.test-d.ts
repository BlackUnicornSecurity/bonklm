/**
 * tsd type-surface suite — @blackunicorn/bonklm-memory-utils (ST-04-246).
 *
 * Locks the published public type surface (imports by package name, so it
 * resolves the package `types` entry exactly as a consumer would) and proves
 * the signatures reject misuse. Run with `pnpm exec tsd` from the package dir.
 * Lives in test-d/ (tsd's default dir) so vitest test files stay out of scope.
 */
import { expectType, expectError, expectAssignable, expectNotAssignable } from 'tsd';
import type { GuardrailEngine } from '@blackunicorn/bonklm';
import {
  wrapMemoryClient,
  assertGetTenantIdValid,
  assertTenantIdSafe,
  ConnectorValidationError,
  type AdapterInvocation,
  type AdapterRoute,
  type GetTenantId,
  type MemoryAdapter,
  type MemorySessionContext,
  type MemorySurface,
  type WrapMemoryClientFullOptions,
  type WrapMemoryClientOptions
} from '@blackunicorn/bonklm-memory-utils';

declare const engine: GuardrailEngine;
declare const adapter: MemoryAdapter;

interface DummyClient {
  add(content: string): Promise<void>;
}
declare const client: DummyClient;
declare const fullOpts: WrapMemoryClientFullOptions<DummyClient>;

// --- wrapMemoryClient — generic preserves the wrapped client type -----------
expectType<DummyClient>(wrapMemoryClient(client, { getTenantId: () => 't', adapter, engine }));
expectType<DummyClient>(wrapMemoryClient(client, fullOpts));
expectError(wrapMemoryClient(client, {})); // getTenantId / adapter / engine required
expectError(wrapMemoryClient(client)); // options required
expectError(wrapMemoryClient('not-an-object', { getTenantId: () => 't', adapter, engine })); // TClient extends object

// --- assertion helpers (asserts ... is ... → void return) -------------------
expectType<void>(assertGetTenantIdValid(() => 't', 'Mem0'));
expectType<void>(assertTenantIdSafe('tenant-1', 'Mem0'));
expectError(assertGetTenantIdValid(() => 't')); // vendorName required
expectError(assertTenantIdSafe('tenant-1')); // vendorName required

// --- ConnectorValidationError (re-export from core) -------------------------
expectAssignable<Error>(new ConnectorValidationError('reason', 'configuration_error'));

// --- exported type shapes ---------------------------------------------------
expectAssignable<GetTenantId>((_ctx: MemorySessionContext) => 'tenant');
expectNotAssignable<GetTenantId>('fixed-string'); // adversarial #4: a literal string is not a callback

expectAssignable<MemorySurface>('memory_write');
expectAssignable<MemorySurface>('composed_context');
expectNotAssignable<MemorySurface>('admin');

expectAssignable<AdapterRoute>({ surface: null });
expectAssignable<AdapterRoute>({ surface: 'memory_write', writeContent: 'x' });
expectAssignable<AdapterRoute>({ surface: 'composed_context', composedEntries: ['a'], rewriteArgs: [] });

expectAssignable<AdapterInvocation>({ method: 'add', args: ['x'], ctx: undefined });

expectAssignable<WrapMemoryClientOptions>({ getTenantId: () => 't' });
expectNotAssignable<WrapMemoryClientOptions>({}); // getTenantId required
expectAssignable<WrapMemoryClientFullOptions<DummyClient>>({ getTenantId: () => 't', adapter, engine });

expectAssignable<MemoryAdapter>({
  vendor: 'mem0',
  methods: new Set<string>(['add']),
  route: (_invocation: AdapterInvocation): AdapterRoute => ({ surface: null })
});
