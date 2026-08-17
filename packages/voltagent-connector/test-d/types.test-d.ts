/**
 * tsd type-surface suite — @blackunicorn/bonklm-voltagent (ST-04-229).
 *
 * Locks the published public type surface (imports by package name):
 * the generic `wrapVoltAgent` factory (agent type `A` is preserved, not
 * widened — proven by an exact `expectType` plus a discriminating
 * `expectAssignable` / `expectNotAssignable`), the
 * `VoltAgentGuardrailBlockedError` class (whose `name` narrows to a string
 * literal and `phase` to a 'input' | 'output' union), and every exported
 * shape type. Run via `pnpm exec tsd`. Lives in test-d/ (tsd's default dir).
 */
import { expectType, expectError, expectAssignable, expectNotAssignable } from 'tsd';
import type { GuardrailEngine } from '@blackunicorn/bonklm';
import {
  wrapVoltAgent,
  VoltAgentGuardrailBlockedError,
  type VoltAgentLike,
  type VoltAgentInput,
  type VoltAgentOutput,
  type VoltAgentStreamChunk,
  type VoltAgentBlockEvent,
  type WrapVoltAgentOptions
} from '@blackunicorn/bonklm-voltagent';

declare const engine: GuardrailEngine;

// --- wrapVoltAgent: generic <A extends VoltAgentLike>, preserves agent type --
declare const agent: VoltAgentLike & { extra: number };
expectType<VoltAgentLike & { extra: number }>(wrapVoltAgent(agent, { engine }));
expectType<VoltAgentLike & { extra: number }>(wrapVoltAgent(agent, { engine, skipOutputValidation: true }));
// Discriminating control: a preserved `A` carries `extra: number`; a widened
// base `VoltAgentLike` would not expose `extra` at all.
expectAssignable<{ extra: number }>(wrapVoltAgent(agent, { engine }));
expectNotAssignable<{ extra: string }>(wrapVoltAgent(agent, { engine }));
expectError(wrapVoltAgent(agent)); // options required (2nd positional)
expectError(wrapVoltAgent(agent, { skipOutputValidation: 'yes' })); // bad option type

// --- VoltAgentLike (generateText required) ----------------------------------
expectAssignable<VoltAgentLike>({ generateText: async () => ({ text: 'x' }) });
expectAssignable<VoltAgentLike>({
  generateText: async () => ({ text: 'x' }),
  streamText: async function* () {},
  name: 'a'
});
expectNotAssignable<VoltAgentLike>({}); // generateText required

// --- VoltAgentInput (all fields optional) -----------------------------------
expectAssignable<VoltAgentInput>({});
expectAssignable<VoltAgentInput>({ prompt: 'hi' });
expectAssignable<VoltAgentInput>({ messages: [{ role: 'user', content: 'hi' }] });
expectNotAssignable<VoltAgentInput>({ prompt: 123 });

// --- VoltAgentOutput (text required) ----------------------------------------
expectAssignable<VoltAgentOutput>({ text: 'x' });
expectAssignable<VoltAgentOutput>({ text: 'x', usage: {} });
expectNotAssignable<VoltAgentOutput>({}); // text required

// --- VoltAgentStreamChunk (all fields optional) -----------------------------
expectAssignable<VoltAgentStreamChunk>({});
expectAssignable<VoltAgentStreamChunk>({ text: 'a', delta: 'b' });

// --- VoltAgentBlockEvent (kind / provider literals) -------------------------
expectAssignable<VoltAgentBlockEvent>({
  kind: 'inference',
  provider: 'voltagent',
  phase: 'input',
  reason: 'r'
});
expectAssignable<VoltAgentBlockEvent>({
  kind: 'inference',
  provider: 'voltagent',
  phase: 'output',
  reason: 'r',
  category: 'c',
  severity: 's'
});
expectNotAssignable<VoltAgentBlockEvent>({
  kind: 'other',
  provider: 'voltagent',
  phase: 'input',
  reason: 'r'
}); // kind is the literal 'inference'

// --- WrapVoltAgentOptions (every field optional) ----------------------------
expectAssignable<WrapVoltAgentOptions>({});
expectAssignable<WrapVoltAgentOptions>({
  engine,
  inputValidators: [],
  skipOutputValidation: true,
  onBlock: () => {},
  onError: () => {}
});
expectNotAssignable<WrapVoltAgentOptions>({ skipOutputValidation: 'no' });

// --- VoltAgentGuardrailBlockedError class -----------------------------------
const err = new VoltAgentGuardrailBlockedError('msg', 'input');
expectType<VoltAgentGuardrailBlockedError>(err);
expectType<'VoltAgentGuardrailBlockedError'>(err.name); // override readonly literal
expectType<'input' | 'output'>(err.phase);
expectType<string | undefined>(err.category);
expectType<string | undefined>(err.severity);
new VoltAgentGuardrailBlockedError('msg', 'output', { category: 'c', severity: 's' });
expectError(new VoltAgentGuardrailBlockedError('msg')); // phase required
expectError(new VoltAgentGuardrailBlockedError('msg', 'sideways')); // phase literal union
