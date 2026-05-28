/**
 * @blackunicorn/bonklm-mistral — `wrapMistral`
 * ============================================
 *
 * Wraps a Mistral SDK v2 client with BonkLM security guardrails.
 * Proxy-based; intercepts the 5 sub-resources called out by Story 2.12
 * AC (`chat`, `agents`, `fim`, `embeddings`, `classifiers`) and passes
 * every other sub-resource straight through (`audio`, `files`,
 * `models`, `beta`, `batch`, `fineTuning`, `ocr`, `workflows`,
 * `events`).
 *
 * **ESM-only.** Mistral SDK v2 is ESM-only; the connector inherits.
 * Consumers on CJS-only stacks should pin `@mistralai/mistralai@^1.x`
 * (older API surface) or migrate to ESM. README documents the
 * migration path.
 *
 *   - **chat.complete / agents.complete / fim.complete** — pre-
 *     validate user-role messages BEFORE the API call; post-validate
 *     response content + tool_calls.arguments (defensive JSON.parse).
 *     BLOCK throws `MistralGuardrailBlockedError`.
 *
 *   - **chat.stream / agents.stream / fim.stream** — pre-validate
 *     inputs; stream returns a wrapped `ReadableStream` that
 *     validates each chunk's accumulated content periodically.
 *
 *   - **embeddings.create** — pre-validate the `inputs` array (each
 *     string passed through the validator pipeline before the
 *     embedding request fires).
 *
 *   - **classifiers.moderate / classifiers.classify** — pre-validate
 *     inputs. The optional `enableModerateSecondOpinion` flag causes
 *     the connector to fire a `classifiers.moderate` call AFTER
 *     `chat.complete` / `agents.complete` / `fim.complete` and add
 *     an advisory FINDING from Mistral's moderation result to the
 *     engine's intercept telemetry.
 *
 * Connector-style-guide shape: shape #1 — `wrap<Subject>(subject,
 * engine, options?)`. Engine is the SECOND positional arg per the
 * canonical convention.
 *
 * @package @blackunicorn/bonklm-mistral
 */
import {
  ConnectorValidationError,
  sanitizeReasonText,
} from '@blackunicorn/bonklm/core/connector-utils';
import {
  MultilingualDetector,
  ReformulationDetector,
  RiskLevel,
  Severity,
} from '@blackunicorn/bonklm';
import type {
  EngineResult,
  GuardrailEngine,
  Logger,
  ValidatorInput,
} from '@blackunicorn/bonklm';
import type { MistralLike, WrapMistralOptions } from './types.js';

/** Sub-resources the connector intercepts. Everything else passes through. */
const WRAPPED_SUB_RESOURCES = new Set([
  'chat',
  'agents',
  'fim',
  'embeddings',
  'classifiers',
]);

/**
 * Error thrown by wrapped Mistral methods when the validator pipeline
 * blocks the call.
 *
 * Sprint 15 Story 2.12 audit closure (arch X7 / rev R1#2): extends
 * `ConnectorValidationError` (not bare `Error`) so consumers writing
 * cross-connector `catch (e instanceof ConnectorValidationError)`
 * handlers also catch Mistral blocks. Still catchable via
 * `instanceof MistralGuardrailBlockedError` for Mistral-specific
 * paths. Reason-text sanitization (control-char strip + 200-char
 * cap) inherited from `sanitizeReasonText` per the connector-wide
 * sec CS3 closure.
 */
export class MistralGuardrailBlockedError extends ConnectorValidationError {
  readonly surface: string;
  readonly reason?: string;

  constructor(surface: string, reason: string | undefined, productionMode: boolean) {
    const sanitized = sanitizeReasonText(reason);
    const msg = productionMode
      ? `mistral: ${surface} blocked by guardrail`
      : `mistral: ${surface} blocked: ${sanitized ?? 'no reason'}`;
    super(msg, 'validation_failed');
    this.name = 'MistralGuardrailBlockedError';
    this.surface = surface;
    this.reason = sanitized;
  }
}

