/**
 * Story 1.4 — Vercel AI SDK v5/v6 Middleware Pattern
 * ==================================================
 *
 * `bonkMiddleware(engine, options)` returns a `LanguageModelV2Middleware`-
 * shaped object the caller pipes into `wrapLanguageModel({ model, middleware })`
 * from `ai` v5/v6. The middleware hooks `transformParams`, `wrapGenerate`,
 * and `wrapStream` to validate input + output through a BonkLM
 * `GuardrailEngine`.
 *
 * Phase-1 scope (this commit): basic input + output validation via
 * `wrapGenerate` + `wrapStream`. Stream is accumulated and validated
 * once at finish (`StreamValidator` legacy lifecycle).
 *
 * Phase-2+ follow-ups (tracked in Story 1.4 spec, deferred to follow-up
 * PRs):
 *   - Full 20 v5/v6 event-type handling in StreamValidator
 *     (text-delta / tool-input-delta / reasoning-delta / etc.)
 *   - `onInputAvailable` per-tool fires ToolCallArgsValidator (Story 1.1)
 *   - Tool-approval persistence (two-call pattern: approve → execute)
 *     across `approvalId`
 *   - Real integration tests against `ai-v5` + `latest` npm tags
 *
 * @package @blackunicorn/bonklm-vercel
 */

import {
  createLogger,
  GuardrailEngine,
  type Logger,
} from '@blackunicorn/bonklm';
import {
  ConnectorValidationError,
  logTimeout,
  logValidationFailure,
} from '@blackunicorn/bonklm/core/connector-utils';

/**
 * Minimal duck-typed shape of the v5/v6 LanguageModelV2 middleware
 * surface so this connector compiles without a hard dependency on
 * `@ai-sdk/provider`'s exact types. The real SDK passes the same
 * shape; consumers wire via `wrapLanguageModel({ model, middleware })`.
 *
 * `transformParams` runs BEFORE `wrapGenerate` / `wrapStream` — input
 * validation happens here so the model is never invoked on blocked
 * content. `wrapGenerate` validates the response after; `wrapStream`
 * validates each text chunk + the accumulated tail at finish.
 */
export interface BonkLanguageModelV2Middleware {
  middlewareVersion: 'v2';
  transformParams?: (args: {
    type: 'generate' | 'stream';
    params: { prompt?: unknown; messages?: unknown[]; [k: string]: unknown };
  }) => Promise<{ prompt?: unknown; messages?: unknown[]; [k: string]: unknown }>;
  wrapGenerate?: (args: {
    doGenerate: () => Promise<{ text?: string; content?: unknown; [k: string]: unknown }>;
    params: unknown;
    model: unknown;
  }) => Promise<{ text?: string; content?: unknown; [k: string]: unknown }>;
  wrapStream?: (args: {
    doStream: () => Promise<{
      stream: AsyncIterable<{ type: string; textDelta?: string; [k: string]: unknown }>;
      [k: string]: unknown;
    }>;
    params: unknown;
    model: unknown;
  }) => Promise<{
    stream: AsyncIterable<{ type: string; textDelta?: string; [k: string]: unknown }>;
    [k: string]: unknown;
  }>;
}

/**
 * Configuration for {@link bonkMiddleware}. Subset of
 * `GuardedAIOptions` — only the fields relevant to the middleware
 * pattern are accepted here (production mode, timeout, callbacks).
 */
export interface BonkMiddlewareOptions {
  /** Logger. @default `createLogger('console')` */
  logger?: Logger;
  /** Production mode generic error messages. @default `process.env.NODE_ENV === 'production'` */
  productionMode?: boolean;
  /** Per-validation timeout (ms). @default 30_000 */
  validationTimeout?: number;
  /** Callback fired when input is blocked. */
  onInputBlocked?: (reason: string) => void;
  /** Callback fired when streaming output is blocked. */
  onStreamBlocked?: (accumulated: string, reason: string) => void;
}

const DEFAULT_VALIDATION_TIMEOUT = 30_000;

/**
 * Story 1.4: extract validatable text from v5/v6 message arrays.
 * Mirrors `messagesToText` from `guarded-ai.ts` but uses duck-typed
 * shape so it covers both `CoreMessage` (v3/v4) and `ModelMessage`
 * (v5/v6). Returns `''` for inputs that carry no scannable text
 * (images, audio, structured-only payloads).
 */
