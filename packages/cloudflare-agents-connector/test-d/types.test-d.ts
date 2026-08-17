/**
 * tsd type-surface suite — @blackunicorn/bonklm-cloudflare-agents (ST-04-225).
 *
 * Locks the published public type surface (imports by package name): the
 * `withBonklmAgent` mixin (preserves the base Agent class type), the
 * `CloudflareAgentBlockedError` class, and the structural Agent / Durable
 * Object / SQL surface types. Run via `pnpm exec tsd`. Lives in test-d/
 * (tsd's default dir).
 */
import { expectType, expectError, expectAssignable, expectNotAssignable } from 'tsd';
import type { GuardrailEngine, Validator } from '@blackunicorn/bonklm';
import {
  withBonklmAgent,
  CloudflareAgentBlockedError,
  type AgentLike,
  type AgentExecutionContextLike,
  type BonklmAgentConfig,
  type BonklmAgentHookContext,
  type CloudflareAgentBlockEvent,
  type DurableObjectStorageLike,
  type SqlStorageLike
} from '@blackunicorn/bonklm-cloudflare-agents';

declare const engine: GuardrailEngine;
declare const validators: Validator[];

// --- withBonklmAgent: returns the same Agent base class type (mixin) --------
// The base must match the `AgentClassLike<S>` constraint (`new (...args) =>
// AgentLike<S>`); AgentLike is invariant in S, so the representative base
// uses the default `unknown` state — exactly how `Agent` is consumed.
declare const BaseAgent: new (...args: unknown[]) => AgentLike;
const Mixed = withBonklmAgent(BaseAgent, { engine });
expectType<typeof BaseAgent>(Mixed);
expectError(withBonklmAgent(BaseAgent, {})); // engine required

// --- BonklmAgentConfig shape ------------------------------------------------
expectAssignable<BonklmAgentConfig>({ engine });
expectAssignable<BonklmAgentConfig>({
  engine,
  memoryWriteValidators: validators,
  retrievedDocValidators: validators,
  onBlock: _event => {},
  onError: _err => {}
});
expectNotAssignable<BonklmAgentConfig>({}); // engine required

// --- CloudflareAgentBlockEvent shape (kind + surface discriminators) --------
expectAssignable<CloudflareAgentBlockEvent>({ kind: 'cf-agent', surface: 'setState', reason: 'r', broadcast: true });
expectAssignable<CloudflareAgentBlockEvent>({ kind: 'document', surface: 'sql_select', reason: 'r', broadcast: false });
expectNotAssignable<CloudflareAgentBlockEvent>({
  kind: 'cf-agent',
  surface: 'onMessage',
  reason: 'r',
  broadcast: true
}); // surface union
expectNotAssignable<CloudflareAgentBlockEvent>({ kind: 'nope', surface: 'setState', reason: 'r', broadcast: true }); // kind union
expectNotAssignable<CloudflareAgentBlockEvent>({ kind: 'cf-agent', surface: 'setState', reason: 'r' }); // broadcast required

// --- BonklmAgentHookContext + surface union ---------------------------------
expectAssignable<BonklmAgentHookContext>({ broadcast: false, surface: 'storage_get' });
expectAssignable<BonklmAgentHookContext['surface']>('storage_getAlarm');
expectNotAssignable<BonklmAgentHookContext['surface']>('bogus');

// --- structural SDK surfaces ------------------------------------------------
expectAssignable<AgentLike>({});
expectAssignable<AgentLike<{ n: number }>>({ state: { n: 1 }, setState: _s => {} });
expectAssignable<SqlStorageLike>((_strings: TemplateStringsArray, ..._values: unknown[]) => [{ id: 1 }]);

declare const execCtx: AgentExecutionContextLike;
expectType<DurableObjectStorageLike>(execCtx.storage);
expectType<Promise<number | null>>(execCtx.storage.getAlarm());
expectType<Promise<Map<string, unknown>>>(execCtx.storage.list());

// --- CloudflareAgentBlockedError class --------------------------------------
const err = new CloudflareAgentBlockedError('blocked', 'sql_select', false, { category: 'c', severity: 'critical' });
expectType<CloudflareAgentBlockedError>(err);
expectType<'CloudflareAgentBlockedError'>(err.name);
expectType<BonklmAgentHookContext['surface']>(err.surface);
expectType<boolean>(err.broadcast);
expectType<string | undefined>(err.category);
expectType<string | undefined>(err.severity);
expectError(new CloudflareAgentBlockedError('blocked')); // surface + broadcast required
expectError(new CloudflareAgentBlockedError('blocked', 'bogus_surface', true)); // surface must be a union member
