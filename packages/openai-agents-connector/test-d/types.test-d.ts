/**
 * tsd type-surface suite — @blackunicorn/bonklm-openai-agents (ST-04-230).
 *
 * Locks the published public type surface (imports by package name):
 * the four `define*Guardrail` factories (engine required, options + name
 * optional, each returning its matching `*GuardrailLike`), the three
 * wrap factories, the `DEFAULT_VALIDATION_TIMEOUT` constant, the
 * re-exported `ConnectorValidationError`, and all nineteen exported
 * shape types.
 *
 * DISCRIMINATING CONTROL: `wrapAgent` here is NOT generic — it is typed
 * `(agent: AgentLike, ...) => AgentLike`, so the caller's concrete
 * subtype is WIDENED to `AgentLike` (extra members are dropped from the
 * return). This is the deliberate contrast against every generic
 * `wrap*<T>` factory in the other connectors, which preserve `T`.
 * Run via `pnpm exec tsd`.
 */
import { expectType, expectError, expectAssignable, expectNotAssignable } from 'tsd';
import type { GuardrailEngine } from '@blackunicorn/bonklm';
import {
  defineInputGuardrail,
  defineOutputGuardrail,
  defineToolInputGuardrail,
  defineToolOutputGuardrail,
  wrapAgent,
  wrapHandoff,
  wrapRealtime,
  DEFAULT_VALIDATION_TIMEOUT,
  ConnectorValidationError,
  type AgentLike,
  type AgentToolLike,
  type AgentInputGuardrailLike,
  type AgentInputGuardrailArgs,
  type AgentInputGuardrailResult,
  type AgentOutputGuardrailLike,
  type AgentOutputGuardrailArgs,
  type AgentOutputGuardrailResult,
  type GuardedAgentBundle,
  type GuardedAgentsOptions,
  type HandoffLike,
  type RealtimeOutputGuardrailLike,
  type RealtimeSessionLike,
  type ToolInputGuardrailLike,
  type ToolInputGuardrailArgs,
  type ToolInputGuardrailResult,
  type ToolOutputGuardrailLike,
  type ToolOutputGuardrailArgs,
  type ToolOutputGuardrailResult
} from '@blackunicorn/bonklm-openai-agents';

declare const engine: GuardrailEngine;

// --- define*Guardrail factories (engine required; options + name optional) --
expectType<AgentInputGuardrailLike>(defineInputGuardrail(engine));
expectType<AgentOutputGuardrailLike>(defineOutputGuardrail(engine));
expectType<ToolInputGuardrailLike>(defineToolInputGuardrail(engine));
expectType<ToolOutputGuardrailLike>(defineToolOutputGuardrail(engine));
defineInputGuardrail(engine, { validators: [] }, 'custom_name');
defineOutputGuardrail(engine, { productionMode: true });
expectError(defineInputGuardrail()); // engine required
expectError(defineInputGuardrail(engine, { validators: 'no' })); // bad option type

// --- wrapAgent: NOT generic — return WIDENED to AgentLike (discriminating) --
declare const agentWithExtra: AgentLike & { extra: number };
expectType<AgentLike>(wrapAgent(agentWithExtra, engine)); // return is AgentLike, not the input subtype
expectNotAssignable<{ extra: number }>(wrapAgent(agentWithExtra, engine)); // extra LOST — not preserved
wrapAgent(agentWithExtra, engine, { logger: undefined, validationTimeout: 5000 });
expectError(wrapAgent(agentWithExtra)); // engine required (2nd positional)
expectError(wrapAgent('nope', engine)); // agent must be AgentLike (object)
expectError(wrapAgent({ name: 123 }, engine)); // AgentLike.name?: string

// --- wrapHandoff / wrapRealtime (engine required; identity-typed return) ----
declare const handoff: HandoffLike;
declare const session: RealtimeSessionLike;
expectType<HandoffLike>(wrapHandoff(handoff, engine));
expectType<RealtimeSessionLike>(wrapRealtime(session, engine));
expectError(wrapHandoff(handoff)); // engine required
expectError(wrapRealtime(session)); // engine required

// --- DEFAULT_VALIDATION_TIMEOUT (literal 30_000) ----------------------------
expectType<30000>(DEFAULT_VALIDATION_TIMEOUT);

// --- ConnectorValidationError (re-exported value) ---------------------------
const cve = new ConnectorValidationError('msg');
expectType<ConnectorValidationError>(cve);
expectType<string>(cve.category);
expectType<number | undefined>(cve.statusCode);
new ConnectorValidationError('m', 'category', 400);
expectError(new ConnectorValidationError()); // message required

// --- AgentLike (every field optional) ---------------------------------------
expectAssignable<AgentLike>({});
expectAssignable<AgentLike>({ name: 'support', instructions: 'help', tools: [], handoffs: [] });
expectNotAssignable<AgentLike>({ name: 123 }); // name?: string

