/**
 * Story 1.5 — LangChain.js 1.0 Middleware Migration
 * =================================================
 *
 * Provides `createBonklmMiddleware({ scope, validators, priority })`
 * for the `langchain@1.x` agent-middleware surface. The middleware
 * exposes four hooks the LangChain runtime invokes around each model
 * call:
 *
 *   - `beforeModel(state)`  — validate the prompt / messages BEFORE
 *                              the model is invoked. Throws on block.
 *   - `wrapModelCall(state, next)` — surrounds the model invocation
 *                              with timing / cancellation hooks.
 *   - `afterModel(state, response)` — validate the model response
 *                              BEFORE it's persisted / forwarded.
 *   - `wrapToolCall(toolCall, next)` — validates each tool call's
 *                              args via the `ToolCallArgsValidator`-
 *                              compatible chain. Fires per-call so
 *                              parallel tool calls each pass through
 *                              individual validation (not batched).
 *
 * Coexistence with `openAIModerationMiddleware`: BonkLM should be
 * REGISTERED FIRST so its decisions short-circuit before OpenAI's
 * moderation endpoint sees the payload (saves a network call on
 * blocked inputs). Document `priority` field accordingly.
 *
 * Phase-1 scope (this commit): factory + four hooks return objects
 * matching the langchain@1.x middleware contract via duck-typed
 * shapes. Real integration tests against `langchain@1.4.x` and
 * `@langchain/core@0.3.x` ship as Phase-2+ per Story 1.5 AC.
 *
 * @package @blackunicorn/bonklm-langchain
 */

import {
  createLogger,
  type GuardrailEngine,
  type Logger,
  type Validator,
  validateWithTimeoutSecure,
} from '@blackunicorn/bonklm';
import {
  ConnectorValidationError,
  logValidationFailure,
} from '@blackunicorn/bonklm/core/connector-utils';

/**
 * Surface scope a middleware instance covers. Mirrors the surface
 * vocabulary from `HookSurface` in core; constrained to the surfaces
 * the LangChain runtime exposes.
 */
export type BonklmMiddlewareScope = 'text_input' | 'text_output' | 'tool_call' | 'retrieved_doc';

/**
 * Configuration for {@link createBonklmMiddleware}.
 */
export interface BonklmMiddlewareConfig {
  /**
   * Which surfaces this middleware instance covers. Pass an array to
   * have one middleware handle multiple surfaces; pass a single value
   * for a focused tap.
   *
   * @example ['text_input', 'text_output']
   */
  scope: BonklmMiddlewareScope | BonklmMiddlewareScope[];
  /**
   * Validators to run against the relevant surface content. Receives
   * the same `Validator[]` shape any other BonkLM consumer would use.
   */
  validators: Validator[];
  /**
   * Optional shared `GuardrailEngine`. When supplied, the middleware
   * delegates `engine.validate(content)` instead of building its own
   * inline chain — useful when the caller wants engine-level
   * concerns (intercept callbacks, override tokens, circuit breaker)
   * applied uniformly across multiple middlewares.
   */
  engine?: GuardrailEngine;
  /**
   * LangChain middleware priority. Lower runs earlier. BonkLM should
   * default to `0` (or a small number) so it runs BEFORE third-party
   * middlewares like `openAIModerationMiddleware` and short-circuits
   * the chain on block — saving the downstream network call.
   * @default 0
   */
  priority?: number;
  /** Logger. @default `createLogger('console')` */
  logger?: Logger;
  /** Production-mode generic error messages. @default false */
  productionMode?: boolean;
  /** Per-validation timeout (ms). @default 30_000 */
  validationTimeout?: number;
}

const DEFAULT_VALIDATION_TIMEOUT = 30_000;

/**
 * Minimal duck-typed shapes mirroring the v1 langchain middleware
 * surface so this connector does not pull `langchain` types into
 * compile time. Real consumers wire via `langchain`'s own factory.
 */
export interface BonklmMiddlewareState {
  messages?: unknown[];
  prompt?: string;
  [k: string]: unknown;
}

export interface BonklmModelResponse {
  content?: unknown;
  text?: string;
  [k: string]: unknown;
}

export interface BonklmToolCall {
  name: string;
  args?: unknown;
  id?: string;
  [k: string]: unknown;
}

/**
 * Concrete return shape of {@link createBonklmMiddleware}. Mirrors
 * `langchain@1.x`'s middleware contract via optional hooks; the
 * runtime invokes whichever hooks are defined.
 */
