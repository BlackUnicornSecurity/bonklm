/**
 * tsd type-surface suite — @blackunicorn/bonklm-copilotkit (ST-04-211).
 *
 * Locks the published public type surface (imports by package name so it
 * resolves the package `types` entry exactly as a consumer would):
 *   - `createGuardedCopilotKit(options?)` (returns an inline 5-hook object
 *     NOT exported as a named type — asserted via `ReturnType<>` and by
 *     drilling each hook's signature),
 *   - the `messagesToText` / `actionsToText` / `normalizeToString` helpers,
 *   - the `StreamValidationError` re-export,
 *   - six exported structural / option types (incl. the action-policy fields),
 *   - four numeric constants (literal-vs-widened asserted exactly).
 *
 * Run via `pnpm exec tsd`. Lives in test-d/ (tsd's default dir).
 */
import { expectType, expectError, expectAssignable, expectNotAssignable } from 'tsd';
import {
  createGuardedCopilotKit,
  messagesToText,
  actionsToText,
  normalizeToString,
  StreamValidationError,
  VALIDATION_INTERVAL,
  DEFAULT_MAX_BUFFER_SIZE,
  DEFAULT_MAX_CONTENT_LENGTH,
  DEFAULT_VALIDATION_TIMEOUT,
  type GuardedCopilotKitOptions,
  type CopilotKitMessage,
  type CopilotKitAction,
  type CopilotKitContext,
  type HookResult,
  type CopilotKitContentPart
} from '@blackunicorn/bonklm-copilotkit';

// --- createGuardedCopilotKit (options optional; inline-object return) -------
expectType<ReturnType<typeof createGuardedCopilotKit>>(createGuardedCopilotKit());
expectType<ReturnType<typeof createGuardedCopilotKit>>(createGuardedCopilotKit({ validators: [] }));
const guard = createGuardedCopilotKit();
expectType<(messages: CopilotKitMessage[], context?: CopilotKitContext) => Promise<HookResult>>(
  guard.beforeSendMessage
);
expectType<(message: CopilotKitMessage, context?: CopilotKitContext) => Promise<HookResult>>(guard.afterReceiveMessage);
expectType<(action: CopilotKitAction, context?: CopilotKitContext) => Promise<HookResult>>(guard.validateActionCall);
expectType<(actionResult: string, context?: CopilotKitContext) => Promise<HookResult>>(guard.validateActionResult);
expectType<(context?: CopilotKitContext) => (chunk: string) => Promise<string | null>>(guard.createStreamValidator);
expectError(createGuardedCopilotKit({ validateStreaming: 'yes' }));

// --- helpers ----------------------------------------------------------------
declare const messages: CopilotKitMessage[];
declare const actions: CopilotKitAction[];
expectType<string>(messagesToText(messages));
expectType<string>(actionsToText(actions));
expectType<string>(normalizeToString({ anything: true }));
expectType<string>(normalizeToString('plain'));
expectError(messagesToText('not-an-array'));
expectError(actionsToText());

// --- StreamValidationError re-export ----------------------------------------
const sve = new StreamValidationError('msg');
expectType<StreamValidationError>(sve);
expectAssignable<Error>(sve);

// --- GuardedCopilotKitOptions (every field optional, incl. action policy) ---
expectAssignable<GuardedCopilotKitOptions>({});
expectAssignable<GuardedCopilotKitOptions>({
  validators: [],
  guards: [],
  validateUserMessages: true,
  validateAssistantMessages: true,
  validateActionCalls: true,
  validateActionResults: true,
  validateStreaming: false,
  streamingMode: 'buffer',
  maxStreamBufferSize: 2048,
  maxContentLength: 1000,
  productionMode: false,
  validationTimeout: 1000,
  onBlocked: () => {},
  onStreamBlocked: () => {},
  onActionCallBlocked: () => {},
  allowedActionNames: ['search'],
  blockedActionNames: ['eval'],
  maxActionNameLength: 100,
  maxArgumentsSize: 100000
});
expectNotAssignable<GuardedCopilotKitOptions>({ streamingMode: 'nope' }); // not in union
expectNotAssignable<GuardedCopilotKitOptions>({ allowedActionNames: 'search' }); // string[] field
expectNotAssignable<GuardedCopilotKitOptions>({ maxActionNameLength: '100' }); // number field

// --- CopilotKitMessage (role + content required) ----------------------------
expectAssignable<CopilotKitMessage>({ role: 'user', content: 'hi' });
expectAssignable<CopilotKitMessage>({ role: 'assistant', content: [{ type: 'text', text: 'x' }], isText: true });
expectNotAssignable<CopilotKitMessage>({ role: 'model', content: 'hi' }); // 'user'|'assistant'|'system'
expectNotAssignable<CopilotKitMessage>({ content: 'hi' }); // role required
expectNotAssignable<CopilotKitMessage>({ role: 'user' }); // content required

// --- CopilotKitContentPart (type required, discriminated) -------------------
expectAssignable<CopilotKitContentPart>({ type: 'text', text: 'x' });
expectAssignable<CopilotKitContentPart>({ type: 'image', image: { url: 'u' } });
expectNotAssignable<CopilotKitContentPart>({ type: 'toolRequest' }); // genkit-only — not in this union
expectNotAssignable<CopilotKitContentPart>({}); // type required

// --- CopilotKitAction (name required) ---------------------------------------
expectAssignable<CopilotKitAction>({ name: 'search' });
expectAssignable<CopilotKitAction>({ name: 'search', description: 'd', args: { q: 1 } });
expectNotAssignable<CopilotKitAction>({}); // name required
expectNotAssignable<CopilotKitAction>({ name: 123 }); // name is string

// --- CopilotKitContext (every field optional) -------------------------------
expectAssignable<CopilotKitContext>({});
expectAssignable<CopilotKitContext>({ userId: 'u', conversationId: 'c' });
expectNotAssignable<CopilotKitContext>({ userId: 1 }); // string field

// --- HookResult (allowed required) ------------------------------------------
expectAssignable<HookResult>({ allowed: true });
expectAssignable<HookResult>({ allowed: false, blockedReason: 'r', modifiedContent: 'm' });
expectNotAssignable<HookResult>({}); // allowed required
expectNotAssignable<HookResult>({ allowed: 'yes' }); // boolean field

// --- constants: literal for `= 10` / `= 100000` / `= 30000`, widened a*b ----
expectType<10>(VALIDATION_INTERVAL);
expectType<number>(DEFAULT_MAX_BUFFER_SIZE); // `1024 * 1024` widens to number
expectType<100000>(DEFAULT_MAX_CONTENT_LENGTH);
expectType<30000>(DEFAULT_VALIDATION_TIMEOUT);
