/**
 * tsd type-surface suite — @blackunicorn/bonklm-genkit (ST-04-210).
 *
 * Locks the published public type surface (imports by package name so it
 * resolves the package `types` entry exactly as a consumer would):
 *   - `createGenkitGuardrailsPlugin(options?)` (returns an inline 5-hook
 *     object NOT exported as a named type — asserted via `ReturnType<>`
 *     and by drilling each hook's signature),
 *   - `wrapFlow<TInput, TOutput>(flow, options?)` (generic — both type
 *     params preserved through the wrap),
 *   - the `messagesToText` / `toolCallsToText` / `normalizeToString` helpers,
 *   - the `StreamValidationError` re-export,
 *   - six exported structural / option types,
 *   - four numeric constants (literal-vs-widened asserted exactly).
 *
 * Run via `pnpm exec tsd`. Lives in test-d/ (tsd's default dir).
 */
import { expectType, expectError, expectAssignable, expectNotAssignable } from 'tsd';
import {
  createGenkitGuardrailsPlugin,
  wrapFlow,
  messagesToText,
  toolCallsToText,
  normalizeToString,
  StreamValidationError,
  VALIDATION_INTERVAL,
  DEFAULT_MAX_BUFFER_SIZE,
  DEFAULT_MAX_CONTENT_LENGTH,
  DEFAULT_VALIDATION_TIMEOUT,
  type GuardedGenkitOptions,
  type GenkitMessage,
  type GenkitToolCall,
  type GenkitFlowContext,
  type FlowHookResult,
  type GenkitContentPart
} from '@blackunicorn/bonklm-genkit';

// --- createGenkitGuardrailsPlugin (options optional; inline-object return) --
expectType<ReturnType<typeof createGenkitGuardrailsPlugin>>(createGenkitGuardrailsPlugin());
expectType<ReturnType<typeof createGenkitGuardrailsPlugin>>(createGenkitGuardrailsPlugin({ validators: [] }));
const plugin = createGenkitGuardrailsPlugin();
expectType<(input: string | GenkitMessage[], context?: GenkitFlowContext) => Promise<FlowHookResult>>(
  plugin.beforeFlow
);
expectType<(response: string | GenkitMessage, context?: GenkitFlowContext) => Promise<FlowHookResult>>(
  plugin.afterFlow
);
expectType<(toolCall: GenkitToolCall, context?: GenkitFlowContext) => Promise<FlowHookResult>>(plugin.validateToolCall);
expectType<(toolResponse: string | GenkitMessage, context?: GenkitFlowContext) => Promise<FlowHookResult>>(
  plugin.validateToolResponse
);
expectType<(context?: GenkitFlowContext) => (chunk: string) => Promise<string | null>>(plugin.createStreamValidator);
expectError(createGenkitGuardrailsPlugin({ validateStreaming: 'yes' }));

// --- wrapFlow (generic — TInput / TOutput preserved) ------------------------
declare const stringFlow: (input: string) => Promise<string>;
expectType<(input: string) => Promise<string>>(wrapFlow(stringFlow));
declare const numberFlow: (input: number) => Promise<boolean>;
expectType<(input: number) => Promise<boolean>>(wrapFlow(numberFlow, { validators: [] }));
expectError(wrapFlow()); // flow required
expectError(wrapFlow(stringFlow, { validateStreaming: 'yes' }));

// --- helpers ----------------------------------------------------------------
declare const messages: GenkitMessage[];
declare const toolCalls: GenkitToolCall[];
expectType<string>(messagesToText(messages));
expectType<string>(toolCallsToText(toolCalls));
expectType<string>(normalizeToString({ anything: true }));
expectType<string>(normalizeToString('plain'));
expectError(messagesToText('not-an-array'));
expectError(toolCallsToText());

// --- StreamValidationError re-export ----------------------------------------
const sve = new StreamValidationError('msg');
expectType<StreamValidationError>(sve);
expectAssignable<Error>(sve);

// --- GuardedGenkitOptions (every field optional) ----------------------------
expectAssignable<GuardedGenkitOptions>({});
expectAssignable<GuardedGenkitOptions>({
  validators: [],
  guards: [],
  validateFlowInput: true,
  validateFlowOutput: true,
  validateToolCalls: true,
  validateToolResponses: true,
  validateStreaming: false,
  streamingMode: 'incremental',
  maxStreamBufferSize: 2048,
  maxContentLength: 1000,
  productionMode: false,
  validationTimeout: 1000,
  onBlocked: () => {},
  onStreamBlocked: () => {},
  onToolCallBlocked: () => {}
});
expectNotAssignable<GuardedGenkitOptions>({ streamingMode: 'nope' }); // not in union
expectNotAssignable<GuardedGenkitOptions>({ validateStreaming: 'yes' }); // boolean field

// --- GenkitMessage (role + content required) --------------------------------
expectAssignable<GenkitMessage>({ role: 'user', content: 'hi' });
expectAssignable<GenkitMessage>({ role: 'model', content: [{ type: 'text', text: 'x' }], metadata: { a: 1 } });
expectNotAssignable<GenkitMessage>({ role: 'assistant', content: 'hi' }); // 'user'|'model'|'system'|'tool'
expectNotAssignable<GenkitMessage>({ content: 'hi' }); // role required
expectNotAssignable<GenkitMessage>({ role: 'user' }); // content required

// --- GenkitContentPart (type required, discriminated) -----------------------
expectAssignable<GenkitContentPart>({ type: 'text', text: 'x' });
expectAssignable<GenkitContentPart>({ type: 'toolRequest', toolRequest: { name: 'fn', input: {} } });
expectNotAssignable<GenkitContentPart>({ type: 'audio' }); // not in union
expectNotAssignable<GenkitContentPart>({}); // type required

// --- GenkitToolCall (name required) -----------------------------------------
expectAssignable<GenkitToolCall>({ name: 'fn' });
expectAssignable<GenkitToolCall>({ name: 'fn', input: { a: 1 } });
expectNotAssignable<GenkitToolCall>({}); // name required
expectNotAssignable<GenkitToolCall>({ name: 123 }); // name is string

// --- GenkitFlowContext (every field optional) -------------------------------
expectAssignable<GenkitFlowContext>({});
expectAssignable<GenkitFlowContext>({ flowName: 'f', sessionId: 's', userId: 'u' });
expectNotAssignable<GenkitFlowContext>({ flowName: 1 }); // string field

// --- FlowHookResult (allowed required) --------------------------------------
expectAssignable<FlowHookResult>({ allowed: true });
expectAssignable<FlowHookResult>({ allowed: false, blockedReason: 'r', modifiedContent: 'm' });
expectNotAssignable<FlowHookResult>({}); // allowed required
expectNotAssignable<FlowHookResult>({ allowed: 'yes' }); // boolean field

// --- constants: literal for `= 10` / `= 100000` / `= 30000`, widened a*b ----
expectType<10>(VALIDATION_INTERVAL);
expectType<number>(DEFAULT_MAX_BUFFER_SIZE); // `1024 * 1024` widens to number
expectType<100000>(DEFAULT_MAX_CONTENT_LENGTH);
expectType<30000>(DEFAULT_VALIDATION_TIMEOUT);
