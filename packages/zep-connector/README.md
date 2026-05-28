# @blackunicorn/bonklm-zep

> Zep memory-client connector for BonkLM — wraps Zep `thread.addMessages` /
> `thread.getUserContext` + `graph.add` / `graph.search` with sealed write + composed-context recall
> validation.

## Overview

This package wraps the [`@getzep/zep-cloud`](https://www.npmjs.com/package/@getzep/zep-cloud) SDK
with a top-level `Proxy` that intercepts `.thread` and `.graph` accesses and applies BonkLM at the
method level. Writes fire the `memory_write` surface; recall paths fire `composed_context`
post-call. Tenant scoping is enforced on `graph.*` by overwriting `graphId` with `getTenantId(ctx)`
and stripping the bypass fields `graphIds`, `userId`, `userIds`, `sessionId`.

The outer proxy is **fail-closed**: unknown top-level callable namespaces throw
`ConnectorValidationError` so a future Zep SDK addition (e.g. `client.users`) cannot silently bypass
tenant scoping.

## Installation

```bash
pnpm add @blackunicorn/bonklm-zep @blackunicorn/bonklm @getzep/zep-cloud
```

## Peer Dependencies

| Package             | Version    |
| ------------------- | ---------- |
| `@getzep/zep-cloud` | `^3.0.0`   |
| Node.js             | `>=20.4.0` |

## Quick Start

```typescript
import { ZepClient } from '@getzep/zep-cloud';
import { GuardrailEngine, PromptInjectionValidator } from '@blackunicorn/bonklm';
import { wrapZepClient } from '@blackunicorn/bonklm-zep';

const validators = [new PromptInjectionValidator()];
const engine = new GuardrailEngine({ validators });
const client = new ZepClient({ apiKey: process.env.ZEP_API_KEY });

const guarded = wrapZepClient(client, engine, {
  getTenantId: ctx => ctx.userId, // REQUIRED — must be a function
  getSessionContext: () => requestLocal.get('session'),
  validators
});

await guarded.thread.addMessages({ threadId: 't-1', messages: [{ role: 'user', content: 'hi' }] });
await guarded.graph.search({ graphId: 'IGNORED', query: '...' });
//                                   ^^^^^^^ overwritten with getTenantId(ctx)
```

## API Reference

### `wrapZepClient(client, engine, options)`

Canonical-shape factory (ADR shape #2). Returns a `Proxy` over the Zep client preserving its
interface; intercepts `.thread.*` and `.graph.*` accesses.

- `client` — a `ZepClient` instance.
- `engine` — a `GuardrailEngine` owning the validator chain.
- `options: WrapMemoryClientOptions` — `getTenantId` REQUIRED; non-function values throw
  `ConnectorValidationError`.

### `buildZepAdapter(getTenantId)`

Returns the `MemoryAdapter` bound to a `getTenantId` callback. Exposed for advanced callers
composing custom flows over `@blackunicorn/bonklm-memory-utils`.

### `ConnectorValidationError`

Re-exported from `@blackunicorn/bonklm/core/connector-utils`.

### Wrapped namespaces and methods

Top-level allowlist: `thread`, `graph`. Method routing:

| Zep method              | Surface                        | Notes                                                                 |
| ----------------------- | ------------------------------ | --------------------------------------------------------------------- |
| `thread.addMessages`    | `memory_write`                 | Validates `messages[].content`.                                       |
| `thread.getUserContext` | `composed_context` (post-call) | Validates `context` + `messages[].content`.                           |
| `graph.add`             | `memory_write`                 | Validates `data` + `episodes[].content`; rewrites `graphId`.          |
| `graph.search`          | `composed_context` (post-call) | Rewrites `graphId`; validates `episodes` / `facts` / `nodes` entries. |

## Threat Surfaces Covered

See [`docs/user/threat-surfaces.md`](../../docs/user/threat-surfaces.md) for the 7-surface taxonomy.

- **`memory_write`** — `thread.addMessages`, `graph.add`.
- **`composed_context`** — `thread.getUserContext`, `graph.search` (post-call validation of the
  recall blob).

Not covered: `text_input` / `text_output` / `tool_call` / `retrieved_doc` / `audio_partial`. The
`wrapZepGraphRetriever` graph-as-retrieved-docs factory documented in `connector-style-guide.md` is
illustrative-only and **not exported** by this package.

## Limitations

- Methods outside the routed set (`addMessages`, `getUserContext`, `add`, `search`) pass through
  unwrapped within an allowlisted namespace.
- `thread.*` scoping currently relies on caller-supplied `threadId`/`sessionId`; the adapter does
  NOT rewrite thread IDs. `graph.*` is where the tenant-scope rewrite happens. `thread.addMessages`
  is routed for content validation (`memory_write` surface) but the adapter intentionally does NOT
  enforce a tenant-derived `threadId` — applications must enforce that contract at their call sites.
  Tracked as a v1.0.1 design discussion: whether the adapter should add `rewriteArgs` for the
  `thread` namespace analogous to `graph.*` (defaults to opt-in to avoid breaking callers that
  derive threadId from external systems).
- Tenant scoping only neutralizes the documented bypass fields (`graphIds`, `userId`, `userIds`,
  `sessionId`). New scoping fields added by Zep in future SDK versions need an explicit update.
- Unknown TOP-level callable namespaces fail closed — a Zep SDK upgrade adding a new client
  namespace will throw until added to the allowlist or passthrough set.
- No CHANGELOG file ships with this package — see git history.

## Related

- [`@blackunicorn/bonklm-mem0`](../mem0-connector/) — Mem0 memory client.
- [`@blackunicorn/bonklm-letta`](../letta-connector/) — Letta (MemGPT) memory client.
- [`@blackunicorn/bonklm-memory-utils`](../memory-utils/) — shared `wrapMemoryClient` +
  `MemoryAdapter` types this connector builds on.

## License

MIT