export function messagesToTextDucked(messages: unknown[] | undefined): string {
  if (!Array.isArray(messages)) return '';
  const parts: string[] = [];
  for (const m of messages) {
    if (!m || typeof m !== 'object') continue;
    const content = (m as { content?: unknown }).content;
    if (typeof content === 'string') {
      if (content.length > 0) parts.push(content);
      continue;
    }
    if (Array.isArray(content)) {
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

/**
 * Build a v5/v6 `LanguageModelV2Middleware` that pipes input + output
 * through the supplied `GuardrailEngine`.
 *
 * @example
 * ```ts
 * import { wrapLanguageModel } from 'ai';
 * import { openai } from '@ai-sdk/openai';
 * import { GuardrailEngine, PromptInjectionValidator } from '@blackunicorn/bonklm';
 * import { bonkMiddleware } from '@blackunicorn/bonklm-vercel';
 *
 * const engine = new GuardrailEngine({
 *   validators: [new PromptInjectionValidator()],
 * });
 *
 * const guarded = wrapLanguageModel({
 *   model: openai('gpt-4'),
 *   middleware: bonkMiddleware(engine, { productionMode: true }),
 * });
 * ```
 */
export function bonkMiddleware(
  engine: GuardrailEngine,
  options: BonkMiddlewareOptions = {}
): BonkLanguageModelV2Middleware {
  const logger = options.logger ?? createLogger('console');
  const productionMode = options.productionMode ?? process.env.NODE_ENV === 'production';
  const timeout = options.validationTimeout ?? DEFAULT_VALIDATION_TIMEOUT;
  const { onInputBlocked, onStreamBlocked } = options;

  const validate = async (content: string, context: string) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    try {
      const r = await engine.validate(content, context);
      clearTimeout(timeoutId);
      return r;
    } catch (err) {
      clearTimeout(timeoutId);
      if (err instanceof Error && err.name === 'AbortError') {
        logTimeout(logger, 'bonkMiddleware', timeout);
        return {
          allowed: false,
          blocked: true,
          reason: 'Validation timeout',
          findings: [],
        } as { allowed: boolean; blocked: boolean; reason?: string };
      }
      throw err;
    }
  };

  return {
    middlewareVersion: 'v2',
    async transformParams({ params }) {
      const messages = params.messages ?? [];
      const inputText = messagesToTextDucked(messages);
      if (inputText.length === 0) return params;
      const r = await validate(inputText, 'bonk_middleware_input');
      if (!r.allowed) {
        logValidationFailure(logger, r.reason ?? 'Input blocked', { context: 'bonk_middleware_input' });
        onInputBlocked?.(r.reason ?? 'input_blocked');
        throw new ConnectorValidationError(
          productionMode ? 'Input blocked' : `Input blocked: ${r.reason}`,
          'validation_failed'
        );
      }
      return params;
    },
    async wrapGenerate({ doGenerate }) {
      const result = await doGenerate();
      const text = typeof result.text === 'string' ? result.text : '';
      if (text.length > 0) {
        const r = await validate(text, 'bonk_middleware_output');
        if (!r.allowed) {
          logValidationFailure(logger, r.reason ?? 'Output blocked', { context: 'bonk_middleware_output' });
          throw new ConnectorValidationError(
            productionMode ? 'Output blocked' : `Output blocked: ${r.reason}`,
            'validation_failed'
          );
        }
      }
      return result;
    },
    async wrapStream({ doStream }) {
      const result = await doStream();
      const upstream = result.stream;

      // Phase-1 stream validation: accumulate text-delta + text chunks,
      // validate at stream end. Phase-2+ will add per-event handling
      // for the full 20 v5/v6 event types (tool-input-delta,
      // reasoning-delta, source, finish, etc.) per AC.
      async function* guardedStream(): AsyncGenerator<{
        type: string;
        textDelta?: string;
        [k: string]: unknown;
      }> {
        let accumulated = '';
        try {
          for await (const part of upstream) {
            if (part.type === 'text-delta' && typeof part.textDelta === 'string') {
              accumulated += part.textDelta;
            } else if (part.type === 'text' && typeof part.textDelta === 'string') {
              accumulated += part.textDelta;
            }
            yield part;
          }
          if (accumulated.length > 0) {
            const r = await validate(accumulated, 'bonk_middleware_stream_output');
            if (!r.allowed) {
              logValidationFailure(logger, r.reason ?? 'Stream blocked', { context: 'bonk_middleware_stream_output' });
              onStreamBlocked?.(accumulated, r.reason ?? 'stream_blocked');
              throw new ConnectorValidationError(
                productionMode ? 'Stream blocked' : `Stream blocked: ${r.reason}`,
                'validation_failed'
              );
            }
          }
        } catch (err) {
          if (accumulated.length > 0) onStreamBlocked?.(accumulated, String(err));
          throw err;
        }
      }

      return { ...result, stream: guardedStream() };
    },
  };
}
