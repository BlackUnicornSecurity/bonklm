# @blackunicorn/bonklm-temporal

Temporal SDK middleware for BonkLM. **Story 4.4 START (Sprint 20)** — Sprint 21 finishes the full
SDK integration (proxyActivities typed helpers, sample worker setup, end-to-end integration test
against an embedded Temporal server).

**Validators run as ACTIVITIES** per Story 4.4 AC (non-determinism rule). Workflows are replay-safe
— they only call the activity + throw on BLOCK via `guardrailGate`.

## Install

```bash
pnpm add @blackunicorn/bonklm @blackunicorn/bonklm-temporal @temporalio/worker
```

## Quick start

```ts
// activities/guardrails.ts
import { createValidateInputActivity } from '@blackunicorn/bonklm-temporal';
import { PromptInjectionValidator, CodeInjectionValidator } from '@blackunicorn/bonklm';

export const validateInput = createValidateInputActivity({
  validators: [new PromptInjectionValidator(), new CodeInjectionValidator()]
});

// worker.ts
import { Worker } from '@temporalio/worker';
import * as activities from './activities/guardrails.js';

const worker = await Worker.create({
  taskQueue: 'my-queue',
  activities,
  workflowsPath: require.resolve('./workflows')
});
await worker.run();

// workflows/chat.ts
import { proxyActivities } from '@temporalio/workflow';
import { guardrailGate } from '@blackunicorn/bonklm-temporal';

const { validateInput } = proxyActivities<{
  validateInput: typeof import('../activities/guardrails').validateInput;
}>({ startToCloseTimeout: '5s' });

export async function chatWorkflow(userInput: string): Promise<string> {
  const r = await validateInput({ content: userInput });
  guardrailGate(r); // throws TemporalGuardrailBlockedError on BLOCK
  // ... safe to proceed
  return `Echo: ${userInput}`;
}
```

## License

MIT. (c) Black Unicorn Security.
