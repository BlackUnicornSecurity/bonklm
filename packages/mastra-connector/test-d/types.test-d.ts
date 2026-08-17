/**
 * tsd type-surface suite — @blackunicorn/bonklm-mastra (ST-04-228).
 *
 * Locks the published public type surface (imports by package name):
 * the `createGuardedMastra` factory (its five hook methods are asserted
 * by exact signature; the internal `_finalizeStream` is NOT on the
 * declared surface), the generic `wrapAgent` factory (agent type
 * `TAgent` preserved, bounded by an `execute` shape), the three text
 * utilities, the four numeric constants (literal vs widened), the
 * re-exported `StreamValidationError`, and every exported shape type.
 * Run via `pnpm exec tsd`.
 */
import { expectType, expectError, expectAssignable, expectNotAssignable } from 'tsd';
import {
  createGuardedMastra,
  wrapAgent,
  messagesToText,
  toolCallsToText,
  normalizeToString,
  StreamValidationError,
  VALIDATION_INTERVAL,
  DEFAULT_MAX_BUFFER_SIZE,
  DEFAULT_MAX_CONTENT_LENGTH,
  DEFAULT_VALIDATION_TIMEOUT,
  type GuardedMastraOptions,
  type MastraMessage,
  type MastraToolCall,
  type MastraAgentContext,
  type AgentHookResult,
  type MastraContentPart
} from '@blackunicorn/bonklm-mastra';

// --- createGuardedMastra: options optional; five hook methods ---------------
const guard = createGuardedMastra();
createGuardedMastra({ validators: [], streamingMode: 'buffer', productionMode: true });
expectType<(messages: MastraMessage[], context?: MastraAgentContext) => Promise<AgentHookResult>>(
  guard.beforeAgentExecution
);
expectType<(response: string | MastraMessage, context?: MastraAgentContext) => Promise<AgentHookResult>>(
  guard.afterAgentExecution
);
expectType<(toolCall: MastraToolCall, context?: MastraAgentContext) => Promise<AgentHookResult>>(
  guard.validateToolCall
);
expectType<
  (
    toolResult: string | MastraMessage,
    toolCall: MastraToolCall,
    context?: MastraAgentContext
  ) => Promise<AgentHookResult>
>(guard.validateToolResult);
expectType<(context?: MastraAgentContext) => (chunk: string) => Promise<string | null>>(guard.createStreamValidator);
expectError(guard._finalizeStream); // internal method is NOT on the declared surface
expectError(createGuardedMastra({ streamingMode: 'turbo' })); // bad literal
expectError(createGuardedMastra({ maxContentLength: 'big' })); // bad option type

// --- wrapAgent: generic, preserves agent type, bounded by `execute` shape ---
declare const agent: {
  execute: (input: string | MastraMessage[]) => Promise<string | MastraMessage>;
  extra: number;
};
expectType<typeof agent>(wrapAgent(agent));
expectType<typeof agent>(wrapAgent(agent, { validators: [] }));
expectAssignable<{ extra: number }>(wrapAgent(agent));
expectNotAssignable<{ extra: string }>(wrapAgent(agent));
expectError(wrapAgent({})); // TAgent must expose `execute`
expectError(wrapAgent({ execute: (_x: number) => Promise.resolve('') })); // wrong execute signature

// --- text utilities ---------------------------------------------------------
expectType<string>(messagesToText([{ role: 'user', content: 'hi' }]));
expectType<string>(toolCallsToText([{ id: '1', name: 'search' }]));
expectType<string>(normalizeToString({ any: 'thing' }));
expectError(messagesToText('not an array')); // needs MastraMessage[]
expectError(toolCallsToText([{ name: 'search' }])); // id required on MastraToolCall

// --- numeric constants (literal vs widened) ---------------------------------
expectType<10>(VALIDATION_INTERVAL);
expectType<number>(DEFAULT_MAX_BUFFER_SIZE); // 1024 * 1024 → widened to number
expectType<100000>(DEFAULT_MAX_CONTENT_LENGTH);
expectType<30000>(DEFAULT_VALIDATION_TIMEOUT);

// --- StreamValidationError (re-exported value) ------------------------------
const sve = new StreamValidationError('msg');
expectType<StreamValidationError>(sve);
expectType<string>(sve.reason);
expectType<boolean>(sve.blocked);
new StreamValidationError('m', 'buffer_exceeded', false);
expectError(new StreamValidationError()); // message required

// --- MastraMessage (role literal union; role + content required) ------------
expectAssignable<MastraMessage>({ role: 'user', content: 'hi' });
expectAssignable<MastraMessage>({ role: 'assistant', content: [{ type: 'text', text: 'hi' }] });
expectNotAssignable<MastraMessage>({ role: 'bot', content: 'hi' }); // role literal union
expectNotAssignable<MastraMessage>({ content: 'hi' }); // role required

// --- MastraContentPart (type literal union) ---------------------------------
expectAssignable<MastraContentPart>({ type: 'text', text: 'hi' });
expectAssignable<MastraContentPart>({ type: 'tool_use', toolUse: { id: '1', name: 't' } });
expectNotAssignable<MastraContentPart>({ type: 'video' }); // type literal union

// --- MastraToolCall (id + name required) ------------------------------------
expectAssignable<MastraToolCall>({ id: '1', name: 'search' });
expectAssignable<MastraToolCall>({ id: '1', name: 'search', input: {} });
expectNotAssignable<MastraToolCall>({ id: '1' }); // name required

// --- MastraAgentContext (agentId required) ----------------------------------
expectAssignable<MastraAgentContext>({ agentId: 'a' });
expectAssignable<MastraAgentContext>({ agentId: 'a', sessionId: 's', userId: 'u', workflowId: 'w' });
expectNotAssignable<MastraAgentContext>({}); // agentId required

// --- AgentHookResult (allowed required) -------------------------------------
expectAssignable<AgentHookResult>({ allowed: true });
expectAssignable<AgentHookResult>({ allowed: false, blockedReason: 'r', modifiedContent: 'm' });
expectNotAssignable<AgentHookResult>({}); // allowed required

// --- GuardedMastraOptions (every field optional) ----------------------------
expectAssignable<GuardedMastraOptions>({});
expectAssignable<GuardedMastraOptions>({ validators: [], streamingMode: 'incremental', maxContentLength: 50 });
expectNotAssignable<GuardedMastraOptions>({ streamingMode: 'turbo' }); // literal union
