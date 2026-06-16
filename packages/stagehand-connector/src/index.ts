// SPDX-License-Identifier: Apache-2.0
/**
 * @blackunicorn/bonklm-stagehand
 * ==============================
 * Browserbase Stagehand connector for BonkLM. Wraps `act`, `extract`,
 * `observe`, `agent.execute` so each routes through the right BonkLM
 * validator surface before / after dispatch.
 *
 * **CUA warning**: Stagehand's `mode: 'cua'` (computer-use,
 * screenshot-based) is REFUSED by default. Pass
 * `allowCuaMode: true` to explicitly accept that screenshot bytes
 * are NOT validated by BonkLM (validators inspect text + tool args
 * only). Prompt-injection embedded in page pixels can bypass the
 * pipeline entirely when CUA is enabled. See the package README
 * top-of-file warning + the `BrowserAgentGuardOptions.allowCuaMode`
 * JSDoc for the security rationale.
 *
 * Public surface:
 *   - `wrapStagehand(client, engine, options?)` — wrap an initialised
 *     Stagehand client. Returns the same instance with the four
 *     AI-driven methods intercepted.
 *   - `StagehandGuardrailBlockedError` — thrown when a call is
 *     BLOCKED by the validator pipeline.
 */
export { wrapStagehand, StagehandGuardrailBlockedError } from './wrap-stagehand.js';
export type { StagehandLike, WrapStagehandOptions } from './types.js';
