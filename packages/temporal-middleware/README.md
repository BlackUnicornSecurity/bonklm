# @blackunicorn/bonklm-temporal

Temporal SDK middleware for BonkLM. **Story 4.4 START (Sprint 20)** — Sprint 21 finishes the full
SDK integration (proxyActivities typed helpers, sample worker setup, end-to-end integration test
against an embedded Temporal server).

**Validators run as ACTIVITIES** per Story 4.4 AC (non-determinism rule). Workflows are replay-safe
— they only call the activity + throw on BLOCK via `guardrailGate`.

## Install

```bash
pnpm add @blackunicorn/bonklm @blackunicorn/bonklm-temporal @temporalio/worker @temporalio/workflow
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
  guardrailGate(r); // on BLOCK: fails the workflow terminally (see below)
  // ... safe to proceed
  return `Echo: ${userInput}`;
}
```

On a BLOCK decision, `guardrailGate` throws a **terminal, non-retryable `ApplicationFailure`**
(`type: 'TemporalGuardrailBlockedError'`), so the workflow fails deterministically instead of
retrying. A client awaiting the workflow receives a `WorkflowFailedError` whose `.cause` is that
`ApplicationFailure` — its `details[0]` carries `{ validatorName, category, severity, reason }`, and
the public `TemporalGuardrailBlockedError` class is attached as the failure `cause` for in-process
callers. Note: `reason` may include a fragment of the offending input, so treat it as untrusted when
logging it or surfacing it to end users.

## License

MIT. (c) Black Unicorn Security.
