# @blackunicorn/bonklm-letta

> Letta (formerly MemGPT) memory-client connector for BonkLM — wraps Letta agent memory `messages.create` / `archival_memory.insert` / `*.list` with sealed write + composed-context recall validation.

## Overview

This package wraps the [`@letta-ai/letta-client`](https://www.npmjs.com/package/@letta-ai/letta-client) SDK with a nested `Proxy` that routes Letta's `agents.messages.*` and `agents.archival_memory.*` namespaces through BonkLM. Writes fire the `memory_write` surface; recall paths (`list`) fire `composed_context` post-call. Tenant scoping is enforced by rewriting the first positional `agentId` with `getTenantId(ctx)` and stripping the bypass fields `humanId`, `personaId`, `userId`, `organizationId`.

The outer proxy is **fail-closed**: unknown top-level callable properties on `client` or unknown sub-namespaces under `client.agents` throw `ConnectorValidationError` so a future Letta SDK addition cannot silently bypass tenant scoping.

## Installation

```bash
pnpm add @blackunicorn/bonklm-letta @blackunicorn/bonklm @letta-ai/letta-client
```

## Peer Dependencies

| Package | Version |
|---|---|
| `@letta-ai/letta-client` | `^1.11.0` |
| Node.js | `>=20.4.0` |

## Quick Start

```typescript
import { LettaClient } from '@letta-ai/letta-client';
import { GuardrailEngine, PromptInjectionValidator } from '@blackunicorn/bonklm';
import { wrapLettaClient } from '@blackunicorn/bonklm-letta';

const validators = [new PromptInjectionValidator()];
const engine = new GuardrailEngine({ validators });
const client = new LettaClient({ baseUrl: '...' });

const guarded = wrapLettaClient(client, engine, {
  getTenantId: (ctx) => ctx.agentId,            // REQUIRED — must be a function
  getSessionContext: () => requestLocal.get('session'),
  validators,
});

await guarded.agents.messages.create({
  agentId: 'IGNORED',                            // overwritten with getTenantId(ctx)
  messages: [{ role: 'user', content: 'hello' }],
});
```

## API Reference

### `wrapLettaClient(client, engine, options)`

Canonical-shape factory (ADR shape #2). Returns a `Proxy` over the Letta client preserving its interface; intercepts `.agents.<sub>.<method>` accesses for the routed namespaces.

- `client` — a Letta client instance.
- `engine` — a `GuardrailEngine` owning the validator chain.
- `options: WrapMemoryClientOptions` — `getTenantId` REQUIRED; non-function values throw `ConnectorValidationError`.

### `buildLettaAdapter(getTenantId)`

Returns the `MemoryAdapter` bound to a `getTenantId` callback. Exposed for advanced callers composing custom flows over `@blackunicorn/bonklm-memory-utils`.

### `ConnectorValidationError`

Re-exported from `@blackunicorn/bonklm/core/connector-utils`.

### Wrapped namespaces and methods

Top-level allowlist: `agents`. Sub-namespaces routed under `agents.*`: `messages`, `archival_memory`, `archivalMemory`, `core_memory`, `coreMemory`. Method routing:

| Letta method | Surface | Notes |
|---|---|---|
| `agents.messages.create` / `send_message` / `sendMessage` | `memory_write` | Validates `messages[].content`; rewrites `agentId`. |
| `agents.archival_memory.insert` | `memory_write` | Validates `text` / `content`; rewrites `agentId`. |
| `agents.messages.list` | `composed_context` (post-call) | Rewrites `agentId`; validates recalled entries. |
| `agents.archival_memory.list` | `composed_context` (post-call) | Rewrites `agentId`; validates recalled entries. |
| `agents.*.update` | — | Rewrites `agentId`; no content to scan. |

## Threat Surfaces Covered

See [`docs/user/threat-surfaces.md`](../../docs/user/threat-surfaces.md) for the 7-surface taxonomy.

- **`memory_write`** — `messages.create`, `archival_memory.insert`.
- **`composed_context`** — `messages.list`, `archival_memory.list` (post-call validation of the concatenated recall blob).

Not covered: `text_input` / `text_output` / `tool_call` / `retrieved_doc` / `audio_partial`. `core_memory` (and its camelCase `coreMemory` alias) ARE allowlisted in `LETTA_AGENTS_SUB_NAMESPACES` and route through the leaf-namespace wrap → `memory_write` surface. The per-method coverage is gated by `LETTA_METHODS` (`create`, `send_message`, `sendMessage`, `list`, `insert`, `update`); methods on `core_memory` outside that allowlist throw `ConnectorValidationError` (configuration error) — fail-closed by design. Add new methods to `LETTA_METHODS` if the upstream Letta SDK introduces them.

## Limitations

- Method names outside `LETTA_METHODS` (`create`, `send_message`, `sendMessage`, `list`, `insert`, `update`) pass through unwrapped within an allowlisted sub-namespace.
- Tenant scoping only neutralizes the documented bypass fields (`humanId`, `personaId`, `userId`, `organizationId`). New scoping fields added in future Letta SDK versions need an explicit update.
- Unknown TOP-level callable namespaces fail closed — a Letta SDK upgrade adding a new client namespace will throw until added to the allowlist or passthrough set.
- No CHANGELOG file ships with this package — see git history.

## Related

- [`@blackunicorn/bonklm-mem0`](../mem0-connector/) — Mem0 memory client.
- [`@blackunicorn/bonklm-zep`](../zep-connector/) — Zep memory protocol.
- [`@blackunicorn/bonklm-memory-utils`](../memory-utils/) — shared `wrapMemoryClient` + `MemoryAdapter` types this connector builds on.

## License

MIT
