# @blackunicorn/bonklm-openai-agents

OpenAI Agents SDK (`@openai/agents ^0.11.0`) connector for BonkLM. Wraps the four primary surfaces —
`Agent`, `Tool`, `Handoff`, `RealtimeSession` — with deterministic security guardrails derived from
the BonkLM `GuardrailEngine`.

> **Pre-1.0 peer pin.** `@openai/agents` is pre-1.0; signatures shift between minors. This connector
> pins `^0.11.0` exactly and re-aligns on every peer bump.

## Install

```bash
npm install @blackunicorn/bonklm-openai-agents @blackunicorn/bonklm @openai/agents
```

## Usage

### Wrap an Agent

```ts
import { Agent, run } from '@openai/agents';
import { GuardrailEngine, PromptInjectionValidator, SecretGuard } from '@blackunicorn/bonklm';
import { wrapAgent } from '@blackunicorn/bonklm-openai-agents';

const engine = new GuardrailEngine({
  validators: [new PromptInjectionValidator()],
  guards: [new SecretGuard()]
});

const supportAgent = wrapAgent(
  new Agent({
    name: 'support',
    instructions: 'Help the customer.',
    tools: [lookupCustomerTool, sendEmailTool]
  }),
  engine,
  { productionMode: true }
);

await run(supportAgent, 'I need help with my order #1234');
```

`wrapAgent` installs:

- `defineInputGuardrail` on the agent — fires `InputGuardrailTripwireTriggered` on injection /
  secret / etc. in the raw user input.
- `defineOutputGuardrail` on the agent — fires `OutputGuardrailTripwireTriggered` on injection in
  the final agent response.
- `defineToolInputGuardrail` on every tool — args walked via `createToolCallArgsValidator` (Story
  1.1) so per-leaf strings AND the tool name itself are scanned.
- `defineToolOutputGuardrail` on every tool — mitigates the "tool-result-as-carrier" class where
  compromised tool output carries injection back into the agent loop.

### Wrap a Handoff

```ts
import { Handoff } from '@openai/agents';
import { wrapHandoff } from '@blackunicorn/bonklm-openai-agents';

const billing = new Handoff({ name: 'to_billing', agent: billingAgent });
const guardedBilling = wrapHandoff(billing, engine, {
  validators: [new PromptInjectionValidator()],
  onHandoffBlocked: (source, target, reason) => {
    metrics.increment('bonklm.handoff_blocked', { source, target });
  }
});
```

Validates the handoff `inputFilter` payload BEFORE the receiving agent sees it. Composes the full
validator chain PLUS a `ToolCallArgsValidator` pass, so any embedded `{ name, args }` function-call
payload is tree-walked. Mitigates the cross-agent injection carrier attack class (a compromised
upstream agent producing a tool result that would bypass the downstream agent's input guardrails).

### Wrap a Realtime Session

```ts
import { RealtimeSession } from '@openai/agents';
import { wrapRealtime } from '@blackunicorn/bonklm-openai-agents';

const session = new RealtimeSession({ model: 'gpt-4o-realtime-preview' });
const guarded = wrapRealtime(session, engine, {
  validators: [new PromptInjectionValidator()]
});
```

- Subscribes to `input_audio_transcription.completed`; if the transcribed caller text fails
  validation, the session is closed.
- Installs a `RealtimeOutputGuardrail` on response text deltas — each delta is scanned as it
  arrives. `tripwireTriggered: true` terminates the response stream per SDK semantics.
- Raw PCM audio frames are NOT scanned by this wrap. The Audio Stream Validator (Story 3.1) covers
  the binary-frame surface separately.

### Compose with OpenAI's built-in guardrails

The SDK calls input guardrails in registration order. Append BonkLM's guardrails AFTER any
caller-supplied ones so deterministic pattern detection runs LAST on the post-transform input.
Append BEFORE any OpenAI-Moderation-API-backed guardrails so BonkLM's deterministic short-circuit
saves the network round-trip on blocked inputs.

## Phase-2+ follow-ups

Tracked as Story 1.6 backlog and split into follow-up PRs:

- Full 3-chain handoff regression test (currently 2-chain and tool-result-carrier)
- Composition test against OpenAI's `safety` built-in guardrail
- Realtime audio-frame validation alignment with Story 3.1 `AudioStreamValidator`
- Real integration tests against `@openai/agents@latest` (Phase-1 is mock-based)

## License

[Apache-2.0](./LICENSE) © 2026 BlackUnicorn
