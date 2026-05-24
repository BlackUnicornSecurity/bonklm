/**
 * Story 4.4 START — Temporal workflow helper
 * ============================================
 *
 * `guardrailGate(activityResult)` — call from inside a workflow after
 * awaiting the `validateInput` activity. Throws
 * `TemporalGuardrailBlockedError` on BLOCK so the workflow aborts
 * deterministically.
 *
 * Per Story 4.4 AC: validators run as activities (non-determinism
 * rule). The workflow itself only handles the decision throw —
 * deterministic and replay-safe.
 *
 * **@workflow-safe — DO NOT add non-deterministic imports to this
 * file.** Sprint 35 audit closure (architect MEDIUM): this module is
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
 * Allowed: pure type-only imports (`import type { ... }`), pure
 * functions, plain `Error` subclasses, primitive constants. The
 * `import type ValidateInputActivityResult` below is erased by tsc
 * and produces zero runtime closure into `./activity.js`.
 *
 * Audit the workflow bundle after any change here:
 *   `pnpm --filter @blackunicorn/bonklm-temporal build && \
 *      node -e "import('./dist/workflow.js').then(m => console.log(Object.keys(m)))"`
 */
import type { ValidateInputActivityResult } from './activity.js';

export class TemporalGuardrailBlockedError extends Error {
  override readonly name = 'TemporalGuardrailBlockedError';
  readonly validatorName: string;
  readonly category?: string;
  readonly severity?: string;

  constructor(
    message: string,
    validatorName: string,
    extra?: { category?: string; severity?: string }
  ) {
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
  if (result.blocked) {
    throw new TemporalGuardrailBlockedError(
      `Temporal input blocked by ${result.validatorName ?? 'unknown'}: ${result.reason ?? 'unknown'}`,
      result.validatorName ?? 'unknown',
      { category: result.category, severity: result.severity }
    );
  }
}
