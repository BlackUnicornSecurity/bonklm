# @blackunicorn/bonklm-memory-utils

> Shared memory-client wrapping primitives for BonkLM — consumed by `mem0`, `zep`, `letta`, and
> future vendor connectors.

## Audience

**Building-block — consumed by connectors.** Direct end-users should prefer a per-vendor wrapper
(`@blackunicorn/bonklm-mem0`, `@blackunicorn/bonklm-zep`, `@blackunicorn/bonklm-letta`). This
package exposes the generic `wrapMemoryClient` factory + the `MemoryAdapter` contract that each
vendor connector implements.

## Installation

```bash
pnpm add @blackunicorn/bonklm-memory-utils @blackunicorn/bonklm
```

## Peer Dependencies

| Package                | Version       | Notes                                                                                            |
| ---------------------- | ------------- | ------------------------------------------------------------------------------------------------ |
| `@blackunicorn/bonklm` | `workspace:*` | Direct dependency (not a peer).                                                                  |
| Node.js                | `>=20.4.0`    | Edge-runtime conditions (`workerd`, `edge-light`, `deno`, `bun`) all resolve to the same bundle. |

## Quick Start (writing a new vendor connector)

```typescript
import { wrapMemoryClient, type MemoryAdapter } from '@blackunicorn/bonklm-memory-utils';
import type { GuardrailEngine } from '@blackunicorn/bonklm';

const myVendorAdapter: MemoryAdapter = {
  vendor: 'my-vendor',
  methods: new Set(['store', 'recall']),
  route(invocation) {
    if (invocation.method === 'store') {
      return { surface: 'memory_write', writeContent: String(invocation.args[0]) };
    }
    return { surface: null }; // pass-through
  },
  async validateResult(invocation, result, helpers) {
    if (invocation.method === 'recall' && Array.isArray(result)) {
      await helpers.runComposedContextValidator(result as string[]);
    }
  }
};

export function wrapMyVendorClient(client: object, engine: GuardrailEngine, options) {
  return wrapMemoryClient(client, {
    ...options,
    adapter: myVendorAdapter,
    engine
  });
}
```

## API Reference

### `wrapMemoryClient(client, options)`

Generic `Proxy`-based factory. Wraps any vendor memory client and routes method calls through a
`MemoryAdapter` to BonkLM's `memory_write` / `composed_context` surfaces.

Routing model (see `src/wrap-memory-client.ts`):

1. Consumer calls `client.foo(args)` → Proxy `get` returns a wrapped function.
2. Wrapped fn calls `adapter.route({ method, args, ctx })`.
3. `surface === 'memory_write'` → runs `MemoryWriteValidator` on `writeContent` PRE-call; throws
   `ConnectorValidationError` on block.
4. `surface === 'composed_context'` → runs underlying method first, then calls
   `adapter.validateResult(...)` so the adapter can fire post-call validation on RETURNED entries.
5. `surface === null` → pass-through.

Construction-time guards:

- `getTenantId` must be a function — a literal string throws
  `ConnectorValidationError('configuration_error')` (adversarial #4 — caller-controlled tenantId
  leak).
- `validators` must be a non-empty array — empty/omitted throws (fail-OPEN defence).
- On edge runtimes that expose `globalThis.AsyncLocalStorage`, `assertAsyncLocalStorageHealthy()` is
  called at construction.

### `assertGetTenantIdValid(getTenantId, vendorName)`

Helper for per-vendor wrappers to throw a vendor-named `ConnectorValidationError` if `getTenantId`
is not a function. Optional — `wrapMemoryClient` enforces the same check.

### `assertTenantIdSafe(tenantId, vendorName)`

Shared tenant-ID format validator. Allowed: `[\w\-.@]+`, max 256 chars. Rejects `:` (URL-authority
injection vector), empty strings, and non-strings. Throws
`ConnectorValidationError('configuration_error')` on violation.

### Types

| Export                                 | Purpose                                                                             |
| -------------------------------------- | ----------------------------------------------------------------------------------- |
| `MemoryAdapter`                        | Per-vendor contract: `vendor`, `methods`, `route`, optional `validateResult`.       |
| `AdapterInvocation`                    | `{ method, args, ctx }` passed to `route`.                                          |
| `AdapterRoute`                         | `{ surface, writeContent?, composedEntries?, rewriteArgs? }` returned from `route`. |
| `GetTenantId`                          | `(ctx: MemorySessionContext) => string`.                                            |
| `MemorySessionContext`                 | `unknown` — vendor-agnostic session shape.                                          |
| `MemorySurface`                        | `'memory_write' \| 'composed_context'`.                                             |
| `WrapMemoryClientOptions`              | Public options exposed by per-vendor wrappers (no `adapter`/`engine`).              |
| `WrapMemoryClientFullOptions<TClient>` | Full options consumed by the generic factory (adapter + engine injected).           |

### `ConnectorValidationError`

Re-exported from `@blackunicorn/bonklm/core/connector-utils` for `instanceof` checks.

## Threat Surfaces Covered

See [`docs/user/threat-surfaces.md`](../../docs/user/threat-surfaces.md). This package itself routes
through two surfaces:

- **`memory_write`** — pre-call validation on adapter-supplied `writeContent`.
- **`composed_context`** — post-call validation on adapter-walked recall results (via
  `helpers.runComposedContextValidator`).

The mapping from vendor method → surface is the adapter's responsibility, not this package's.

## Limitations

- Symbol-keyed properties and non-function values pass through unchanged.
- `Object.freeze` only applies to the internal spread of `options`; the caller's options object
  reference is not frozen.
- Per-vendor connectors expose a simpler `WrapMemoryClientOptions` shape — the generic
  `WrapMemoryClientFullOptions` is intended for adapter authors.
- No CHANGELOG file ships with this package — see git history.

## Related

- [`@blackunicorn/bonklm-mem0`](../mem0-connector/) — Mem0 adapter built on this package.
- [`@blackunicorn/bonklm-zep`](../zep-connector/) — Zep adapter built on this package.
- [`@blackunicorn/bonklm-letta`](../letta-connector/) — Letta (MemGPT) adapter built on this
  package.
- [`@blackunicorn/bonklm`](../core/) — core engine, validators, and composite-validator factories.

## License

MIT
