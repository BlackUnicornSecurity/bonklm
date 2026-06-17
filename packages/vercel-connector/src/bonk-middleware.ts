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
 * Input + output validation via `wrapGenerate` + `wrapStream`. By default the
 * stream is forwarded and the accumulated text is validated on a trailing
 * schedule (output can reach the client before validation completes). Pass
 * `streamReleaseMode: 'gated'` for the opt-in validate-before-release lifecycle
 * — each part is held until the text extracted from it validates, then the
 * original part is forwarded unchanged (no part reaches the client before its
 * extracted text is validated — the same content the trailing path scans).
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
  sanitizeMeta,
  validateWithTimeoutSecure
} from '@blackunicorn/bonklm';
import {
  ClientSafeStreamGate,
  type ClientSafeStreamOptions,
  ConnectorValidationError,
  logValidationFailure,
  StreamValidator
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
 * validates streamed output (trailing by default; `streamReleaseMode: 'gated'`
 * holds each part until it validates before forwarding).
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
export interface BonkMiddlewareOptions extends ClientSafeStreamOptions {
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

/** v5/v6 stream part shape the middleware forwards. */
type StreamPart = { type: string; textDelta?: string; [k: string]: unknown };

/**
 * D-058: extract the validatable text carried by a single v5/v6 stream part.
 * Centralises the accumulation rules so the trailing and gated `wrapStream`
 * paths validate IDENTICAL text — only the release timing differs. Covers
 * text/reasoning/tool-input deltas (`textDelta`), `source` URL/title citations,
 * and static `tool-call` name + args. Returns `''` for parts with no scannable
 * text.
 */
export function extractStreamPartText(part: { type?: string; textDelta?: unknown; [k: string]: unknown }): string {
  const td = part.textDelta;
  if (typeof td === 'string' && td.length > 0) {
    return td;
  }
  if (part.type === 'source') {
    const src = part as { url?: unknown; title?: unknown };
    let out = '';
    if (typeof src.url === 'string' && src.url.length > 0) out += `${src.url}\n`;
    if (typeof src.title === 'string' && src.title.length > 0) out += `${src.title}\n`;
    return out;
  }
  if (part.type === 'tool-call') {
    const tc = part as { toolName?: unknown; args?: unknown };
    let out = '';
    if (typeof tc.toolName === 'string') out += `${tc.toolName} `;
    if (tc.args !== undefined) {
      try {
        out += `${JSON.stringify(tc.args)}\n`;
      } catch {
        /* circular / non-serialisable args — skip */
      }
    }
    return out;
  }
  return '';
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
  const {
    onInputBlocked,
    onStreamBlocked,
    streamReleaseMode = 'trailing',
    minBufferBeforeRelease,
    chainHasSecretOrPii,
    detectSentenceBoundary,
    minSentenceLength
  } = options;

  const validate = async (content: string, context: string) => {
    const r = await validateWithTimeoutSecure({
      operation: () => engine.validate(content, context),
      timeoutMs: timeout,
      timeoutSentinel: () =>
        ({
          allowed: false,
          blocked: true,
          reason: 'Validation timeout',
          findings: []
        }) as { allowed: boolean; blocked: boolean; reason?: string },
      logger
    });
    return r;
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
          productionMode ? 'Input blocked' : `Input blocked: ${sanitizeMeta(r.reason)}`,
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
            productionMode ? 'Output blocked' : `Output blocked: ${sanitizeMeta(r.reason)}`,
            'validation_failed'
          );
        }
      }
      return result;
    },
    async wrapStream({ doStream }) {
      const result = await doStream();
      const upstream = result.stream;

      // Validate text from EVERY event-type that carries free-form text — not
      // just `text-delta` / `text`. v5/v6 emits `reasoning-delta`
      // (chain-of-thought the client may render), `source` (titles/URLs from
      // RAG retrievals), and `tool-input-delta` (streamed tool args). All can
      // carry attacker-influenced strings to the client unscanned if missed.
      // `extractStreamPartText` centralises the rules so the trailing + gated
      // paths validate IDENTICAL text.
      //
      // Trailing path (default): forward each part, validate the merged
      // accumulator at stream end — output can reach the client before
      // validation completes (known-limitations §5/§9).
      async function* trailingStream(): AsyncGenerator<StreamPart> {
        let accumulated = '';
        try {
          for await (const part of upstream) {
            accumulated += extractStreamPartText(part);
            yield part;
          }
          if (accumulated.length > 0) {
            const r = await validate(accumulated, 'bonk_middleware_stream_output');
            if (!r.allowed) {
              logValidationFailure(logger, r.reason ?? 'Stream blocked', { context: 'bonk_middleware_stream_output' });
              onStreamBlocked?.(accumulated, r.reason ?? 'stream_blocked');
              throw new ConnectorValidationError(
                productionMode ? 'Stream blocked' : `Stream blocked: ${sanitizeMeta(r.reason)}`,
                'validation_failed'
              );
            }
          }
        } catch (err) {
          if (accumulated.length > 0) onStreamBlocked?.(accumulated, String(err));
          throw err;
        }
      }

      // D-058 opt-in gated path: hold parts until the release gate clears their
      // extracted text, then forward the ORIGINAL parts — so no part reaches the
      // client before its extracted text validates (block-before-forward, not
      // tail-only; same content the trailing path scans).
      async function* gatedStream(): AsyncGenerator<StreamPart> {
        const gate = new ClientSafeStreamGate<StreamPart>(
          StreamValidator.create(
            { validate: (content: string) => validate(content, 'bonk_middleware_stream_output') },
            {
              logger,
              minBufferBeforeRelease,
              chainHasSecretOrPii,
              detectSentenceBoundary,
              minSentenceLength,
              onBlocked: (accumulated, reason) => onStreamBlocked?.(accumulated, reason)
            }
          ),
          extractStreamPartText
        );
        for await (const part of upstream) {
          const r = await gate.push(part);
          if (r.blocked) {
            logValidationFailure(logger, r.reason ?? 'Stream blocked', { context: 'bonk_middleware_stream_output' });
            throw new ConnectorValidationError(
              productionMode ? 'Stream blocked' : `Stream blocked: ${sanitizeMeta(r.reason)}`,
              'validation_failed'
            );
          }
          for (const out of r.released) yield out;
        }
        const tail = await gate.finish();
        if (tail.blocked) {
          logValidationFailure(logger, tail.reason ?? 'Stream blocked', { context: 'bonk_middleware_stream_output' });
          throw new ConnectorValidationError(
            productionMode ? 'Stream blocked' : `Stream blocked: ${sanitizeMeta(tail.reason)}`,
            'validation_failed'
          );
        }
        for (const out of tail.released) yield out;
      }

      return { ...result, stream: streamReleaseMode === 'gated' ? gatedStream() : trailingStream() };
    }
  };
}