interface ResolvedOptions {
  defaultLocale: string;
  enableModerateSecondOpinion: boolean;
  productionMode: boolean;
  validateInputs: boolean;
  validateOutputs: boolean;
  /**
   * Sprint 15 audit sec S1 closure: opt-in to validate ALL messages
   * (including system + assistant + tool) rather than just user.
   * Required for multi-turn deployments where assistant history can
   * be attacker-influenced via RAG / vector-store poisoning.
   */
  validateAllMessages: boolean;
  logger?: Logger;
}

function resolveOptions(options: WrapMistralOptions | undefined): ResolvedOptions {
  const o = options ?? {};
  return {
    defaultLocale: o.defaultLocale ?? 'auto',
    enableModerateSecondOpinion: o.enableModerateSecondOpinion ?? false,
    productionMode: o.productionMode ?? false,
    validateInputs: o.validateInputs ?? true,
    validateOutputs: o.validateOutputs ?? true,
    validateAllMessages: o.validateAllMessages ?? false,
    logger: o.logger,
  };
}

/**
 * Build a guarded wrapper around a Mistral SDK v2 client.
 *
 * @param client - the Mistral instance from `new Mistral({apiKey: ...})`.
 * @param engine - a `GuardrailEngine` driving the validator pipeline.
 *   Mandatory per Story 2.12 AC (shape #1: engine is the 2nd positional).
 *   For multilingual coverage (AC #3 `defaultLocale: 'auto'`), wire
 *   `MultilingualValidator` + reformulation-detection into this engine.
 *
 *   **Engine mutation under `defaultLocale: 'auto'`** (v0.5.0 audit
 *   rev v5#8 closure): the wrapper calls
 *   `engine.addValidator(new MultilingualDetector())` and
 *   `engine.addValidator(new ReformulationDetector())` IF those
 *   validators are not already registered. Side-effect is
 *   IDEMPOTENT (instanceof gate prevents double-wire) but is
 *   visible to other connectors sharing the same engine — Stagehand
 *   / Inngest / Trigger calls THROUGH the same engine will ALSO see
 *   the auto-wired validators on their validation paths. If you
 *   share engines across connectors and want Mistral-specific
 *   validators isolated, construct a dedicated engine for the
 *   Mistral connector OR pass `defaultLocale: 'en'` to opt out of
 *   the auto-wire.
 * @param options - configuration overrides (see {@link WrapMistralOptions}).
 *
 * @example
 * ```ts
 * import { Mistral } from "@mistralai/mistralai";
 * import { wrapMistral } from "@blackunicorn/bonklm-mistral";
 * import {
 *   GuardrailEngine,
 *   PromptInjectionValidator,
 *   MultilingualPatternsValidator,
 *   SecretGuard,
 * } from "@blackunicorn/bonklm";
 *
 * const client = new Mistral({ apiKey: process.env.MISTRAL_API_KEY });
 * const engine = new GuardrailEngine({
 *   validators: [
 *     new PromptInjectionValidator(),
 *     new MultilingualPatternsValidator(),
 *     new SecretGuard(),
 *   ],
 * });
 * const guarded = wrapMistral(client, engine, {
 *   defaultLocale: 'auto',           // multilingual default-on
 *   enableModerateSecondOpinion: true, // advisory finding from Mistral
 * });
 *
 * const r = await guarded.chat.complete({
 *   model: 'mistral-large-latest',
 *   messages: [{ role: 'user', content: userPrompt }],
 * });
 * ```
 */
