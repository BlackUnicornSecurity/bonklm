/**
 * tsd type-surface suite — @blackunicorn/bonklm-stagehand (ST-04-232).
 *
 * Locks the published public type surface (imports by package name):
 * the generic `wrapStagehand` factory (client type `T` is preserved,
 * not widened, and bounded by `extends StagehandLike`), the
 * `StagehandGuardrailBlockedError` class — whose `action` is NARROWED
 * to a four-member string-literal union (the discriminating contrast
 * with Eko's base `string`) and `surface` is the four-member surface
 * union — and the `StagehandLike` / `WrapStagehandOptions` shape types.
 * Run via `pnpm exec tsd`.
 */
import { expectType, expectError, expectAssignable, expectNotAssignable } from 'tsd';
import type { GuardrailEngine } from '@blackunicorn/bonklm';
import {
  wrapStagehand,
  StagehandGuardrailBlockedError,
  type StagehandLike,
  type WrapStagehandOptions
} from '@blackunicorn/bonklm-stagehand';

declare const engine: GuardrailEngine;

// --- wrapStagehand: generic <T extends StagehandLike>, preserves client type
declare const client: StagehandLike & { extra: number };
expectType<StagehandLike & { extra: number }>(wrapStagehand(client, engine));
expectType<StagehandLike & { extra: number }>(wrapStagehand(client, engine, { allowCuaMode: true }));
expectAssignable<{ extra: number }>(wrapStagehand(client, engine));
expectNotAssignable<{ extra: string }>(wrapStagehand(client, engine));
expectError(wrapStagehand(client)); // engine required (2nd positional)
expectError(wrapStagehand(client, engine, { allowCuaMode: 'yes' })); // bad option type
expectError(wrapStagehand({}, engine)); // T extends StagehandLike — act/extract/observe required

// --- StagehandLike (act/extract/observe required, agent optional) -----------
expectAssignable<StagehandLike>({
  act: async () => undefined,
  extract: async <T = unknown>(): Promise<T> => undefined as unknown as T,
  observe: async () => undefined
});
expectAssignable<StagehandLike>({
  act: async () => undefined,
  extract: async <T = unknown>(): Promise<T> => undefined as unknown as T,
  observe: async () => undefined,
  agent: { execute: async () => undefined }
});
expectNotAssignable<StagehandLike>({ act: async () => undefined }); // extract + observe required
expectNotAssignable<StagehandLike>({}); // act required

// --- WrapStagehandOptions (every field optional) ----------------------------
expectAssignable<WrapStagehandOptions>({});
expectAssignable<WrapStagehandOptions>({ allowCuaMode: true, stagehandConfig: { mode: 'cua' } });
expectNotAssignable<WrapStagehandOptions>({ allowCuaMode: 'yes' });

// --- StagehandGuardrailBlockedError class (action NARROWED — discriminating)-
const err = new StagehandGuardrailBlockedError('act', 'tool_call', 'reason');
expectType<StagehandGuardrailBlockedError>(err);
expectType<string>(err.connector);
expectType<'act' | 'extract' | 'observe' | 'agent.execute'>(err.action); // narrowed literal union
expectType<'tool_call' | 'retrieved_doc' | 'text_input' | 'composed_context'>(err.surface);
new StagehandGuardrailBlockedError('agent.execute', 'composed_context', undefined);
expectError(new StagehandGuardrailBlockedError('act', 'tool_call')); // reason required (positional)
expectError(new StagehandGuardrailBlockedError('badaction', 'tool_call', 'r')); // action literal union
