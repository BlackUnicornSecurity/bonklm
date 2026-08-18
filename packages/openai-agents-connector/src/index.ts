// SPDX-License-Identifier: Apache-2.0
/**
 * @blackunicorn/bonklm-openai-agents
 * ==================================
 * BonkLM connector for the `@openai/agents ^0.11.0` SDK. Wraps the four
 * primary surfaces (Agent, Tool, Handoff, Realtime) with guardrails
 * derived from BonkLM's validator chain.
 *
 * @example
 * ```ts
 * import { Agent, run } from '@openai/agents';
 * import { GuardrailEngine, PromptInjectionValidator } from '@blackunicorn/bonklm';
 * import { wrapAgent } from '@blackunicorn/bonklm-openai-agents';
 *
 * const engine = new GuardrailEngine({ validators: [new PromptInjectionValidator()] });
 * const agent = wrapAgent(
 *   new Agent({ name: 'support', instructions: 'Help the user.' }),
 *   engine,
 *   { productionMode: true }
 * );
 * await run(agent, userMessage);
 * ```
 */
export {
  defineInputGuardrail,
  defineOutputGuardrail,
  defineToolInputGuardrail,
  defineToolOutputGuardrail,
  wrapAgent,
  wrapHandoff,
  wrapRealtime
} from './guarded-openai-agents.js';

export type {
  AgentLike,
  AgentToolLike,
  AgentInputGuardrailLike,
  AgentInputGuardrailArgs,
  AgentInputGuardrailResult,
  AgentOutputGuardrailLike,
  AgentOutputGuardrailArgs,
  AgentOutputGuardrailResult,
  GuardedAgentBundle,
  GuardedAgentsOptions,
  HandoffLike,
  RealtimeOutputGuardrailLike,
  RealtimeSessionLike,
  ToolInputGuardrailLike,
  ToolInputGuardrailArgs,
  ToolInputGuardrailResult,
  ToolOutputGuardrailLike,
  ToolOutputGuardrailArgs,
  ToolOutputGuardrailResult
} from './types.js';

export { DEFAULT_VALIDATION_TIMEOUT } from './types.js';

export { ConnectorValidationError } from '@blackunicorn/bonklm/core/connector-utils';