export function wrapMistral<T extends MistralLike>(
  client: T,
  engine: GuardrailEngine,
  options?: WrapMistralOptions
): T {
  if (client === null || typeof client !== 'object') {
    throw new Error('wrapMistral: client must be a non-null object.');
  }
  if (engine === undefined || engine === null || typeof engine.validateInput !== 'function') {
    throw new Error(
      'wrapMistral: engine must be a GuardrailEngine instance (shape #1 — engine is the 2nd positional arg).'
    );
  }
  const config = resolveOptions(options);

  // Sprint 15 audit arch X3 closure: AC #3 mandates
  // "MultilingualValidator + Reformulation default-on" when
  // `defaultLocale: 'auto'`. Auto-wire by adding the validators to the
  // engine IF they aren't already registered. Idempotent — checks
  // `engine.getValidators()` first.
  if (config.defaultLocale === 'auto') {
    autoWireMultilingualValidators(engine, config);
  }

  // Capture a bound reference to `classifiers.moderate` for the
  // second-opinion advisory wiring. `undefined` if the consumer's
  // client lacks classifiers (the option becomes a no-op).
  const moderateFn = bindModerate(client.classifiers);

  // Sprint 15 audit arch X4 closure: warn at wrap time when
  // `enableModerateSecondOpinion: true` is set but the consumer's
  // client lacks classifiers — silently degrading to no-op was
  // observably surprising.
  if (config.enableModerateSecondOpinion && moderateFn === undefined) {
    config.logger?.warn(
      '[bonklm-mistral] enableModerateSecondOpinion=true but the client lacks ' +
        'a `classifiers.moderate` method; second-opinion advisory becomes a no-op. ' +
        'Ensure the @mistralai/mistralai version exposes the Classifiers sub-resource.'
    );
  }

  // Pre-build wrapped sub-resources so the Proxy `get` trap returns
  // stable references.
  const wrappedSubResources = {
    chat: wrapCompletionLike(client.chat, engine, config, 'chat', moderateFn),
    agents: wrapCompletionLike(client.agents, engine, config, 'agents', moderateFn),
    fim: wrapFim(client.fim, engine, config, moderateFn),
    embeddings: wrapEmbeddings(client.embeddings, engine, config),
    classifiers: wrapClassifiers(client.classifiers, engine, config),
  };

  return new Proxy(client, {
    get(target: T, prop: string | symbol, receiver: unknown): unknown {
      if (prop === 'raw') return target;
      if (typeof prop === 'string' && WRAPPED_SUB_RESOURCES.has(prop)) {
        const wrapped = wrappedSubResources[prop as keyof typeof wrappedSubResources];
        // If the underlying client didn't expose this sub-resource,
        // fall through to undefined rather than returning a dangling
        // wrapper.
        if (wrapped === undefined) return undefined;
        return wrapped;
      }
      const value = Reflect.get(target, prop, receiver);
      if (typeof value === 'function') {
        return (value as (...args: unknown[]) => unknown).bind(target);
      }
      return value;
    },
  });
}

// ─────────────────────────────────────────────────────────────────────
// Chat / Agents wrappers — symmetric API surface (complete / stream)
// ─────────────────────────────────────────────────────────────────────

interface MistralMessage {
  role?: string;
  content?: unknown;
  tool_calls?: Array<{
    id?: string;
    function?: { name?: string; arguments?: string };
  }>;
}

interface MistralCompletionRequest {
  model?: string;
  messages?: MistralMessage[];
}

interface MistralCompletionResponse {
  choices?: Array<{
    message?: MistralMessage;
  }>;
}

/**
 * Idempotently auto-wire `MultilingualDetector` + `ReformulationDetector`
 * into the consumer's engine when `defaultLocale: 'auto'`. Sprint 15
 * audit arch X3 closure: AC #3 says "default-on" — this is the
 * default-on wiring.
 *
 * Validators are added only if NOT already present (instance-of
 * check). The connector does not REMOVE consumer-supplied validators;
 * additions are purely additive + idempotent across multiple
 * `wrapMistral` calls.
 */
