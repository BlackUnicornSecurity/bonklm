# @blackunicorn/bonklm-turbopuffer

> **⚠️ Supply-chain warning — read this before installing.**
>
> The official Turbopuffer SDK is published as **`@turbopuffer/turbopuffer`** (scoped, currently
> `^2.1.0`). A separate npm package named **`turbopuffer`** (no scope, version `1.0.1`) exists as a
> **placeholder** that is NOT maintained by Turbopuffer Inc. and may be hijacked, deprecated, or
> swapped at any time.
>
> Do NOT install `turbopuffer` (unscoped). This connector peer-depends on
> `@turbopuffer/turbopuffer ^2.1.0` — install the SCOPED package only.
>
> ```bash
> # ✓ Correct:
> npm install @turbopuffer/turbopuffer @blackunicorn/bonklm-turbopuffer
> # ✗ Wrong (placeholder, not the SDK):
> npm install turbopuffer
> ```

LanceDB-style guardrails wrapper for the [Turbopuffer](https://turbopuffer.com) vector database.
Validates writes via `MemoryWriteValidator` and retrieved rows via `RetrievedDocValidator` on every
`write` / `query` / `multiQuery` / `deleteAll` call.

**Edge-compatible.** Turbopuffer is a pure HTTP API; the connector uses no Node-only globals and
runs on Workerd / Deno / Bun / Vercel Edge. Verified by static-grep test against the source + by
importing `ConnectorValidationError` from the edge-safe `@blackunicorn/bonklm/core/connector-utils`
subpath (not the Node-only root barrel).

## Install

```bash
pnpm add @blackunicorn/bonklm @blackunicorn/bonklm-turbopuffer @turbopuffer/turbopuffer
```

Peer-deps:

- `@blackunicorn/bonklm` (workspace `^0.4.0`)
- `@turbopuffer/turbopuffer ^2.1.0` (the SCOPED official SDK — see warning above)

## Quick start

```ts
import { Turbopuffer } from '@turbopuffer/turbopuffer';
import { createGuardedNamespace } from '@blackunicorn/bonklm-turbopuffer';
import {
  PromptInjectionValidator,
  SecretGuard,
  PIIGuard,
  createMemoryWriteValidator,
  createRetrievedDocValidator
} from '@blackunicorn/bonklm';

const tpuf = new Turbopuffer({ apiKey: process.env.TURBOPUFFER_API_KEY });
const ns = tpuf.namespace('my-docs');

const guarded = createGuardedNamespace(ns, {
  memoryWriteValidator: createMemoryWriteValidator({
    validators: [new SecretGuard(), new PIIGuard()],
    onFailure: 'block-write'
  }),
  retrievedDocValidator: createRetrievedDocValidator({
    validators: [new PromptInjectionValidator()],
    onFailure: 'filter'
  }),
  // Validate ALL user-influenceable text columns:
  contentField: ['text', 'summary']
});

// Writes are validated per-row, per-column:
await guarded.write({
  upsert_rows: [{ id: '1', text: 'hello', summary: 'a greeting', vector: [0.1, 0.2] }]
});

// Queries filter poisoned rows + cap response size:
const r = await guarded.query({
  rank_by: ['vector', 'ANN', [0.1, 0.2]],
  top_k: 10
});

// multi_query is ALSO wrapped (each sub-result validated):
const m = await guarded.multiQuery({
  queries: [
    { rank_by: ['vector', 'ANN', [0.1, 0.2]], top_k: 5 },
    { rank_by: ['vector', 'ANN', [0.3, 0.4]], top_k: 5 }
  ]
});
```

## Columnar writes

Turbopuffer's primary high-throughput write path uses `upsert_columns` / `patch_columns` — a
columnar format where each field is an array of column values keyed by column name.

The connector **rejects** columnar writes by default when a `memoryWriteValidator` is configured.
The connector does NOT transpose columnar → rows automatically because:

- Column-name mismatches between the schema and the validator's expected `contentField` would
  silently corrupt the write.
- Missing IDs in the columnar form would skip row identity tracking.
- The user-content semantics depend on schema; the connector cannot infer it.

**Recommended pattern:** submit user-content writes as `upsert_rows` (row-form) and use
`upsert_columns` only for schema-driven bulk loads that don't carry user input.

If you need to opt out (for benchmark/migration scenarios where you accept unvalidated writes):

```ts
createGuardedNamespace(ns, {
  memoryWriteValidator,
  columnarWriteMode: 'pass-through' // ← explicit unvalidated columnar
});
```

## Configuration

See `GuardedNamespaceOptions` in `src/types.ts` for the full option surface with per-option
`@security` notes. Defaults at a glance:

| Option               | Default (no validator) | Default (validator wired) |
| -------------------- | ---------------------- | ------------------------- |
| `contentField`       | `'text'`               | `'text'`                  |
| `columnarWriteMode`  | `'pass-through'`       | `'reject'`                |
| `maxResultCount`     | `1000`                 | `1000`                    |
| `emptyRedactionMode` | `'block'`              | `'block'`                 |
| `productionMode`     | `false`                | `false`                   |

## What this connector does NOT validate

- **Filter-based operations** (`delete_by_filter`, `patch_by_filter`). Filter tuples don't carry
  user content; sanitize at the caller boundary if your filters are constructed from user input.
- **`deletes: ID[]` (bulk delete by ID).** Authorization is the consumer's responsibility.
- **Non-wrapped Namespace methods** (`branchFrom`, `copyFrom`, `recall`, `schema`, `metadata`,
  `exists`, `updateMetadata`, `updateSchema`, `hintCacheWarm`, `explainQuery`). These pass through
  via the Proxy `get` trap unchanged.
- **Writes through `.raw`.** The escape hatch is for advanced consumers; it bypasses the wrapper
  entirely.

## License

[Apache-2.0](./LICENSE) © 2026 BlackUnicorn
