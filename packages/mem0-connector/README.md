# @blackunicorn/bonklm-mem0

> Mem0 memory-client connector for BonkLM — wraps Mem0's
> `add`/`search`/`update`/`get`/`getAll`/`history`/`reset` with sealed write + composed-context
> recall validation.

## Overview

This package wraps the [Mem0 TypeScript SDK](https://www.npmjs.com/package/mem0ai) with a `Proxy`
that routes memory writes through BonkLM's `memory_write` surface and recall calls through the
`composed_context` surface. It also enforces multi-tenant scoping by overwriting `user_id` with the
result of `getTenantId(ctx)` on every routed call, and strips alternative Mem0 scoping fields
(`agent_id`, `run_id`, `app_id`, `org_id`, `project_id`) so a hostile caller cannot escape the
authenticated tenant.

## Installation

```bash
pnpm add @blackunicorn/bonklm-mem0 @blackunicorn/bonklm mem0ai
```

## Peer Dependencies

| Package  | Version    |
| -------- | ---------- |
| `mem0ai` | `^3.0.0`   |
| Node.js  | `>=20.4.0` |

## Quick Start

```typescript
import { Memory } from 'mem0ai';
import { GuardrailEngine, PromptInjectionValidator, SecretGuard } from '@blackunicorn/bonklm';
import { wrapMem0Client } from '@blackunicorn/bonklm-mem0';

const validators = [new PromptInjectionValidator(), new SecretGuard()];
const engine = new GuardrailEngine({ validators });
const client = new Memory();

const guarded = wrapMem0Client(client, engine, {
  getTenantId: ctx => ctx.userId, // REQUIRED — must be a function
  getSessionContext: () => requestLocal.get('session'),
  validators
});

await guarded.add('user authored content', { user_id: 'IGNORED' });
//                                                    ^^^^^^^ overwritten with getTenantId(ctx)
await guarded.search('what did I say earlier?', { user_id: 'IGNORED' });
```

## API Reference

### `wrapMem0Client(client, engine, options)`

Canonical-shape factory (ADR shape #2). Returns a `Proxy` over the Mem0 client with the same
interface.

- `client` — a Mem0 client instance (typically `new Memory()`).
- `engine` — a `GuardrailEngine` owning the validator chain.
- `options: WrapMemoryClientOptions` — `getTenantId` is REQUIRED; a non-function value throws
  `ConnectorValidationError` at construction.

### `buildMem0Adapter(getTenantId)` / `mem0Adapter`

Returns the `MemoryAdapter` bound to a `getTenantId` callback. Exposed for advanced callers
composing custom flows over `@blackunicorn/bonklm-memory-utils`. The module-scope `mem0Adapter`
export is a guard placeholder — invoking it without a tenant binding throws
`ConnectorValidationError`.

### `ConnectorValidationError`

Re-exported from `@blackunicorn/bonklm/core/connector-utils` for `instanceof` checks on caller side.

### Method routing

| Mem0 method | Surface                        | Notes                                                                |
| ----------- | ------------------------------ | -------------------------------------------------------------------- |
| `add`       | `memory_write`                 | Validates input text; rewrites `user_id`.                            |
| `update`    | `memory_write`                 | Validates `data.text` / string `data`. Scoped by `memory_id`.        |
| `search`    | `composed_context` (post-call) | Rewrites `user_id`; validates recalled entries.                      |
| `getAll`    | `composed_context` (post-call) | Rewrites `user_id`; validates recalled entries.                      |
| `get`       | `composed_context` (post-call) | Scoped by `memory_id`; validates returned entry.                     |
| `history`   | —                              | Pass-through (no INPUT text to validate).                            |
| `reset`     | —                              | Rewrites `user_id` to scope bulk-delete to the authenticated tenant. |

## Threat Surfaces Covered

See [`docs/user/threat-surfaces.md`](../../docs/user/threat-surfaces.md) for the 7-surface taxonomy.

- **`memory_write`** — `add` / `update` (validated pre-persist via `createMemoryWriteValidator`).
- **`composed_context`** — `search` / `get` / `getAll` (validated post-call via
  `createComposedContextValidator` on the recalled entries).

Not covered by this connector: `text_input` / `text_output` / `tool_call` / `retrieved_doc` /
`audio_partial`. Use a model-provider connector (e.g. `@blackunicorn/bonklm-anthropic`) for those.

## Limitations

- `client.add(..., { infer: true })`: Mem0's server-side extraction is opaque — the INPUT text is
  validated, but the extracted memory is not re-validated post-extraction.
- Mem0 method names outside the routed set (`add`, `update`, `history`, `reset`, `search`, `get`,
  `getAll`) pass through unwrapped.
- Tenant scoping only neutralizes the documented bypass fields (`agent_id`, `run_id`, `app_id`,
  `org_id`, `project_id`). New scoping fields added by Mem0 in future SDK versions need an explicit
  allowlist update.
- No CHANGELOG file ships with this package — see git history.

## Related

- [`@blackunicorn/bonklm-letta`](../letta-connector/) — Letta (MemGPT) memory client.
- [`@blackunicorn/bonklm-zep`](../zep-connector/) — Zep memory protocol.
- [`@blackunicorn/bonklm-memory-utils`](../memory-utils/) — shared `wrapMemoryClient` +
  `MemoryAdapter` types this connector builds on.

## License

MIT