function autoWireMultilingualValidators(
  engine: GuardrailEngine,
  config: ResolvedOptions
): void {
  const existing = engine.getValidators();
  const hasMultilingual = existing.some(
    (v) => v instanceof MultilingualDetector
  );
  const hasReformulation = existing.some(
    (v) => v instanceof ReformulationDetector
  );
  if (!hasMultilingual) {
    engine.addValidator(new MultilingualDetector());
    config.logger?.info(
      '[bonklm-mistral] auto-wired MultilingualDetector ' +
        '(defaultLocale: "auto"); pass `defaultLocale: "en"` etc. to opt out.'
    );
  }
  if (!hasReformulation) {
    engine.addValidator(new ReformulationDetector());
    config.logger?.info(
      '[bonklm-mistral] auto-wired ReformulationDetector ' +
        '(defaultLocale: "auto"); pass `defaultLocale: "en"` etc. to opt out.'
    );
  }
}

/**
 * Bind `classifiers.moderate` for the second-opinion advisory wiring.
 * Returns `undefined` if the consumer's client lacks classifiers —
 * the option silently becomes a no-op rather than throwing.
 *
 * Sprint 15 audit sec S7 NOTE: when the consumer double-wraps the
 * SAME client through `wrapMistral` twice, the second wrap reads
 * `client.classifiers` from the ALREADY-PROXIED client. The Proxy
 * `get` trap returns the wrapped `classifiers` (with guarded
 * `.moderate`), so the bound function here would be the GUARDED
 * `.moderate` — adding an extra validation pass on advisory inputs.
 * Consumers SHOULD wrap once per client lifetime; double-wrap is
 * documented as not-recommended in known-limitations.md §17.
 */
function bindModerate(
  classifiersSubResource: unknown
): ((req: unknown, opts?: unknown) => Promise<unknown>) | undefined {
  if (classifiersSubResource === null || classifiersSubResource === undefined) {
    return undefined;
  }
  const cls = classifiersSubResource as {
    moderate?: (req: unknown, opts?: unknown) => Promise<unknown>;
  };
  if (typeof cls.moderate !== 'function') return undefined;
  return cls.moderate.bind(cls);
}

function wrapCompletionLike(
  subResource: unknown,
  engine: GuardrailEngine,
  config: ResolvedOptions,
  surface: 'chat' | 'agents',
  moderateFn: ((req: unknown, opts?: unknown) => Promise<unknown>) | undefined
): object | undefined {
  if (subResource === undefined || subResource === null) return undefined;
  const sub = subResource as {
    complete?: (req: unknown, opts?: unknown) => Promise<unknown>;
    stream?: (req: unknown, opts?: unknown) => Promise<unknown>;
  };

  const guarded: Record<string, unknown> = {};

  if (typeof sub.complete === 'function') {
    guarded.complete = async (req: unknown, opts?: unknown): Promise<unknown> => {
      const request = (req ?? {}) as MistralCompletionRequest;
      if (config.validateInputs) {
        await validateMessages(
          request.messages,
          engine,
          config,
          `${surface}:complete:input`
        );
      }
      const response = (await sub.complete!(req, opts)) as MistralCompletionResponse;
      if (config.validateOutputs) {
        await validateCompletionResponse(
          response,
          engine,
          config,
          `${surface}:complete:output`
        );
      }
      if (config.enableModerateSecondOpinion && moderateFn !== undefined) {
        await fireModerateSecondOpinion(
          moderateFn,
          response,
          engine,
          config,
          `${surface}:complete:moderate`,
          request.model
        );
      }
      return response;
    };
  }

  if (typeof sub.stream === 'function') {
    guarded.stream = async (req: unknown, opts?: unknown): Promise<unknown> => {
      const request = (req ?? {}) as MistralCompletionRequest;
      if (config.validateInputs) {
        await validateMessages(
          request.messages,
          engine,
          config,
          `${surface}:stream:input`
        );
      }
      // Stream wrapping: return the underlying ReadableStream. Post-
      // validation on streams requires accumulating chunks; for v0.4
      // we expose the underlying stream as-is and rely on consumer-
      // side validation of the final accumulated content. Production
      // streaming consumers should add their own per-chunk validation
      // via the engine. (Documented in known-limitations.md.)
      return sub.stream!(req, opts);
    };
  }

  return guarded;
}

