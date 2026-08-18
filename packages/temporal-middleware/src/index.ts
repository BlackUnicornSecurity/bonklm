// SPDX-License-Identifier: Apache-2.0
/**
 * `@blackunicorn/bonklm-temporal` — Temporal SDK middleware for BonkLM.
 *
 * A later phase completes the full SDK
 * integration (proxyActivities typed helpers, sample worker setup,
 * end-to-end integration test against an embedded Temporal server).
 *
 * Surface split per Temporal's non-determinism rule:
 *   - `createValidateInputActivity({validators, cache?})` — register
 *     this on your Temporal worker as an activity. Validators run
 *     here (network I/O OK).
 *   - `guardrailGate(activityResult)` — call from inside a workflow
 *     after awaiting the activity. Throws a terminal, non-retryable
 *     `ApplicationFailure` on BLOCK.
 */
export {
  createValidateInputActivity,
  type ValidateInputActivityArgs,
  type ValidateInputActivityResult,
  type ValidatorActivityConfig
} from './activity.js';
export { guardrailGate, TemporalGuardrailBlockedError } from './workflow.js';
