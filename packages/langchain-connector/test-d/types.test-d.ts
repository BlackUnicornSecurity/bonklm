/**
 * tsd type-surface suite — @blackunicorn/bonklm-langchain (ST-04-207).
 *
 * Locks the published public type surface (imports by package name so it
 * resolves the package `types` entry exactly as a consumer would) and proves
 * the signatures reject misuse. Covers:
 *   - the deprecated `GuardrailsCallbackHandler` class + its two `is*` guards,
 *   - the langchain@1.x middleware factory (`createBonklmMiddleware`, both
 *     overloads), the retriever wrap (generic-preserving) and the two
 *     LangGraph node entry points,
 *   - the `GuardrailsViolationError` class + three re-exported core connector
 *     error classes,
 *   - eleven exported structural / option / union types,
 *   - three numeric constants (literal-vs-widened asserted exactly).
 *
 * Run via `pnpm exec tsd`. Lives in test-d/ (tsd's default dir) so vitest
 * test files stay out of scope.
 */
import { expectType, expectError, expectAssignable, expectNotAssignable } from 'tsd';
import type { GuardrailEngine, GuardrailResult, Validator } from '@blackunicorn/bonklm';
import {
  GuardrailsCallbackHandler,
  isGuardrailsViolationError,
  isStreamValidationError,
  createBonklmMiddleware,
  withRetrieverGuardrails,
  bonklmLangGraphNode,
  createBonklmLangGraphNode,
  GuardrailsViolationError,
  ConnectorValidationError,
  ConnectorConfigurationError,
  ConnectorTimeoutError,
  DEFAULT_VALIDATION_INTERVAL,
  DEFAULT_MAX_BUFFER_SIZE,
  DEFAULT_VALIDATION_TIMEOUT,
  type BonklmMiddlewareConfig,
  type BonklmMiddlewareScope,
  type BonklmLangchainMiddleware,
  type BonklmMiddlewareState,
  type BonklmModelResponse,
  type BonklmToolCall,
  type BonklmRetrieverLike,
  type WithRetrieverGuardrailsOptions,
  type BonklmLangGraphState,
  type GuardrailsCallbackHandlerOptions,
  type StreamValidationContext
} from '@blackunicorn/bonklm-langchain';

declare const engine: GuardrailEngine;
declare const validators: Validator[];

// --- GuardrailsCallbackHandler (options optional) ---------------------------
const handler = new GuardrailsCallbackHandler();
expectType<GuardrailsCallbackHandler>(handler);
expectType<string>(handler.name);
expectType<boolean>(handler.awaitHandlers);
expectType<boolean>(handler.ignoreAgent);
expectType<boolean>(handler.ignoreChain);
expectType<boolean>(handler.ignoreCustomEvent);
expectType<boolean>(handler.ignoreLLM);
expectType<boolean>(handler.ignoreRetriever);
expectType<boolean>(handler.raiseError);
new GuardrailsCallbackHandler({ validators: [], validateStreaming: true });
expectError(new GuardrailsCallbackHandler({ validateStreaming: 'yes' }));

// --- type guards ------------------------------------------------------------
declare const maybeError: unknown;
expectType<boolean>(isGuardrailsViolationError(maybeError));
expectType<boolean>(isStreamValidationError(maybeError));
expectError(isGuardrailsViolationError());
expectError(isStreamValidationError());
if (isGuardrailsViolationError(maybeError)) {
  expectType<GuardrailsViolationError>(maybeError);
}

// --- createBonklmMiddleware (overloaded: engine-positional | config-bag) ----
expectType<BonklmLangchainMiddleware>(createBonklmMiddleware(engine));
expectType<BonklmLangchainMiddleware>(createBonklmMiddleware(engine, { scope: 'text_input', validators }));
expectType<BonklmLangchainMiddleware>(createBonklmMiddleware({ scope: 'text_input', validators }));
expectType<BonklmLangchainMiddleware>(
  createBonklmMiddleware({ scope: ['text_input', 'text_output'], validators, priority: 0 })
);
expectError(createBonklmMiddleware()); // engine | config required
expectError(createBonklmMiddleware({ validators })); // config form requires scope
expectError(createBonklmMiddleware({ scope: 'text_input' })); // config form requires validators
expectError(createBonklmMiddleware({ scope: 'memory_write', validators })); // scope not in middleware union