// --- AgentToolLike (every field optional) -----------------------------------
expectAssignable<AgentToolLike>({});
expectAssignable<AgentToolLike>({ name: 'search', description: 'd', parameters: {} });
expectNotAssignable<AgentToolLike>({ name: 5 }); // name?: string

// --- AgentInputGuardrailLike / Args / Result --------------------------------
expectAssignable<AgentInputGuardrailLike>({ name: 'g', execute: async () => ({ tripwireTriggered: false }) });
expectNotAssignable<AgentInputGuardrailLike>({ name: 'g' }); // execute required
expectAssignable<AgentInputGuardrailArgs>({ input: 'raw user text' });
expectAssignable<AgentInputGuardrailArgs>({ input: 'x', context: { any: 1 }, agent: { name: 'a' } });
expectType<unknown>(({} as AgentInputGuardrailArgs).input); // `input` is `unknown` (declared union ends in `unknown`)
expectNotAssignable<AgentInputGuardrailArgs>({}); // input required
expectAssignable<AgentInputGuardrailResult>({ tripwireTriggered: true });
expectAssignable<AgentInputGuardrailResult>({ tripwireTriggered: false, outputInfo: { any: 'thing' } });
expectNotAssignable<AgentInputGuardrailResult>({}); // tripwireTriggered required
expectNotAssignable<AgentInputGuardrailResult>({ tripwireTriggered: 'yes' }); // must be boolean

// --- AgentOutputGuardrailLike / Args / Result -------------------------------
expectAssignable<AgentOutputGuardrailLike>({ name: 'g', execute: async () => ({ tripwireTriggered: false }) });
expectNotAssignable<AgentOutputGuardrailLike>({ name: 'g' }); // execute required
expectAssignable<AgentOutputGuardrailArgs>({ input: 'x', agentOutput: 'y' });
expectNotAssignable<AgentOutputGuardrailArgs>({ input: 'x' }); // agentOutput required
expectAssignable<AgentOutputGuardrailResult>({ tripwireTriggered: true });
expectNotAssignable<AgentOutputGuardrailResult>({}); // tripwireTriggered required

// --- ToolInputGuardrailLike / Args / Result ---------------------------------
expectAssignable<ToolInputGuardrailLike>({ name: 'g', execute: async () => ({ tripwireTriggered: false }) });
expectNotAssignable<ToolInputGuardrailLike>({ name: 'g' }); // execute required
expectAssignable<ToolInputGuardrailArgs>({}); // every field optional
expectAssignable<ToolInputGuardrailArgs>({ toolName: 't', toolArgs: {}, context: {}, agent: {} });
expectAssignable<ToolInputGuardrailResult>({ tripwireTriggered: true });
expectNotAssignable<ToolInputGuardrailResult>({}); // tripwireTriggered required

// --- ToolOutputGuardrailLike / Args / Result --------------------------------
expectAssignable<ToolOutputGuardrailLike>({ name: 'g', execute: async () => ({ tripwireTriggered: false }) });
expectNotAssignable<ToolOutputGuardrailLike>({ name: 'g' }); // execute required
expectAssignable<ToolOutputGuardrailArgs>({}); // every field optional
expectAssignable<ToolOutputGuardrailArgs>({ toolName: 't', toolOutput: 'r', context: {}, agent: {} });
expectAssignable<ToolOutputGuardrailResult>({ tripwireTriggered: true });
expectNotAssignable<ToolOutputGuardrailResult>({}); // tripwireTriggered required

// --- HandoffLike (every field optional) -------------------------------------
expectAssignable<HandoffLike>({});
expectAssignable<HandoffLike>({ name: 'transfer', agent: {}, inputFilter: d => d });
expectNotAssignable<HandoffLike>({ name: 99 }); // name?: string

// --- RealtimeSessionLike (every field optional) -----------------------------
expectAssignable<RealtimeSessionLike>({});
expectAssignable<RealtimeSessionLike>({ on: () => undefined, outputGuardrails: [], close: () => undefined });

// --- RealtimeOutputGuardrailLike (name + execute required) ------------------
expectAssignable<RealtimeOutputGuardrailLike>({ name: 'r', execute: async () => ({ tripwireTriggered: false }) });
expectNotAssignable<RealtimeOutputGuardrailLike>({ name: 'r' }); // execute required

// --- GuardedAgentsOptions (every field optional) ----------------------------
expectAssignable<GuardedAgentsOptions>({});
expectAssignable<GuardedAgentsOptions>({
  validators: [],
  guards: [],
  productionMode: true,
  validationTimeout: 5000,
  onInputBlocked: () => undefined,
  onOutputBlocked: () => undefined,
  onToolBlocked: () => undefined,
  onHandoffBlocked: () => undefined
});
expectNotAssignable<GuardedAgentsOptions>({ productionMode: 'yes' }); // must be boolean

// --- GuardedAgentBundle (both counts required) ------------------------------
expectAssignable<GuardedAgentBundle>({ inputGuardrailCount: 0, outputGuardrailCount: 0 });
expectNotAssignable<GuardedAgentBundle>({ inputGuardrailCount: 0 }); // outputGuardrailCount required
