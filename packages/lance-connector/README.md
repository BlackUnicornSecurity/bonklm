# @blackunicorn/bonklm-lance

LanceDB Table wrapper that applies `MemoryWriteValidator` on writes
(`add` / `update` / `mergeInsert(...).execute`) and
`RetrievedDocValidator` on retrieval (`.toArray()` of `search()` +
`query()`).

**Peer dep:** `@lancedb/lancedb ^0.29.0`. **Node-only** (LanceDB ships
native bindings).

For edge / Workerd / Vercel Edge consumers, use
[`@blackunicorn/bonklm-turbopuffer`](../turbopuffer-connector/README.md).

## Install

```bash
pnpm add @blackunicorn/bonklm @blackunicorn/bonklm-lance @lancedb/lancedb
```

## Quick start

```ts
import { connect } from "@lancedb/lancedb";
import { createGuardedLanceTable } from "@blackunicorn/bonklm-lance";
import {
  PromptInjectionValidator,
  SecretGuard,
  PIIGuard,
  createMemoryWriteValidator,
  createRetrievedDocValidator,
} from "@blackunicorn/bonklm";

const db = await connect("./.lancedb");
const rawTable = await db.openTable("docs");

const guarded = createGuardedLanceTable(rawTable, {
  memoryWriteValidator: createMemoryWriteValidator({
    validators: [new SecretGuard(), new PIIGuard()],
    onFailure: "block-write",
  }),
  retrievedDocValidator: createRetrievedDocValidator({
    validators: [new PromptInjectionValidator()],
    onFailure: "filter",
  }),
  // Validate ALL user-influenceable text columns:
  contentField: ["text", "summary"],
});

// Writes are validated per-row, per-column:
await guarded.add([
  { id: "1", text: "hello", summary: "a greeting", embedding: [0.1, 0.2] },
]);

// Searches filter poisoned rows + cap response size:
const results = await guarded
  .search([0.1, 0.2])
  .limit(10)
  .toArray();
```

## What gets wrapped

The connector is a Proxy intercepting 6 methods called out by the
Story 2.10 AC: `add`, `update`, `delete`, `search`, `query`,
`mergeInsert`. Every other Table method (`countRows`, `schema`,
`version`, `listIndices`, `createIndex`, etc.) passes through
unchanged.

| Method | Validation |
|---|---|
| `add(rows)` | `MemoryWriteValidator` per-row, per-column |
| `update({values})` | `MemoryWriteValidator` on the `values` object |
| `update({valuesSql})` / `Record<string,string>` | Governed by `updateSqlMode` (default `'block-sql'` when validator wired) |
| `delete(predicate)` | Length capped at `maxPredicateLength` (NOT a SQL-injection mitigation; documented) |
| `search()` / `query()` → `.toArray()` | `RetrievedDocValidator` + `maxResultCount` cap |
| `mergeInsert(on).execute(data)` | `MemoryWriteValidator` per-row |

## Arrow-Table writes (columnar)

LanceDB accepts a wide `Data` type (array of records, Arrow Table,
ReadableStream, AsyncIterable). The connector validates ONLY the
array-of-records case. Non-array `Data` is governed by
`arrowWriteMode`:

- `'reject'` (default when `memoryWriteValidator` is configured) —
  throws `ConnectorValidationError`. The connector cannot inspect
  Arrow-encoded buffers without decoding.
- `'pass-through'` (default when no validator) — writes through with
  a logger warning.

Recommended pattern: submit user-content writes as plain-record arrays
and use Arrow Tables only for schema-driven bulk loads that don't
carry user input.

## Configuration

See `GuardedLanceTableOptions` in `src/types.ts` for the full option
surface with per-option `@security` notes. Defaults:

| Option | Default (no validator) | Default (validator wired) |
|---|---|---|
| `contentField` | `'text'` | `'text'` |
| `arrowWriteMode` | `'pass-through'` | `'reject'` |
| `updateSqlMode` | `'pass-through-sql'` | `'block-sql'` |
| `maxResultCount` | `1000` | `1000` |
| `emptyRedactionMode` | `'block'` | `'block'` |
| `maxPredicateLength` | `10000` | `10000` |

## What this connector does NOT validate

- **Filter-based operations** are SQL strings. The connector caps
  `delete(predicate)` length but does NOT parse or sanitize SQL.
  Filters built from user input MUST be sanitized at the caller
  boundary.
- **Non-listed text columns.** A column NOT in `contentField` is not
  validated. List every user-influenceable text column.
- **`raw` escape hatch.** Writes through `guarded.raw.<method>()`
  bypass the wrapper entirely.
- **Concurrent mutations.** LanceDB's optimistic concurrency is
  unchanged by the wrapper; consumers must handle conflicts.

## License

MIT