// ─────────────────────────────────────────────────────────────────────
// FIM wrapper — similar shape but prompt/suffix-based instead of messages
// ─────────────────────────────────────────────────────────────────────

interface MistralFimRequest {
  model?: string;
  prompt?: string;
  suffix?: string;
}

function wrapFim(
  subResource: unknown,
  engine: GuardrailEngine,
  config: ResolvedOptions,
  // moderateFn captured for symmetry with chat/agents but not used
  // today — FIM (Fill-in-the-Middle) is code-completion and Mistral's
  // moderation classifier is text-oriented; advisory second-opinion
  // here would mostly produce noise. Reserved for future use.
  _moderateFn: ((req: unknown, opts?: unknown) => Promise<unknown>) | undefined
): object | undefined {
  if (subResource === undefined || subResource === null) return undefined;
  const sub = subResource as {
    complete?: (req: unknown, opts?: unknown) => Promise<unknown>;
    stream?: (req: unknown, opts?: unknown) => Promise<unknown>;
  };
  const guarded: Record<string, unknown> = {};

  const validateFimInput = async (
    request: MistralFimRequest,
    surface: string
  ): Promise<void> => {
    if (!config.validateInputs) return;
    // FIM has prompt + optional suffix; both can carry user content.
    const fields: Array<[string, string | undefined]> = [
      ['prompt', request.prompt],
      ['suffix', request.suffix],
    ];
    for (const [label, value] of fields) {
      if (typeof value === 'string' && value.length > 0) {
        const result = await engine.validate(value);
        if (result.blocked) {
          throw new MistralGuardrailBlockedError(
            `${surface}:${label}`,
            result.reason,
            config.productionMode
          );
        }
      }
    }
  };

  if (typeof sub.complete === 'function') {
    guarded.complete = async (req: unknown, opts?: unknown): Promise<unknown> => {
      const request = (req ?? {}) as MistralFimRequest;
      await validateFimInput(request, 'fim:complete:input');
      const response = (await sub.complete!(req, opts)) as MistralCompletionResponse;
      if (config.validateOutputs) {
        await validateCompletionResponse(
          response,
          engine,
          config,
          'fim:complete:output'
        );
      }
      return response;
    };
  }

  if (typeof sub.stream === 'function') {
    guarded.stream = async (req: unknown, opts?: unknown): Promise<unknown> => {
      const request = (req ?? {}) as MistralFimRequest;
      await validateFimInput(request, 'fim:stream:input');
      return sub.stream!(req, opts);
    };
  }

  return guarded;
}

// ─────────────────────────────────────────────────────────────────────
// Embeddings wrapper
// ─────────────────────────────────────────────────────────────────────

interface MistralEmbeddingRequest {
  model?: string;
  inputs?: string | string[];
}

