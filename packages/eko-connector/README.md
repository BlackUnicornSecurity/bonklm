# @blackunicorn/bonklm-eko

Eko v4 wrapper for BonkLM — multi-agent + MCP-tool guardrails for
prompt-injection, secret-leak, and tool-call validation across
browser, file-system, and computer-use agents.

**Peer dep:** `@eko-org/eko ^4.0.0`. Node-only.

## Install

```bash
pnpm add @blackunicorn/bonklm @blackunicorn/bonklm-eko @eko-org/eko
```

## Quick start

```ts
import { Eko } from '@eko-org/eko';
import { wrapEko } from '@blackunicorn/bonklm-eko';
import {
  GuardrailEngine,
  PromptInjectionValidator,
  SecretGuard,
  PIIGuard,
} from '@blackunicorn/bonklm';

const engine = new GuardrailEngine({
  validators: [
    new PromptInjectionValidator(),
    new SecretGuard(),
    new PIIGuard(),
  ],
});

// Optional: wire audit telemetry.
engine.onIntercept((result, ctx) => {
  if (result.blocked) myAttackLogger.log({ result, ctx });
});

const eko = new Eko({
  agents: [browserAgent, fileAgent, computerAgent],
  llmProvider: anthropicProvider,
});

const guarded = wrapEko(eko, engine, {
  skipAgents: [], // opt-out specific agents from validation
  allowCuaMode: false, // sec B2: refuse Computer-Use agents by default
});

await guarded.run("Find the price of GOOG on Yahoo Finance");
```

## Surface mapping

The wrapper intercepts each agent's primary surfaces and routes
through the validator pipeline:

| Eko surface | BonkLM mapping | Validators fire |
|---|---|---|
| `browserAgent.act(action, args?)` | `tool_call` | Pre-dispatch |
| `browserAgent.extract(prompt, schema?)` | `retrieved_doc` | Post-extract |
| `fileAgent.read(path)` | `retrieved_doc` | Post-read |
| `fileAgent.write(path, content)` | `memory_write` | Pre-write |
| `fileAgent.delete(path)` | `tool_call` | Pre-dispatch |
| MCP tool dispatch | `tool_call` | Pre-dispatch |
| Multi-step planner output | `composed_context` | Pre-execute |

## Construction-order requirement

`wrapEko` MUST be called BEFORE the planner starts or any caller
captures a reference to an agent method. After this function returns,
the agents in `client.agents` have their methods REPLACED. Any code
holding a captured `agent.act` reference from BEFORE this call
bypasses validation.

**Runtime-registration limitation**: agents added to `client.agents`
AFTER `wrapEko` returns are NOT wrapped. If your Eko deployment
supports `eko.registerAgent(...)` at runtime, you MUST call the
appropriate `wrapEko<Type>Agent` helper on the new agent before any
planner dispatch.

## Computer-Use Agent (CUA) safety

`wrapEko` REFUSES to wrap CUA-mode clients by default (sec B2 / CS2
closures). CUA agents can execute arbitrary OS-level actions (mouse,
keyboard, screenshot capture); the validator pipeline alone is NOT
sufficient mitigation for that risk profile. Override by passing
`allowCuaMode: true` AND wiring your own sandbox / approval gate.

## What this connector does NOT validate

- Code OUTSIDE the wrapped agents. Consumer code in `run()` that
  bypasses the agent layer skips validation.
- Eko's internal planner reasoning (only inputs/outputs to/from
  agent surfaces).
- Sub-process spawned by file/computer agents (sandbox is the
  consumer's responsibility).

## License

MIT
