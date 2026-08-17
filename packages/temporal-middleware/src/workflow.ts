/**
 * Temporal workflow helper
 * ============================================
 *
 * `guardrailGate(activityResult)` — call from inside a workflow after
 * awaiting the `validateInput` activity. On BLOCK it throws a terminal,
 * non-retryable `ApplicationFailure` (carrying the public
 * `TemporalGuardrailBlockedError` as its `cause`) so the workflow aborts
 * deterministically.
 *
 * Per Story 4.4 AC: validators run as activities (non-determinism
 * rule). The workflow itself only handles the decision throw —
 * deterministic and replay-safe.
 *
 * **@workflow-safe — DO NOT add non-deterministic imports to this
 * file.** Sprint 35 hardening (architect MEDIUM): this module is
 * loaded INSIDE the Temporal workflow V8 sandbox (see
 * `tests/test-workflows/guardrail-workflow.ts` for the consumer).
 * The Temporal worker bundles its `workflowsPath` entry + the entry's
 * transitive runtime imports into the deterministic sandbox. Adding
 * any of the following to this file would silently poison the
 * sandbox and break workflow replay determinism:
 *
 *   - `import { readFileSync } from 'node:fs'`
 *   - `import * as net from 'node:net'`
 *   - `Date.now()` outside Temporal's deterministic API
 *   - `Math.random()` outside `@temporalio/workflow`'s `uuid4()`
 *   - dynamic `await import(...)` of non-workflow-safe modules
 *   - re-exports from `@blackunicorn/bonklm` core (pulls fs / loggers)
 *
 * Allowed: the `@temporalio/workflow` runtime API itself (e.g.
 * `ApplicationFailure`, `proxyActivities`) — it is the Workflow sandbox's
 * own deterministic API; pure type-only imports (`import type { ... }`);
 * pure functions; plain `Error` subclasses; primitive constants. The
 * `import type ValidateInputActivityResult` below is erased by tsc
 * and produces zero runtime closure into `./activity.js`.
 *
 * Audit the workflow bundle after any change here:
 *   `pnpm --filter @blackunicorn/bonklm-temporal build && \
 *      node -e "import('./dist/workflow.js').then(m => console.log(Object.keys(m)))"`
 */
import { ApplicationFailure } from '@temporalio/workflow';

import type { ValidateInputActivityResult } from './activity.js';

export class TemporalGuardrailBlockedError extends Error {
  override readonly name = 'TemporalGuardrailBlockedError';
  readonly validatorName: string;
  readonly category?: string;
  readonly severity?: string;

  constructor(message: string, validatorName: string, extra?: { category?: string; severity?: string }) {
    super(message);
    this.validatorName = validatorName;
    this.category = extra?.category;
    this.severity = extra?.severity;
  }
}

/**
 * Throw if the activity returned a BLOCK decision. Workflow-side
 * helper — call after awaiting `proxyActivities().validateInput(...)`.
 */
export function guardrailGate(result: ValidateInputActivityResult): void {
  if (!result.blocked) {
    return;
  }

  const validatorName = result.validatorName ?? 'unknown';
  const reason = result.reason ?? 'unknown';

  // Preserve the public `TemporalGuardrailBlockedError` contract: construct it
  // (carrying the typed validatorName/category/severity fields) and hang it off
  // the thrown failure as `cause`, so direct in-process callers still read those
  // fields via `err.cause`.
  const blocked = new TemporalGuardrailBlockedError(
    `Temporal input blocked by ${validatorName}: ${reason}`,
    validatorName,
    {
      category: result.category,
      severity: result.severity
    }
  );

  // Throw an `ApplicationFailure` (a `TemporalFailure` subclass) so the workflow
  // fails TERMINALLY on BLOCK. A plain `Error` subclass is NOT a `TemporalFailure`,
  // so the Temporal workflow runtime (`Activator.handleWorkflowFailure`) treats it
  // as a retryable *Workflow Task* failure and retries the task indefinitely — the
  // workflow never reaches a terminal FAILED state and the client's `execute()`
  // never settles. `nonRetryable: true` also pins the verdict as final under any
  // workflow retry policy (a BLOCK decision is semantic, never transient). The
  // diagnostics ride along in `details` so they survive the client RPC boundary.
  throw ApplicationFailure.create({
    message: blocked.message,
    // Stable wire contract string — intentionally a literal, NOT `blocked.name`,
    // so renaming the class never silently changes what clients match on.
    type: 'TemporalGuardrailBlockedError',
    nonRetryable: true,
    details: [{ validatorName, category: result.category, severity: result.severity, reason }],
    cause: blocked
  });
}