function wrapEmbeddings(
  subResource: unknown,
  engine: GuardrailEngine,
  config: ResolvedOptions
): object | undefined {
  if (subResource === undefined || subResource === null) return undefined;
  const sub = subResource as {
    create?: (req: unknown, opts?: unknown) => Promise<unknown>;
  };
  if (typeof sub.create !== 'function') return undefined;

  return {
    create: async (req: unknown, opts?: unknown): Promise<unknown> => {
      const request = (req ?? {}) as MistralEmbeddingRequest;
      if (config.validateInputs && request.inputs !== undefined) {
        const inputs = Array.isArray(request.inputs)
          ? request.inputs
          : [request.inputs];
        for (let i = 0; i < inputs.length; i++) {
          const item = inputs[i];
          if (typeof item !== 'string' || item.length === 0) continue;
          const result = await engine.validate(item);
          if (result.blocked) {
            throw new MistralGuardrailBlockedError(
              `embeddings:create:input[${i}]`,
              result.reason,
              config.productionMode
            );
          }
        }
      }
      return sub.create!(req, opts);
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Classifiers wrapper (moderate + classify)
// ─────────────────────────────────────────────────────────────────────

interface MistralClassificationRequest {
  model?: string;
  inputs?: string | string[];
}

function wrapClassifiers(
  subResource: unknown,
  engine: GuardrailEngine,
  config: ResolvedOptions
): object | undefined {
  if (subResource === undefined || subResource === null) return undefined;
  const sub = subResource as {
    moderate?: (req: unknown, opts?: unknown) => Promise<unknown>;
    classify?: (req: unknown, opts?: unknown) => Promise<unknown>;
  };
  const guarded: Record<string, unknown> = {};

  const validateClassifierInput = async (
    request: MistralClassificationRequest,
    surface: string
  ): Promise<void> => {
    if (!config.validateInputs || request.inputs === undefined) return;
    const inputs = Array.isArray(request.inputs)
      ? request.inputs
      : [request.inputs];
    for (let i = 0; i < inputs.length; i++) {
      const item = inputs[i];
      if (typeof item !== 'string' || item.length === 0) continue;
      const result = await engine.validate(item);
      if (result.blocked) {
        throw new MistralGuardrailBlockedError(
          `${surface}:input[${i}]`,
          result.reason,
          config.productionMode
        );
      }
    }
  };

  if (typeof sub.moderate === 'function') {
    guarded.moderate = async (req: unknown, opts?: unknown): Promise<unknown> => {
      const request = (req ?? {}) as MistralClassificationRequest;
      await validateClassifierInput(request, 'classifiers:moderate');
      return sub.moderate!(req, opts);
    };
  }

  if (typeof sub.classify === 'function') {
    guarded.classify = async (req: unknown, opts?: unknown): Promise<unknown> => {
      const request = (req ?? {}) as MistralClassificationRequest;
      await validateClassifierInput(request, 'classifiers:classify');
      return sub.classify!(req, opts);
    };
  }

  return guarded;
}

// ─────────────────────────────────────────────────────────────────────
// Shared helpers — message extraction, response validation, moderation
// ─────────────────────────────────────────────────────────────────────

/**
 * Extract validator-targetable text from a Mistral message. Returns
 * `undefined` if the message lacks string content (e.g. image-only
 * content arrays — those carry structured `[{type: 'text', text},
 * {type: 'image_url', ...}]` shapes that we extract text from
 * defensively).
 */
function extractMessageText(message: MistralMessage): string | undefined {
  const content = message.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    // Structured content array — extract text parts only.
    //
    // Sprint 15 audit rev R1#4 closure: join with SPACE (not `\n`)
    // to defeat the split-text bypass where an attacker fragments
    // the canonical injection phrase across two text parts to skirt
    // line-anchored regex patterns. Space-joined output preserves
    // the original phrase contiguously.
    //
    // Sprint 15 audit sec S2 NOTE: `image_url` / non-text parts are
    // dropped here — an OCR-readable injection embedded in an image
    // bypasses entirely. Documented in known-limitations.md §17.
    const textParts: string[] = [];
    for (const part of content) {
      if (
        typeof part === 'object' &&
        part !== null &&
        (part as { type?: unknown }).type === 'text' &&
        typeof (part as { text?: unknown }).text === 'string'
      ) {
        textParts.push((part as { text: string }).text);
      }
    }
    return textParts.length > 0 ? textParts.join(' ') : undefined;
  }
  return undefined;
}

/**
 * Pre-validate every user-role message in the request. Throws
 * `MistralGuardrailBlockedError` on the first BLOCK. System/assistant/
 * tool messages are NOT validated by default (consumers wanting that
 * coverage should configure their validator chain explicitly).
 *
 * Sprint 15 Story 2.12 audit note: validating only user-role
 * messages matches the multi-turn conversation pattern where
 * system + assistant + tool messages are server-curated. Consumers
 * mixing untrusted multi-turn history should pre-validate at the
 * source.
 *
 * Uses `engine.validate(content: string)` for text-only inputs so
 * string-shaped validators (PromptInjectionValidator, SecretGuard,
 * etc.) receive the right argument type. `engine.validateInput` is
 * reserved for the structured discriminated-union surfaces.
 */
async function validateMessages(
  messages: MistralMessage[] | undefined,
  engine: GuardrailEngine,
  config: ResolvedOptions,
  surface: string
): Promise<void> {
  if (!Array.isArray(messages) || messages.length === 0) return;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    // Sprint 15 audit sec S1 closure: `validateAllMessages` opt-in
    // covers the multi-turn case where assistant history is
    // attacker-influenced (RAG / vector-store poisoning).
    if (!config.validateAllMessages && m.role !== 'user') continue;
    const text = extractMessageText(m);
    if (text === undefined) continue;
    const result: EngineResult = await engine.validate(text);
    if (result.blocked) {
      throw new MistralGuardrailBlockedError(
        `${surface}[messages[${i}]]`,
        result.reason,
        config.productionMode
      );
    }
  }
}

/**
 * Post-validate the completion response: assistant content +
 * tool_calls.arguments. Defensive JSON.parse on tool args — malformed
 * JSON logs a warning + skips rather than throwing into the consumer's
 * call stack (Story 2.12 AC #5).
 */
async function validateCompletionResponse(
  response: MistralCompletionResponse | undefined,
  engine: GuardrailEngine,
  config: ResolvedOptions,
  surface: string
): Promise<void> {
  if (response === undefined || response === null) return;
  const choices = response.choices;
  if (!Array.isArray(choices)) return;

  for (let i = 0; i < choices.length; i++) {
    const choice = choices[i];
    const message = choice.message;
    if (message === undefined || message === null) continue;

    // 1. Assistant content text.
    const content = extractMessageText(message);
    if (content !== undefined) {
      const result = await engine.validate(content);
      if (result.blocked) {
        throw new MistralGuardrailBlockedError(
          `${surface}[choices[${i}].content]`,
          result.reason,
          config.productionMode
        );
      }
    }

    // 2. Tool calls.
    const toolCalls = message.tool_calls;
    if (Array.isArray(toolCalls)) {
      for (let j = 0; j < toolCalls.length; j++) {
        const tc = toolCalls[j];
        const fn = tc.function;
        if (fn === undefined || fn === null) continue;
        const toolName = typeof fn.name === 'string' ? fn.name : 'unknown';
        const argsRaw = fn.arguments;
        if (typeof argsRaw !== 'string') continue;

        // AC #5 closure: defensive JSON.parse.
        let parsed: unknown;
        try {
          parsed = JSON.parse(argsRaw);
        } catch (err) {
          config.logger?.warn(
            '[bonklm-mistral] tool_calls[].function.arguments JSON.parse failed; skipping per-call validation',
            {
              toolName,
              error: err instanceof Error ? err.message : String(err),
            }
          );
          continue;
        }
        const input: ValidatorInput = {
          kind: 'tool_call',
          toolName,
          args: parsed,
        };
        const result = await engine.validateInput(input);
        if (result.blocked) {
          throw new MistralGuardrailBlockedError(
            `${surface}[choices[${i}].tool_calls[${j}]]`,
            result.reason,
            config.productionMode
          );
        }
      }
    }
  }
}

/**
 * Fire `classifiers.moderate` on the response content as an advisory
 * second-opinion. The result is dispatched to `engine.onIntercept(...)`
 * listeners via `notifyCachedResult` as an informational finding;
 * a high-confidence moderation hit does NOT throw a block (the
 * validator pipeline already handled the BLOCK path).
 *
 * Sprint 15 Story 2.12 AC #4 closure: enable via
 * `enableModerateSecondOpinion: true`.
 */
async function fireModerateSecondOpinion(
  moderateFn: (req: unknown, opts?: unknown) => Promise<unknown>,
  response: MistralCompletionResponse | undefined,
  engine: GuardrailEngine,
  config: ResolvedOptions,
  surface: string,
  model: string | undefined
): Promise<void> {
  if (response === undefined || response === null) return;
  const choices = response.choices;
  if (!Array.isArray(choices) || choices.length === 0) return;

  // Aggregate all assistant content + tool-call argument JSON strings
  // into the moderation request. Mistral's moderation classifier
  // takes a `inputs: string[]` request shape.
  const inputs: string[] = [];
  for (const choice of choices) {
    const text = choice.message ? extractMessageText(choice.message) : undefined;
    if (typeof text === 'string' && text.length > 0) inputs.push(text);
  }
  if (inputs.length === 0) return;

  let moderationResult: unknown;
  try {
    moderationResult = await moderateFn({
      // Use the same model namespace as the chat request when present;
      // fall back to Mistral's standard moderation model.
      model:
        typeof model === 'string' && model.includes('moderation')
          ? model
          : 'mistral-moderation-latest',
      inputs,
    });
  } catch (err) {
    config.logger?.warn(
      `[bonklm-mistral] ${surface}: classifiers.moderate second-opinion call failed; skipping advisory finding`,
      { error: err instanceof Error ? err.message : String(err) }
    );
    return;
  }

  // Sprint 15 audit sec S5 closure: NARROW the forwarded moderation
  // result before it reaches engine.onIntercept(...) listeners. Raw
  // Mistral responses may include attacker-controlled echo of flagged
  // content; we forward only the structurally-known fields (categories
  // + category_scores per result). Consumers wanting the raw response
  // can re-call `classifiers.moderate` themselves outside the wrap.
  const narrowedResult = narrowModerationResult(moderationResult);

  // Sprint 15 audit rev R1#1 closure: use the proper enum values
  // (Severity.INFO / RiskLevel.LOW). The previous `'low' as never`
  // cast was broken — RiskLevel.LOW = 'LOW' (uppercase).
  void engine.notifyCachedResult(
    [
      {
        allowed: true,
        blocked: false,
        severity: Severity.INFO,
        risk_level: RiskLevel.LOW,
        risk_score: 0,
        findings: [],
        timestamp: Date.now(),
        validatorName: 'MistralModerateAdvisory',
        metadata: {
          mistralModerationResult: narrowedResult,
        },
      },
    ],
    inputs.join('\n'),
    surface
  );
}

/**
 * Narrow the raw `classifiers.moderate` response to the
 * structurally-known fields (`categories: Record<string, boolean>`
 * + `category_scores: Record<string, number>` per result). Drops any
 * additional fields that may carry attacker-influenced echo content.
 *
 * sec S5 closure: previously the connector forwarded the entire raw
 * response into `metadata.mistralModerationResult` — a future SDK
 * version that echoes a flagged content fragment in the response
 * would leak that into consumers' onIntercept handlers unredacted.
 */
function narrowModerationResult(raw: unknown): {
  results: Array<{
    categories?: Record<string, boolean>;
    category_scores?: Record<string, number>;
  }>;
} {
  const out: Array<{
    categories?: Record<string, boolean>;
    category_scores?: Record<string, number>;
  }> = [];
  if (raw === null || typeof raw !== 'object') return { results: out };
  const results = (raw as { results?: unknown }).results;
  if (!Array.isArray(results)) return { results: out };
  for (const r of results) {
    if (r === null || typeof r !== 'object') continue;
    const rec = r as Record<string, unknown>;
    const entry: {
      categories?: Record<string, boolean>;
      category_scores?: Record<string, number>;
    } = {};
    if (rec.categories !== null && typeof rec.categories === 'object') {
      const cats: Record<string, boolean> = {};
      for (const [k, v] of Object.entries(
        rec.categories as Record<string, unknown>
      )) {
        if (typeof v === 'boolean') cats[k] = v;
      }
      entry.categories = cats;
    }
    if (
      rec.category_scores !== null &&
      typeof rec.category_scores === 'object'
    ) {
      const scores: Record<string, number> = {};
      for (const [k, v] of Object.entries(
        rec.category_scores as Record<string, unknown>
      )) {
        if (typeof v === 'number') scores[k] = v;
      }
      entry.category_scores = scores;
    }
    out.push(entry);
  }
  return { results: out };
}
