/**
 * Sprint 35 — Real Temporal workflow fixture for
 * `TestWorkflowEnvironment` integration tests.
 * ============================================================
 *
 * This file is loaded by the Temporal worker via `workflowsPath` (or
 * an equivalent precompiled `workflowBundle`). Temporal workflows run
 * inside a deterministic V8 sandbox managed by `@temporalio/worker` —
 * the file MUST NOT import anything non-workflow-safe (no `fs`, no
 * network, no `Date.now()` outside Temporal's deterministic API, no
 * runtime imports of `@blackunicorn/bonklm` core, etc.).
 *
 * The only runtime imports here are:
 *
 *   1. `@temporalio/workflow` — the workflow runtime API
 *      (`proxyActivities`).
 *   2. `../../src/workflow.js` — `guardrailGate`, a pure
 *      function-plus-Error-class that inspects an activity result.
 *      The src module's only runtime import is the `Error` subclass;
 *      `ValidateInputActivityResult` is imported as a TYPE only and
 *      gets erased by `tsc` so the workflow bundle stays clean.
 *
 * The activity (`validateInput`) is registered against the worker at
 * test-setup time; the workflow only proxies the call shape.
 */
import { proxyActivities } from '@temporalio/workflow';
import { guardrailGate } from '../../src/workflow.js';
import type { ValidateInputActivityArgs, ValidateInputActivityResult } from '../../src/activity.js';

/**
 * Activity proxy shape. The real activity implementation
 * (`createValidateInputActivity(...)`) is wired into the worker by the
 * test in `test-workflow-environment.test.ts`; the workflow itself
 * never imports that factory.
 */
const { validateInput } = proxyActivities<{
  validateInput(args: ValidateInputActivityArgs): Promise<ValidateInputActivityResult>;
}>({
  startToCloseTimeout: '10 seconds',
  // No retries on the validator activity — a BLOCK decision is a
  // semantic outcome, not a transient failure. The activity itself
  // routes through `cachedValidate` so any retry would return the
  // same cached decision anyway.
  retry: {
    maximumAttempts: 1
  }
});

/**
 * Canonical guardrails-protected workflow shape:
 *
 *   1. Workflow calls `validateInput` ACTIVITY on its input content.
 *   2. `guardrailGate(result)` throws `TemporalGuardrailBlockedError`
 *      on BLOCK; the workflow fails deterministically.
 *   3. On ALLOW the workflow continues with the validated content.
 *
 * Real-world workflows would do additional work in step 3 — call
 * downstream LLM activities, persist results, etc. This fixture just
 * returns a deterministic string so the test can assert the ALLOW
 * path end-to-end.
 */
export async function guardrailWorkflow(content: string): Promise<string> {
  const result = await validateInput({ content });
  guardrailGate(result);
  return `processed:${content.slice(0, 20)}`;
}
