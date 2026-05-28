# @blackunicorn/bonklm-restate

Restate SDK middleware for BonkLM. **Story 4.4 START (Sprint 20)** — Sprint 21 finishes the full SDK
integration (CHANGELOG, README expansion, integration test).

`withRestateGuardrails(handler, opts)` wraps a Restate handler so the input is validated BEFORE the
handler runs. Validator decisions are routed through `cachedValidate` keyed on the input + journaled
via `ctx.run('bonklm:validation', ...)` so retries/replays return the SAME decision
deterministically.

## Install

```bash
pnpm add @blackunicorn/bonklm @blackunicorn/bonklm-restate @restatedev/restate-sdk
```

## Quick start

```ts
import { service } from '@restatedev/restate-sdk';
import { withRestateGuardrails } from '@blackunicorn/bonklm-restate';
import { PromptInjectionValidator, CodeInjectionValidator } from '@blackunicorn/bonklm';

const myService = service({
  name: 'myService',
  handlers: {
    chat: withRestateGuardrails(
      async (ctx, input: string) => {
        // Validator already ran; safe to proceed.
        return `Echo: ${input}`;
      },
      {
        validators: [new PromptInjectionValidator(), new CodeInjectionValidator()],
        onBlock: event => {
          console.warn(`[bonklm-restate] BLOCKED: ${event.reason}`);
        }
      }
    )
  }
});
```

## License

MIT. (c) Black Unicorn Security.
