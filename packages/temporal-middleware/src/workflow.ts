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
