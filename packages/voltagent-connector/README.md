# @blackunicorn/bonklm-voltagent

BonkLM connector for VoltAgent — `wrapVoltAgent(agent, options)` injects validators into the agent's
`generateText` and `streamText` surfaces (Story 3.10).

## Installation

```bash
pnpm add @blackunicorn/bonklm-voltagent @blackunicorn/bonklm @voltagent/core
```

## Peer dependencies

| Peer                   | Version       | Optional                |
| ---------------------- | ------------- | ----------------------- |
| `@blackunicorn/bonklm` | `workspace:*` | no                      |
| `@voltagent/core`      | `^2.7.0`      | yes (structural typing) |

The `@voltagent/core` peer is optional because the connector uses structural typing on the `Agent`
surface (`generateText`, `streamText`) — you do not need to install VoltAgent to build, only at
runtime.

## Runtime support

Exports map ships `import` + `default` conditions only — no edge-specific conditions are declared in
`package.json`. The connector itself does not depend on Node-only APIs, but VoltAgent's own runtime
support governs deployment targets.

- Node `>=20.0.0` (declared `engines` field)
- Other runtimes: Node-only in v1.0.0. The `exports` map declares only the standard `import` /
  `types` / `default` Node conditions — no `workerd`, `edge-light`, `deno`, or `bun`. Edge-runtime
  support depends on `@voltagent/core` upstream + a hosting decision; tracked as a v1.0.x backlog
  item.

## Quick start

```ts
import { Agent } from '@voltagent/core';
import { wrapVoltAgent } from '@blackunicorn/bonklm-voltagent';
import { GuardrailEngine, PromptInjectionValidator } from '@blackunicorn/bonklm';

const engine = new GuardrailEngine({ validators: [new PromptInjectionValidator()] });
const agent = wrapVoltAgent(
  new Agent({
    /* ... */
  }),
  { engine }
);

const result = await agent.generateText({ prompt: 'hello' });
// Prompt-injection attempts throw VoltAgentGuardrailBlockedError before reaching the LLM.
```

## API reference

| Export                                                                          | Signature                                                                 | Purpose                                                                                          |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `wrapVoltAgent(agent, options)`                                                 | `<A extends VoltAgentLike>(agent: A, options: WrapVoltAgentOptions) => A` | Wrap an existing VoltAgent. Returns a new object with `generateText` / `streamText` intercepted. |
| `VoltAgentGuardrailBlockedError`                                                | class                                                                     | Thrown on BLOCK. Carries `phase` (`'input'` / `'output'`), `category`, `severity`.               |
| `VoltAgentLike` / `VoltAgentInput` / `VoltAgentOutput` / `VoltAgentStreamChunk` | types                                                                     | Structural Agent surface.                                                                        |
| `VoltAgentBlockEvent`                                                           | interface                                                                 | Telemetry event (`kind: 'inference'`, `provider: 'voltagent'`).                                  |
| `WrapVoltAgentOptions`                                                          | interface                                                                 | Wrapper configuration.                                                                           |

### `WrapVoltAgentOptions`

| Option                 | Type                                   | Default  | Description                                                                       |
| ---------------------- | -------------------------------------- | -------- | --------------------------------------------------------------------------------- |
| `engine`               | `GuardrailEngine`                      | optional | Used for both input pre-validation and output post-validation (when not skipped). |
| `inputValidators`      | `Validator[]`                          | `[]`     | Caller-supplied input-only validators. Run BEFORE the engine.                     |
| `skipOutputValidation` | `boolean`                              | `false`  | When `true`, output post-validation is skipped.                                   |
| `onBlock`              | `(event: VoltAgentBlockEvent) => void` | -        | Telemetry callback fired before throw.                                            |
| `onError`              | `(err: unknown) => void`               | -        | Error sink.                                                                       |

At least one of `engine` or `inputValidators` is required — throws `TypeError` otherwise.

## Behaviour

- **Input validation**: `inputValidators` run first, then (if set) `options.engine.validate(text)`.
  Text is extracted from `input.prompt` or, when absent, the concatenation of `user` messages in
  `input.messages`.
- **Output validation (`generateText`)**: when `engine` is set and `skipOutputValidation` is
  `false`, validates `result.text` after the LLM call.
- **Streaming (`streamText`)**: chunks are yielded eagerly; the connector buffers
  `chunk.delta ?? chunk.text` and runs output validation once the stream ends. Per-chunk gating is
  NOT performed.
- **Double-wrap protection**: passing an already-wrapped agent throws via the shared
  `assertNotWrapped` watermark.
- **Validator adaptation**: input validators are wrapped with `adaptValidatorToUniversalInput` so
  both string-input and envelope-input validators work.

## Threat surfaces covered

- `text_input` — pre-LLM input validation.
- `text_output` — post-LLM output validation (when not skipped).

See [threat-surfaces.md](../../docs/user/threat-surfaces.md) for the full taxonomy.

## Edge-runtime caveats

The package does not declare edge-specific export conditions. If you deploy VoltAgent on an edge
runtime, ensure your engine is constructed from `@blackunicorn/bonklm/edge` and the connector code
path you exercise stays edge-safe — see
[edge-string-handlers.md](../../docs/user/migration/edge-string-handlers.md).

## Limitations

- Streaming output validation runs ONLY at end-of-stream — partial blocks (gate-on-prefix) are not
  supported. Tokens already yielded to the consumer cannot be unsent.
- Input extraction concatenates `user` messages only; `system` / `assistant` messages are NOT
  scanned.
- `VoltAgentBlockEvent.kind` is `'inference'` (not a dedicated `'voltagent'` kind) to fit the
  existing `BonklmBlockEvent` discriminated union — disambiguate via `event.provider`.
- The wrapped object is built with object-spread (`{ ...agent, generateText, streamText }`); methods
  bound to the original instance via class prototypes may behave differently if they reference
  `this`. Test with your specific VoltAgent subclass.

## Related

- [`@blackunicorn/bonklm`](../core/README.md) — core engine and validators.
- Sibling agent-framework connectors:
  [`@blackunicorn/bonklm-elizaos`](../elizaos-connector/README.md),
  [`@blackunicorn/bonklm-cloudflare-agents`](../cloudflare-agents-connector/README.md).

## License

[Apache-2.0](./LICENSE) © 2026 BlackUnicorn
