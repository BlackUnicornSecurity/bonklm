# @blackunicorn/bonklm-cloudflare-agents

BonkLM connector for Cloudflare Agents (Durable Objects + Workerd) — the
`withBonklmAgent(Agent, config)` mixin wraps `setState` / `sql` / `ctx.storage` with validators
(Story 3.8).

## Installation

```bash
pnpm add @blackunicorn/bonklm-cloudflare-agents @blackunicorn/bonklm agents
```

## Peer dependencies

| Peer                   | Version       | Optional                |
| ---------------------- | ------------- | ----------------------- |
| `@blackunicorn/bonklm` | `workspace:*` | no                      |
| `agents`               | `^0.13.0`     | yes (structural typing) |

The `agents` peer is optional because the connector uses structural typing on the `Agent<Env, S>`
surface — you do not need to install the SDK to build, only at runtime.

## Runtime support

Edge-targeted. Exports map ships `workerd` and `import` conditions (the `edge-light` condition is
intentionally not declared — the BonkLM core APIs this connector builds on use Node built-ins and
need `workerd`'s `nodejs_compat`).

- Cloudflare Workers (workerd) with Durable Objects — `nodejs_compat` flag required (see
  [edge-string-handlers.md](../../docs/user/migration/edge-string-handlers.md#cloudflare-workers-required-setup))
- Node `>=20.0.0` (declared `engines` field, primarily for build/test)

## Quick start

```ts
import { Agent } from 'agents';
import { withBonklmAgent } from '@blackunicorn/bonklm-cloudflare-agents';
import {
  GuardrailEngine,
  createMemoryWriteValidator,
  PromptInjectionValidator
} from '@blackunicorn/bonklm/edge';

const engine = new GuardrailEngine({ validators: [new PromptInjectionValidator()] });

export class MyAgent extends withBonklmAgent(Agent, {
  engine,
  memoryWriteValidators: [
    createMemoryWriteValidator({ validators: [new PromptInjectionValidator()] })
  ],
  retrievedDocValidators: [new PromptInjectionValidator()],
  onBlock: event => console.warn(`[bonklm-cf] BLOCKED ${event.surface}: ${event.reason}`)
}) {
  async onMessage(message: string) {
    // setState + this.sql + ctx.storage are validated transparently
  }
}
```

## API reference

| Export                                        | Signature                                            | Purpose                                                                                         |
| --------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `withBonklmAgent(BaseAgent, config)`          | `<S, Base>(Base, config: BonklmAgentConfig) => Base` | Subclass-mixin that wraps `setState`, `this.sql`, and `ctx.storage` on the supplied Agent base. |
| `CloudflareAgentBlockedError`                 | class                                                | Thrown by wrapped `setState` on BLOCK. Carries `surface`, `broadcast`, `category`, `severity`.  |
| `AgentLike` / `AgentExecutionContextLike`     | types                                                | Structural Agent + DO context shapes.                                                           |
| `BonklmAgentConfig`                           | interface                                            | Mixin configuration.                                                                            |
| `BonklmAgentHookContext`                      | interface                                            | Per-surface hook metadata (`broadcast`, `surface`).                                             |
| `CloudflareAgentBlockEvent`                   | interface                                            | Telemetry event passed to `onBlock`.                                                            |
| `DurableObjectStorageLike` / `SqlStorageLike` | types                                                | Structural DO storage + SQL surfaces.                                                           |

### `BonklmAgentConfig`

| Option                   | Type                                         | Default  | Description                                                                                                                                              |
| ------------------------ | -------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `engine`                 | `GuardrailEngine`                            | required | Must be constructed with edge-safe validators.                                                                                                           |
| `memoryWriteValidators`  | `Validator[]`                                | `[]`     | Run on every `setState(next)` before the underlying mutation. BLOCK throws `CloudflareAgentBlockedError`.                                                |
| `retrievedDocValidators` | `Validator[]`                                | `[]`     | Run per-row on `this.sql` SELECTs and on `ctx.storage.get` / `list` / `getAlarm`. BLOCK returns `undefined` / empty `Map` / drops the row (fail-closed). |
| `onBlock`                | `(event: CloudflareAgentBlockEvent) => void` | -        | Telemetry callback.                                                                                                                                      |
| `onError`                | `(err: unknown) => void`                     | -        | Error sink for validator exceptions.                                                                                                                     |

## Wrapped surfaces

| Surface                           | Wrapping                         | BLOCK behaviour                                                       |
| --------------------------------- | -------------------------------- | --------------------------------------------------------------------- |
| `setState(next)`                  | memory-write validation          | throws `CloudflareAgentBlockedError` (Durable Object aborts mutation) |
| `this.sql` tagged-template SELECT | per-row retrieved-doc validation | drops flagged rows; returns the filtered array                        |
| `ctx.storage.get(key)`            | retrieved-doc validation         | returns `undefined`                                                   |
| `ctx.storage.list(opts)`          | retrieved-doc validation         | drops flagged entries; returns filtered `Map`                         |
| `ctx.storage.getAlarm()`          | not validated (no content)       | pass-through                                                          |

## Threat surfaces covered

- `memory_write` — `setState` mutations.
- `retrieved_doc` — `this.sql` rows and DO storage reads.

See [threat-surfaces.md](../../docs/user/threat-surfaces.md) for the full taxonomy.

## Edge-runtime caveats

- Workerd `nodejs_compat` flag REQUIRED — call `assertAsyncLocalStorageHealthy()` from
  `@blackunicorn/bonklm/edge` at startup, and pin `compatibility_date = "2024-09-23"` +
  `compatibility_flags = ["nodejs_compat"]` in `wrangler.toml`. Full fragment:
  [edge-string-handlers.md](../../docs/user/migration/edge-string-handlers.md#cloudflare-workers-required-setup).
- BREAKING vs raw Agents SDK: when `retrievedDocValidators` is non-empty, `this.sql` returns
  `Promise<rows[]>` instead of `rows[]`. Consumers must `await this.sql\`SELECT
  ...\``. Opt out by leaving `retrievedDocValidators` empty (sync surface preserved).
- Double-wrap protection: passing an already-wrapped Agent class throws via the shared
  `assertNotWrapped` watermark.

## Limitations

- WebSocket-broadcast events (`broadcast: true` on `setState`) are flagged via
  `BonklmAgentHookContext.broadcast` for validators to risk-tune; the connector does NOT itself
  intercept WS message dispatch.
- `onRequest` / `onMessage` are NOT wrapped — subclass overrides remain the consumer's
  responsibility. Only `withBonklmAgent` is exported from this package; for preflight validation on
  subclass overrides, instantiate the engine directly (`new GuardrailEngine({...})` from
  `@blackunicorn/bonklm`) and call `engine.validate(text)` before delegating to the original
  handler. A package-level `validateUserInput` helper is a v1.0.1 backlog item.
- Per-row text validation dispatches as `kind: 'text'`, NOT `kind: 'retrieved_docs'`, because the
  core RetrievedDocValidator's default `onPerDocFailure: 'drop'` returns `blocked: false` at the
  batch level. Pass text-shape validators directly.

## Related

- [`@blackunicorn/bonklm`](../core/README.md) — core engine and edge entry.
- [`@blackunicorn/bonklm-hono`](../hono-middleware/README.md) — companion HTTP middleware for the
  Workers fetch handler.

## License

MIT (c) Black Unicorn
