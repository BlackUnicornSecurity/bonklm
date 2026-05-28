/**
 * `@blackunicorn/bonklm-voltagent` — VoltAgent connector for BonkLM (Story 3.10).
 *
 * ```ts
 * import { Agent } from '@voltagent/core';
 * import { wrapVoltAgent } from '@blackunicorn/bonklm-voltagent';
 * import { GuardrailEngine, PromptInjectionValidator } from '@blackunicorn/bonklm';
 *
 * const engine = new GuardrailEngine({ validators: [new PromptInjectionValidator()] });
 * const agent = wrapVoltAgent(new Agent({...}), { engine });
 *
 * const result = await agent.generateText({ prompt: 'hello' });
 * // attempts to prompt-inject throw VoltAgentGuardrailBlockedError
 * ```
 */
export { wrapVoltAgent, VoltAgentGuardrailBlockedError } from './wrap-voltagent.js';
export type {
  VoltAgentLike,
  VoltAgentInput,
  VoltAgentOutput,
  VoltAgentStreamChunk,
  VoltAgentBlockEvent,
  WrapVoltAgentOptions
} from './wrap-voltagent.js';