export interface BonklmLangchainMiddleware {
  readonly name: string;
  readonly priority: number;
  readonly scope: BonklmMiddlewareScope[];
  beforeModel?: (state: BonklmMiddlewareState) => Promise<BonklmMiddlewareState | void>;
  wrapModelCall?: <T>(
    state: BonklmMiddlewareState,
    next: (s: BonklmMiddlewareState) => Promise<T>
  ) => Promise<T>;
  afterModel?: (
    state: BonklmMiddlewareState,
    response: BonklmModelResponse
  ) => Promise<BonklmModelResponse | void>;
  wrapToolCall?: <T>(
    toolCall: BonklmToolCall,
    next: (tc: BonklmToolCall) => Promise<T>
  ) => Promise<T>;
}

function extractText(state: BonklmMiddlewareState): string {
  if (typeof state.prompt === 'string' && state.prompt.length > 0) return state.prompt;
  if (!Array.isArray(state.messages)) return '';
  const parts: string[] = [];
  for (const m of state.messages) {
    if (!m || typeof m !== 'object') continue;
    const content = (m as { content?: unknown }).content;
    if (typeof content === 'string' && content.length > 0) {
      parts.push(content);
    } else if (Array.isArray(content)) {
      for (const c of content) {
        if (c && typeof c === 'object') {
          const part = c as { type?: string; text?: string };
          if (part.type === 'text' && typeof part.text === 'string' && part.text.length > 0) {
            parts.push(part.text);
          }
        }
      }
    }
  }
  return parts.join('\n');
}