// --- BonklmMiddlewareScope union --------------------------------------------
expectAssignable<BonklmMiddlewareScope>('text_input');
expectAssignable<BonklmMiddlewareScope>('text_output');
expectAssignable<BonklmMiddlewareScope>('tool_call');
expectAssignable<BonklmMiddlewareScope>('retrieved_doc');
expectNotAssignable<BonklmMiddlewareScope>('memory_write'); // core surface, not a middleware scope
expectNotAssignable<BonklmMiddlewareScope>('');

// --- BonklmMiddlewareConfig (scope + validators required) -------------------
expectAssignable<BonklmMiddlewareConfig>({ scope: 'text_input', validators: [] });
expectAssignable<BonklmMiddlewareConfig>({
  scope: ['text_input', 'tool_call'],
  validators: [],
  engine,
  priority: 1,
  productionMode: true,
  validationTimeout: 1000
});
expectNotAssignable<BonklmMiddlewareConfig>({ validators: [] }); // scope required
expectNotAssignable<BonklmMiddlewareConfig>({ scope: 'text_input' }); // validators required

// --- BonklmLangchainMiddleware shape ----------------------------------------
declare const mw: BonklmLangchainMiddleware;
expectType<string>(mw.name);
expectType<number>(mw.priority);
expectType<BonklmMiddlewareScope[]>(mw.scope);

// --- withRetrieverGuardrails (generic — TRetriever preserved exactly) -------
interface MarkedRetriever extends BonklmRetrieverLike {
  marker: 'unique';
}
declare const markedRetriever: MarkedRetriever;
expectType<MarkedRetriever>(withRetrieverGuardrails(markedRetriever, { validators }));
expectError(withRetrieverGuardrails(markedRetriever, {})); // validators required
expectError(withRetrieverGuardrails(markedRetriever)); // options required

// --- LangGraph node entry points --------------------------------------------
declare const state: BonklmLangGraphState;
expectType<Promise<BonklmLangGraphState>>(bonklmLangGraphNode(state, engine));
expectType<Promise<BonklmLangGraphState>>(
  bonklmLangGraphNode(state, engine, { productionMode: true, validationTimeout: 1000 })
);
expectError(bonklmLangGraphNode(state)); // engine required
expectType<(state: BonklmLangGraphState) => Promise<BonklmLangGraphState>>(createBonklmLangGraphNode(engine));
expectType<(state: BonklmLangGraphState) => Promise<BonklmLangGraphState>>(
  createBonklmLangGraphNode(engine, { productionMode: true })
);
expectError(createBonklmLangGraphNode()); // engine required
expectError(createBonklmLangGraphNode(engine, { validationTimeout: 1000 })); // factory opts accept productionMode only

// --- GuardrailsViolationError (message + reason required) -------------------
const gve = new GuardrailsViolationError('msg', 'reason');
expectAssignable<Error>(gve);
expectType<string>(gve.name); // inherited Error.name — not a literal
expectType<string>(gve.reason);
expectType<number>(gve.riskScore);
expectType<GuardrailResult['findings']>(gve.findings);
expectType<GuardrailsViolationError>(new GuardrailsViolationError('m', 'r', [], 5));
expectError(new GuardrailsViolationError('msg')); // reason required
expectError(new GuardrailsViolationError()); // message + reason required

// --- re-exported core connector error classes -------------------------------
const cve = new ConnectorValidationError('msg');
expectType<ConnectorValidationError>(cve);
expectType<string>(cve.category);
expectType<number | undefined>(cve.statusCode);
new ConnectorValidationError('m', 'configuration_error', 400);
expectError(new ConnectorValidationError()); // message required

