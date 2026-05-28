/**
 * tsd type-surface suite — @blackunicorn/bonklm-vercel (ST-04-209).
 *
 * Locks the published public type surface (imports by package name):
 * the `createGuardedAI` factory + `messagesToText`, the v5/v6
 * `bonkMiddleware` + `messagesToTextDucked`, the `wrapAgent` /
 * `wrapMCPClient` wrappers, the two re-exported error classes
 * (`StreamValidationError` + `ConnectorValidationError`), the option /
 * result / middleware / agent types, and the three numeric constants
 * (literal-vs-widened asserted exactly). SDK-typed fields (`model` /
 * `messages`) are exercised via `Parameters<...>` / declared values so
 * the suite does not construct `ai` SDK objects. Run via `pnpm exec
 * tsd`. Lives in test-d/ (tsd's default dir).
 */
import { expectType, expectError, expectAssignable, expectNotAssignable } from 'tsd';
import type { GuardrailEngine } from '@blackunicorn/bonklm';
import {
  createGuardedAI,
  messagesToText,
  bonkMiddleware,
  messagesToTextDucked,
  wrapAgent,
  wrapMCPClient,
  StreamValidationError,
  ConnectorValidationError,
  VALIDATION_INTERVAL,
  DEFAULT_MAX_BUFFER_SIZE,
  DEFAULT_VALIDATION_TIMEOUT,
  type GuardedAIOptions,
  type GuardedGenerateTextOptions,
  type GuardedStreamOptions,
  type GuardedTextResult,
  type BonkLanguageModelV2Middleware,
  type BonkMiddlewareOptions,
  type ToolLoopAgentLike,
  type MCPClientLike,
  type WrapAgentOptions,
  type WrapMCPClientOptions
} from '@blackunicorn/bonklm-vercel';

declare const engine: GuardrailEngine;

// --- createGuardedAI: options-only factory ----------------------------------
createGuardedAI();
createGuardedAI({ validators: [], guards: [], validateStreaming: true, streamingMode: 'buffer' });
expectError(createGuardedAI({ streamingMode: 'x' })); // 'incremental' | 'buffer'

// --- messagesToText / messagesToTextDucked ----------------------------------
declare const msgs: Parameters<typeof messagesToText>[0];
expectType<string>(messagesToText(msgs));
expectType<string>(messagesToTextDucked(undefined));
expectType<string>(messagesToTextDucked([{ content: 'x' }, 'raw']));

// --- bonkMiddleware: engine required → v2 middleware ------------------------
expectType<BonkLanguageModelV2Middleware>(bonkMiddleware(engine));
bonkMiddleware(engine, { productionMode: true, onInputBlocked: () => {} });
expectError(bonkMiddleware()); // engine required
expectError(bonkMiddleware(engine, { productionMode: 'no' })); // bad option type

// --- wrapAgent / wrapMCPClient: subject + engine, type preserved ------------
declare const agent: ToolLoopAgentLike;
declare const mcp: MCPClientLike;
expectType<ToolLoopAgentLike>(wrapAgent(agent, engine));
expectType<MCPClientLike>(wrapMCPClient(mcp, engine));
expectError(wrapAgent(agent)); // engine required
expectError(wrapMCPClient(mcp)); // engine required

// --- constants: literal for `= 10` / `= 30000`, widened for `a * b` ---------
expectType<10>(VALIDATION_INTERVAL);
expectType<number>(DEFAULT_MAX_BUFFER_SIZE); // `1024 * 1024` widens to number
expectType<30000>(DEFAULT_VALIDATION_TIMEOUT);

// --- GuardedAIOptions (every field optional) --------------------------------
expectAssignable<GuardedAIOptions>({});
expectAssignable<GuardedAIOptions>({
  validators: [],
  guards: [],
  validateStreaming: true,
  streamingMode: 'incremental',
  maxStreamBufferSize: 1024,
  productionMode: false,
  validationTimeout: 1000,
  onBlocked: () => {},
  onStreamBlocked: () => {}
});
expectNotAssignable<GuardedAIOptions>({ streamingMode: 'x' });

// --- GuardedGenerateTextOptions / GuardedStreamOptions (SDK-typed fields) ----
declare const genOpts: GuardedGenerateTextOptions;
declare const streamOpts: GuardedStreamOptions;
expectType<GuardedGenerateTextOptions['messages']>(genOpts.messages);
expectType<GuardedGenerateTextOptions['model']>(genOpts.model);
expectType<true>(streamOpts.stream); // GuardedStreamOptions narrows stream to the literal true
expectNotAssignable<GuardedGenerateTextOptions>({}); // model + messages required

// --- GuardedTextResult (text required) --------------------------------------
expectAssignable<GuardedTextResult>({ text: 'out' });
expectAssignable<GuardedTextResult>({
  text: 'out',
  usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
  finishReason: 'stop',
  filtered: false,
  raw: {}
});
expectNotAssignable<GuardedTextResult>({}); // text required
expectNotAssignable<GuardedTextResult>({ text: 123 });

// --- BonkLanguageModelV2Middleware (middlewareVersion literal required) -----
expectAssignable<BonkLanguageModelV2Middleware>({ middlewareVersion: 'v2' });
expectNotAssignable<BonkLanguageModelV2Middleware>({}); // middlewareVersion required
expectNotAssignable<BonkLanguageModelV2Middleware>({ middlewareVersion: 'v1' }); // literal 'v2'

// --- BonkMiddlewareOptions (every field optional) ---------------------------
expectAssignable<BonkMiddlewareOptions>({});
expectAssignable<BonkMiddlewareOptions>({
  productionMode: true,
  validationTimeout: 1000,
  onInputBlocked: () => {},
  onStreamBlocked: () => {}
});
expectNotAssignable<BonkMiddlewareOptions>({ productionMode: 'no' });

// --- ToolLoopAgentLike / MCPClientLike (methods optional → {} assignable) ---
expectAssignable<ToolLoopAgentLike>({});
expectAssignable<MCPClientLike>({});

// --- WrapAgentOptions / WrapMCPClientOptions --------------------------------
declare const agentLogger: WrapAgentOptions['logger'];
declare const mcpLogger: WrapMCPClientOptions['logger'];
expectAssignable<WrapAgentOptions>({});
expectAssignable<WrapAgentOptions>({ logger: agentLogger, productionMode: true });
expectNotAssignable<WrapAgentOptions>({ productionMode: 'no' });
expectAssignable<WrapMCPClientOptions>({});
expectAssignable<WrapMCPClientOptions>({ logger: mcpLogger, productionMode: true, retrievedDocValidators: [] });
expectNotAssignable<WrapMCPClientOptions>({ productionMode: 'no' });

// --- StreamValidationError / ConnectorValidationError (re-export classes) ---
const sve = new StreamValidationError('stream blocked');
expectType<StreamValidationError>(sve);
expectType<string>(sve.reason);
expectType<boolean>(sve.blocked);
const cve = new ConnectorValidationError('blocked');
expectType<ConnectorValidationError>(cve);
expectType<string>(cve.category);
expectType<number | undefined>(cve.statusCode);
new ConnectorValidationError('blocked', 'validation_failed', 400);
expectError(new ConnectorValidationError()); // message required