function extractResponseText(r: BonklmModelResponse | undefined): string {
  if (!r) return '';
  if (typeof r.text === 'string' && r.text.length > 0) return r.text;
  if (typeof r.content === 'string' && r.content.length > 0) return r.content;
  if (Array.isArray(r.content)) {
    return r.content
      .map((c) =>
        c && typeof c === 'object' && 'text' in c && typeof (c as { text: unknown }).text === 'string'
          ? (c as { text: string }).text
          : ''
      )
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

/**
 * Build a `langchain@1.x`-compatible middleware that pipes the
 * configured surfaces through the supplied validator stack.
 *
 * @example
 * ```ts
 * import { createBonklmMiddleware } from '@blackunicorn/bonklm-langchain';
 * import { PromptInjectionValidator, SecretGuard } from '@blackunicorn/bonklm';
 *
 * const middleware = createBonklmMiddleware({
 *   scope: ['text_input', 'text_output'],
 *   validators: [new PromptInjectionValidator(), new SecretGuard()],
 *   priority: 0, // run BEFORE openAIModerationMiddleware
 * });
 *
 * // Wire into a langchain v1 agent / runnable per the SDK docs.
 * ```
 */
/**
 * Audit-loop BLOCK fix #2: align the LangChain middleware factory API
 * with `bonkMiddleware(engine, options)` in the Vercel connector. Both
 * signatures are supported:
 *
 *  - `createBonklmMiddleware(engine, options?)` — positional-engine form
 *    matching `bonkMiddleware` so callers using both connectors hit a
 *    coherent call shape.
 *  - `createBonklmMiddleware(config)` — original options-bag form.
 *    Retained for backward compatibility with the engine-less ad-hoc
 *    validator-chain path that the positional form does not expose.
 */
export function createBonklmMiddleware(
  engine: GuardrailEngine,
  options?: Omit<BonklmMiddlewareConfig, 'engine'>
): BonklmLangchainMiddleware;
export function createBonklmMiddleware(
  config: BonklmMiddlewareConfig
): BonklmLangchainMiddleware;
export function createBonklmMiddleware(
  engineOrConfig: GuardrailEngine | BonklmMiddlewareConfig,
  options?: Omit<BonklmMiddlewareConfig, 'engine'>
): BonklmLangchainMiddleware {
  // Resolve the call shape. The `BonklmMiddlewareConfig` form has a
  // `scope` field; the engine form has a `.validate` method. In the
  // engine form, `validators` defaults to `[]` because the engine
  // handles validation downstream.
  const config: BonklmMiddlewareConfig =
    typeof (engineOrConfig as GuardrailEngine).validate === 'function'
      ? {
          scope: 'text_input',
          validators: [],
          ...(options ?? {}),
          engine: engineOrConfig as GuardrailEngine,
        }
      : (engineOrConfig as BonklmMiddlewareConfig);

  const scopes = Array.isArray(config.scope) ? config.scope : [config.scope];
  const logger = config.logger ?? createLogger('console');
  const productionMode = config.productionMode ?? false;
  const timeout = config.validationTimeout ?? DEFAULT_VALIDATION_TIMEOUT;
  const priority = config.priority ?? 0;

  // Validation surface: either delegate to engine.validate (when an
  // engine is supplied) or build an ad-hoc chain. Both shapes return
  // `{ allowed, reason? }` for the middleware hooks to gate on.
  const validateContent = async (content: string, ctx: string): Promise<{
    allowed: boolean;
    reason?: string;
  }> => {
    return validateWithTimeoutSecure<{ allowed: boolean; reason?: string }>({
      operation: async () => {
        if (config.engine) {
          const r = await config.engine.validate(content, ctx);
          return { allowed: r.allowed, reason: r.reason };
        }
        // Ad-hoc chain: short-circuit on first BLOCK.
        for (const v of config.validators) {
          const r = await v.validate(content);
          if (!r.allowed) {
            return { allowed: false, reason: r.reason };
          }
        }
        return { allowed: true };
      },
      timeoutMs: timeout,
      timeoutSentinel: () => ({ allowed: false, reason: 'Validation timeout' }),
      logger,
    });
  };

  const scopeSet = new Set(scopes);
  const covers = (s: BonklmMiddlewareScope): boolean => scopeSet.has(s);

  const middleware: BonklmLangchainMiddleware = {
    name: 'bonklm-langchain-middleware',
    priority,
    scope: scopes,
  };

  if (covers('text_input')) {
    middleware.beforeModel = async (state) => {
      const inputText = extractText(state);
      if (inputText.length === 0) return undefined;
      const r = await validateContent(inputText, 'bonklm_langchain_input');
      if (!r.allowed) {
        logValidationFailure(logger, r.reason ?? 'Input blocked', { context: 'bonklm_langchain_input' });
        throw new ConnectorValidationError(
          productionMode ? 'Input blocked' : `Input blocked: ${r.reason}`,
          'validation_failed'
        );
      }
      return undefined;
    };
  }

  if (covers('text_output')) {
    middleware.afterModel = async (_state, response) => {
      const outText = extractResponseText(response);
      if (outText.length === 0) return undefined;
      const r = await validateContent(outText, 'bonklm_langchain_output');
      if (!r.allowed) {
        logValidationFailure(logger, r.reason ?? 'Output blocked', { context: 'bonklm_langchain_output' });
        throw new ConnectorValidationError(
          productionMode ? 'Output blocked' : `Output blocked: ${r.reason}`,
          'validation_failed'
        );
      }
      return undefined;
    };
  }

  if (covers('tool_call')) {
    middleware.wrapToolCall = async (toolCall, next) => {
      // Per-call validation — parallel tool calls each pass through
      // their own validation pass, not a batched one. Validates the
      // tool name + the JSON-serialised args (matching the
      // ToolCallArgsValidator default-serializer contract from
      // Story 1.1).
      const blob = `${toolCall.name} ${JSON.stringify(toolCall.args ?? {})}`;
      const r = await validateContent(blob, 'bonklm_langchain_tool_call');
      if (!r.allowed) {
        logValidationFailure(logger, r.reason ?? 'Tool call blocked', { name: toolCall.name });
        throw new ConnectorValidationError(
          productionMode ? 'Tool call blocked' : `Tool call blocked: ${r.reason}`,
          'validation_failed'
        );
      }
      return next(toolCall);
    };
  }

  // `retrieved_doc` scope is covered by `withRetrieverGuardrails`
  // (separate wrapper) rather than a hook here — the langchain
  // retriever surface is invoked outside the middleware lifecycle.

  return middleware;
}

// ─────────────────────────────────────────────────────────────────────
// External wrappers (no-middleware-hook surfaces)
// ─────────────────────────────────────────────────────────────────────

/**
 * Duck-typed shape of a langchain retriever (the v1 `BaseRetriever`
 * surface). We avoid a hard import to keep peer-dep flexibility.
 */
export interface BonklmRetrieverLike {
  invoke: (input: string, ...rest: unknown[]) => Promise<unknown>;
  [k: string]: unknown;
}

export interface WithRetrieverGuardrailsOptions {
  validators: Validator[];
  logger?: Logger;
  productionMode?: boolean;
}

/**
 * Wrap a langchain retriever (`BaseRetriever`-shaped) so the returned
 * documents pass through a `RetrievedDocValidator`-compatible chain
 * before reaching the consumer. Uses the same `Validator[]` surface
 * as `createBonklmMiddleware` for consistency.
 *
 * The middleware-based pattern doesn't cover the retriever surface
 * because langchain's retriever invocation lives outside the
 * agent/runnable middleware lifecycle. This wrapper closes that gap.
 *
 * @example
 * ```ts
 * import { withRetrieverGuardrails } from '@blackunicorn/bonklm-langchain';
 *
 * const guardedRetriever = withRetrieverGuardrails(myRetriever, {
 *   validators: [new PromptInjectionValidator()],
 * });
 * const docs = await guardedRetriever.invoke('search query');
 * ```
 */
export function withRetrieverGuardrails<TRetriever extends BonklmRetrieverLike>(
  retriever: TRetriever,
  options: WithRetrieverGuardrailsOptions
): TRetriever {
  const logger = options.logger ?? createLogger('console');
  const productionMode = options.productionMode ?? false;
  const validators = options.validators;

  const validateDoc = async (content: string): Promise<{ allowed: boolean; reason?: string }> => {
    for (const v of validators) {
      const r = await v.validate(content);
      if (!r.allowed) return { allowed: false, reason: r.reason };
    }
    return { allowed: true };
  };

  const original = retriever;
  return {
    ...original,
    invoke: async (input: string, ...rest: unknown[]) => {
      const docs = await original.invoke(input, ...rest);
      if (!Array.isArray(docs)) return docs;
      const valid: unknown[] = [];
      for (const d of docs) {
        const content =
          d && typeof d === 'object' && 'pageContent' in d && typeof (d as { pageContent: unknown }).pageContent === 'string'
            ? (d as { pageContent: string }).pageContent
            : typeof d === 'string'
              ? d
              : '';
        if (content.length === 0) {
          valid.push(d);
          continue;
        }
        const r = await validateDoc(content);
        if (r.allowed) {
          valid.push(d);
        } else {
          logger.warn?.('[bonklm-langchain] retriever doc dropped', { reason: r.reason });
        }
      }
      // Documented behaviour: silently drop blocked docs (matches the
      // RetrievedDocValidator 'drop' mode default from Story 1.2).
      void productionMode; // reserved for future error-mode toggle
      return valid;
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// LangGraph integration (low-level)
// ─────────────────────────────────────────────────────────────────────

/**
 * Duck-typed minimum of a LangGraph state object.
 */
export interface BonklmLangGraphState {
  messages?: unknown[];
  [k: string]: unknown;
}

/**
 * Low-level LangGraph node that validates the current state's
 * messages through the supplied engine. Returns the unchanged state
 * on pass; throws `ConnectorValidationError` on block.
 *
 * Wire as a node in a LangGraph chain when middleware hooks aren't
 * available (e.g. a raw `StateGraph` not running under
 * `createReactAgent` / `createAgent`).
 *
 * **Two call shapes** (audit-loop BLOCK fix #10):
 *  - Raw 3-arg: `bonklmLangGraphNode(state, engine, options?)` — call
 *    from inside a lambda when wiring into a graph.
 *  - Factory: `createBonklmLangGraphNode(engine, options?)` returns a
 *    LangGraph-compatible 1-arg handler `(state) => Promise<state>`
 *    that can be passed DIRECTLY to `graph.addNode(...)` without an
 *    intermediate lambda.
 *
 * @example
 * ```ts
 * // Factory form (matches LangGraph node-handler contract):
 * import { createBonklmLangGraphNode } from '@blackunicorn/bonklm-langchain';
 * graph.addNode('bonklm', createBonklmLangGraphNode(engine));
 * graph.addEdge('start', 'bonklm');
 *
 * // Raw form (inside a lambda):
 * import { bonklmLangGraphNode } from '@blackunicorn/bonklm-langchain';
 * graph.addNode('bonklm', (state) => bonklmLangGraphNode(state, engine));
 * ```
 */
export async function bonklmLangGraphNode(
  state: BonklmLangGraphState,
  engine: GuardrailEngine,
  options: { productionMode?: boolean } = {}
): Promise<BonklmLangGraphState> {
  const inputText = extractText(state as BonklmMiddlewareState);
  if (inputText.length === 0) return state;
  const r = await engine.validate(inputText, 'bonklm_langgraph_node');
  if (!r.allowed) {
    throw new ConnectorValidationError(
      options.productionMode ? 'State blocked' : `State blocked: ${r.reason}`,
      'validation_failed'
    );
  }
  return state;
}

/**
 * Factory that returns a LangGraph-compatible 1-arg node handler
 * pre-bound to the supplied engine + options. Matches the
 * `StateGraph.addNode` contract `(state, config?) => state |
 * Promise<state>` so the returned function can be passed DIRECTLY to
 * `graph.addNode(...)`.
 *
 * Audit-loop BLOCK fix #10: previously the only entry point was the
 * 3-arg `bonklmLangGraphNode(state, engine, options)`. Passing that
 * function reference directly to `graph.addNode('bonklm',
 * bonklmLangGraphNode)` would crash at run-time because LangGraph
 * invokes the node with `(state, config)` — `engine` would receive
 * the RunnableConfig object instead of a real engine.
 */
export function createBonklmLangGraphNode(
  engine: GuardrailEngine,
  options: { productionMode?: boolean } = {}
): (state: BonklmLangGraphState) => Promise<BonklmLangGraphState> {
  return (state: BonklmLangGraphState): Promise<BonklmLangGraphState> =>
    bonklmLangGraphNode(state, engine, options);
}