const cce = new ConnectorConfigurationError('msg');
expectType<ConnectorConfigurationError>(cce);
expectType<string | undefined>(cce.field);
expectError(new ConnectorConfigurationError()); // message required

const cte = new ConnectorTimeoutError('msg', 5000);
expectType<ConnectorTimeoutError>(cte);
expectType<number>(cte.timeout);
expectError(new ConnectorTimeoutError('m')); // timeout required
expectError(new ConnectorTimeoutError()); // message + timeout required

// --- BonklmMiddlewareState / BonklmModelResponse / BonklmToolCall -----------
expectAssignable<BonklmMiddlewareState>({});
expectAssignable<BonklmMiddlewareState>({ messages: [], prompt: 'x', anything: 1 });
expectNotAssignable<BonklmMiddlewareState>({ prompt: 123 }); // prompt is string
expectNotAssignable<BonklmMiddlewareState>({ messages: 'x' }); // messages is unknown[]

expectAssignable<BonklmModelResponse>({});
expectAssignable<BonklmModelResponse>({ content: {}, text: 'x', extra: true });
expectNotAssignable<BonklmModelResponse>({ text: 123 }); // text is string

expectAssignable<BonklmToolCall>({ name: 'fn' });
expectAssignable<BonklmToolCall>({ name: 'fn', args: {}, id: 'a', extra: 1 });
expectNotAssignable<BonklmToolCall>({}); // name required
expectNotAssignable<BonklmToolCall>({ name: 123 }); // name is string

// --- BonklmRetrieverLike / WithRetrieverGuardrailsOptions -------------------
expectAssignable<BonklmRetrieverLike>({ invoke: async () => 'x' });
expectNotAssignable<BonklmRetrieverLike>({}); // invoke required
expectAssignable<WithRetrieverGuardrailsOptions>({ validators: [] });
expectAssignable<WithRetrieverGuardrailsOptions>({ validators: [], productionMode: true, validationTimeout: 5000 });
expectNotAssignable<WithRetrieverGuardrailsOptions>({}); // validators required

// --- BonklmLangGraphState ---------------------------------------------------
expectAssignable<BonklmLangGraphState>({});
expectAssignable<BonklmLangGraphState>({ messages: [], extra: 'x' });
expectNotAssignable<BonklmLangGraphState>({ messages: 'x' }); // messages is unknown[]

// --- GuardrailsCallbackHandlerOptions (every field optional) ----------------
expectAssignable<GuardrailsCallbackHandlerOptions>({});
expectAssignable<GuardrailsCallbackHandlerOptions>({
  validators: [],
  guards: [],
  validateStreaming: true,
  streamingMode: 'incremental',
  maxStreamBufferSize: 2048,
  productionMode: false,
  validationTimeout: 1000,
  streamingValidationInterval: 5,
  onBlocked: () => {},
  onStreamBlocked: () => {},
  onValidationError: () => {},
  enableRetry: true,
  maxRetries: 2
});
expectNotAssignable<GuardrailsCallbackHandlerOptions>({ validateStreaming: 'yes' });
expectNotAssignable<GuardrailsCallbackHandlerOptions>({ streamingMode: 'nope' });

// --- StreamValidationContext (all fields required) --------------------------
expectAssignable<StreamValidationContext>({
  accumulatedText: '',
  tokenCount: 0,
  validationCounter: 0,
  startTime: 0
});
expectNotAssignable<StreamValidationContext>({ accumulatedText: '' }); // missing required fields
expectNotAssignable<StreamValidationContext>({
  accumulatedText: 0,
  tokenCount: 0,
  validationCounter: 0,
  startTime: 0
}); // accumulatedText is string

// --- constants: literal for `= 10` / `= 30000`, widened for `1024 * 1024` ---
expectType<10>(DEFAULT_VALIDATION_INTERVAL);
expectType<number>(DEFAULT_MAX_BUFFER_SIZE);
expectType<30000>(DEFAULT_VALIDATION_TIMEOUT);
