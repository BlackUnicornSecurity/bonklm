/**
 * tsd type-surface suite — @blackunicorn/bonklm-eko (ST-04-231).
 *
 * Locks the published public type surface (imports by package name):
 * the three generic wrap factories (`wrapEko` / `wrapEkoBrowserAgent` /
 * `wrapEkoFileAgent` — each preserves its client/agent type, not
 * widened), the `EkoGuardrailBlockedError` class (whose `action` stays
 * the BASE `string` — the discriminating contrast with Stagehand's
 * narrowed literal union — while `surface` is the four-member union),
 * and every exported shape type. Run via `pnpm exec tsd`.
 */
import { expectType, expectError, expectAssignable, expectNotAssignable } from 'tsd';
import type { GuardrailEngine } from '@blackunicorn/bonklm';
import {
  wrapEko,
  wrapEkoBrowserAgent,
  wrapEkoFileAgent,
  EkoGuardrailBlockedError,
  type EkoLike,
  type EkoBrowserAgentLike,
  type EkoFileAgentLike,
  type EkoMcpClientLike,
  type EkoRunTask,
  type WrapEkoOptions
} from '@blackunicorn/bonklm-eko';

declare const engine: GuardrailEngine;

// --- wrapEko: generic <T extends EkoLike>, preserves client type ------------
declare const client: EkoLike & { extra: number };
expectType<EkoLike & { extra: number }>(wrapEko(client, engine));
expectType<EkoLike & { extra: number }>(wrapEko(client, engine, { allowCuaMode: true }));
expectAssignable<{ extra: number }>(wrapEko(client, engine));
expectNotAssignable<{ extra: string }>(wrapEko(client, engine));
expectError(wrapEko(client)); // engine required (2nd positional)
expectError(wrapEko(client, engine, { allowCuaMode: 'yes' })); // bad option type
expectError(wrapEko({}, engine)); // T extends EkoLike — `run` required

// --- wrapEkoBrowserAgent / wrapEkoFileAgent: generic, preserve agent type ---
declare const browserAgent: EkoBrowserAgentLike & { extra: number };
expectType<EkoBrowserAgentLike & { extra: number }>(wrapEkoBrowserAgent(browserAgent, engine));
expectAssignable<{ extra: number }>(wrapEkoBrowserAgent(browserAgent, engine));
expectError(wrapEkoBrowserAgent(browserAgent)); // engine required

declare const fileAgent: EkoFileAgentLike & { extra: number };
expectType<EkoFileAgentLike & { extra: number }>(wrapEkoFileAgent(fileAgent, engine));
expectAssignable<{ extra: number }>(wrapEkoFileAgent(fileAgent, engine));
expectError(wrapEkoFileAgent(fileAgent)); // engine required

// --- EkoLike (run required) -------------------------------------------------
expectAssignable<EkoLike>({ run: async () => undefined });
expectAssignable<EkoLike>({ run: async () => undefined, agents: {}, mcp: {} });
expectNotAssignable<EkoLike>({}); // run required

// --- EkoBrowserAgentLike / EkoFileAgentLike / EkoMcpClientLike (all optional)
expectAssignable<EkoBrowserAgentLike>({});
expectAssignable<EkoBrowserAgentLike>({ act: async () => undefined });
expectAssignable<EkoFileAgentLike>({});
expectAssignable<EkoFileAgentLike>({ read: async () => 'x' });
expectAssignable<EkoMcpClientLike>({});
expectAssignable<EkoMcpClientLike>({ callTool: async () => undefined });

// --- EkoRunTask (string | { task: string; ... }) ---------------------------
expectAssignable<EkoRunTask>('do thing');
expectAssignable<EkoRunTask>({ task: 'do thing' });
expectAssignable<EkoRunTask>({ task: 'do thing', meta: 1 });
expectNotAssignable<EkoRunTask>({ notTask: 'x' }); // task required in object form
expectNotAssignable<EkoRunTask>(123);

// --- WrapEkoOptions (every field optional) ----------------------------------
expectAssignable<WrapEkoOptions>({});
expectAssignable<WrapEkoOptions>({
  allowCuaMode: true,
  ekoConfig: { mode: 'cua' },
  skipAgents: ['logger-agent']
});
expectNotAssignable<WrapEkoOptions>({ allowCuaMode: 'yes' });

// --- EkoGuardrailBlockedError class -----------------------------------------
const err = new EkoGuardrailBlockedError('act', 'tool_call', 'reason');
expectType<EkoGuardrailBlockedError>(err);
expectType<string>(err.connector);
expectType<string>(err.action); // base `string` — NOT narrowed (contrast w/ Stagehand)
expectType<'tool_call' | 'retrieved_doc' | 'text_input' | 'composed_context'>(err.surface);
new EkoGuardrailBlockedError('mcp.tool', 'retrieved_doc', undefined);
expectError(new EkoGuardrailBlockedError('act')); // surface + reason required
expectError(new EkoGuardrailBlockedError('act', 'tool_call')); // reason required (positional)
expectError(new EkoGuardrailBlockedError('act', 'not-a-surface', 'r')); // surface literal union
