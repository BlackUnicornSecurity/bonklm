/**
 * `wrapVoltAgent(agent, opts)`
 * ===========================================
 *
 * Injects BonkLM validators into a VoltAgent (`@voltagent/core ^2.7.0`)
 * agent. Structural typing — peer-optional SDK install.
 *
 * Wraps the agent's `generateText` / `streamText` surfaces:
 *   - Pre-validates user input BEFORE the LLM call.
 *   - Post-validates the generated text AFTER (non-streaming) OR
 *     periodically during streaming.
 *
 * Symbol-watermark double-wrap
 * defence via shared `assertNotWrapped` + `markWrapped` helpers;
 * `adaptValidatorToUniversalInput` wraps caller-supplied validators
 * for string/envelope-shape neutrality; `kind: 'voice'` is NOT used
 * (VoltAgent isn't voice — use a generic kind).
 *
 * Sprint 23 hardening (anticipated architect C-1 follow-up):
 * VoltAgent block events use `kind: 'inference'` (provider 'voltagent')
 * to fit the existing `BonklmBlockEvent` discriminated union rather
 * than introducing a 6th kind.
 */
import type { GuardrailEngine, Validator } from '@blackunicorn/bonklm';
import {
  adaptValidatorToUniversalInput,
  assertNotWrapped,
  markWrapped
} from '@blackunicorn/bonklm/core/connector-utils';

/**
 * Subset of `@voltagent/core` Agent surface we wrap. Real type:
 * `Agent` from `@voltagent/core ^2.7.0`.
 */
export interface VoltAgentLike {
  generateText: (input: VoltAgentInput) => Promise<VoltAgentOutput>;
  streamText?: (input: VoltAgentInput) => AsyncIterable<VoltAgentStreamChunk>;
  name?: string;
}

export interface VoltAgentInput {
  prompt?: string;
  messages?: Array<{ role: string; content: string }>;
}

export interface VoltAgentOutput {
  text: string;
  usage?: unknown;
}

export interface VoltAgentStreamChunk {
  text?: string;
  delta?: string;
}

export interface VoltAgentBlockEvent {
  kind: 'inference';
  provider: 'voltagent';
  phase: 'input' | 'output';
  reason: string;
  category?: string;
  severity?: string;
}

export class VoltAgentGuardrailBlockedError extends Error {
  override readonly name = 'VoltAgentGuardrailBlockedError';
  readonly phase: 'input' | 'output';
  readonly category?: string;
  readonly severity?: string;

  constructor(message: string, phase: 'input' | 'output', extra?: { category?: string; severity?: string }) {
    super(message);
    this.phase = phase;
    this.category = extra?.category;
    this.severity = extra?.severity;
  }
}

export interface WrapVoltAgentOptions {
  /** Engine for input/output validation (pre-validation path). */
  engine?: GuardrailEngine;
  /**
   * Caller-supplied validators applied to user input. When set,
   * each validator runs pre-LLM. Default: skip input validation
   * (engine is used instead).
   */
  inputValidators?: Validator[];
  /** Skip output validation (default: false — validate output). */
  skipOutputValidation?: boolean;
  /** Fires on BLOCK before throw. */
  onBlock?: (event: VoltAgentBlockEvent) => void;
  /** Error sink. */
  onError?: (err: unknown) => void;
}

const BONKLM_WIRED = Symbol.for('bonklm.voltagent.wired');

export function wrapVoltAgent<A extends VoltAgentLike>(agent: A, options: WrapVoltAgentOptions): A {
  if (!agent || typeof agent.generateText !== 'function') {
    throw new TypeError('wrapVoltAgent: agent.generateText must be a function.');
  }
  if (!options?.engine && (!options?.inputValidators || options.inputValidators.length === 0)) {
    throw new TypeError('wrapVoltAgent: at least one of options.engine or options.inputValidators is required.');
  }
  assertNotWrapped(agent, BONKLM_WIRED, 'wrapVoltAgent');

  const inputValidators = (options.inputValidators ?? []).map(v =>
    adaptValidatorToUniversalInput(v, 'wrapVoltAgent.inputValidators')
  );
  const originalGenerateText = agent.generateText.bind(agent);
  const originalStreamText = agent.streamText?.bind(agent);

  const wrapped = {
    ...agent,
    generateText: async (input: VoltAgentInput): Promise<VoltAgentOutput> => {
      await preValidate(input, inputValidators, options);
      const result = await originalGenerateText(input);
      if (!options.skipOutputValidation && options.engine) {
        await postValidate(result.text ?? '', options);
      }
      return result;
    },
    streamText: originalStreamText
      ? async function* (input: VoltAgentInput): AsyncGenerator<VoltAgentStreamChunk> {
          await preValidate(input, inputValidators, options);
          let buffered = '';
          for await (const chunk of originalStreamText(input)) {
            yield chunk;
            const delta = chunk.delta ?? chunk.text ?? '';
            if (typeof delta === 'string') buffered += delta;
          }
          if (!options.skipOutputValidation && options.engine && buffered.length > 0) {
            await postValidate(buffered, options);
          }
        }
      : undefined
  } as unknown as A;

  markWrapped(wrapped, BONKLM_WIRED);
  return wrapped;
}

// =============================================================================
// Helpers
// =============================================================================

async function preValidate(
  input: VoltAgentInput,
  inputValidators: Validator[],
  options: WrapVoltAgentOptions
): Promise<void> {
  const text = extractInputText(input);
  if (text.length === 0) return;

  // Run input-specific validators first.
  for (const v of inputValidators) {
    try {
      const r = await v.validate({ kind: 'text', content: text });
      if (r?.blocked) {
        fireBlock(options, 'input', r);
        throw new VoltAgentGuardrailBlockedError(
          `VoltAgent input blocked: ${r.findings[0]?.description ?? 'unknown'}`,
          'input',
          { category: r.findings[0]?.category, severity: String(r.severity) }
        );
      }
    } catch (err) {
      if (err instanceof VoltAgentGuardrailBlockedError) throw err;
      safeOnError(options, err);
    }
  }

  // Then run the engine (if supplied).
  if (options.engine) {
    try {
      const r = await options.engine.validate(text);
      if (r.blocked) {
        fireBlock(options, 'input', r);
        throw new VoltAgentGuardrailBlockedError(
          `VoltAgent input blocked: ${r.findings[0]?.description ?? 'unknown'}`,
          'input',
          { category: r.findings[0]?.category, severity: String(r.severity) }
        );
      }
    } catch (err) {
      if (err instanceof VoltAgentGuardrailBlockedError) throw err;
      safeOnError(options, err);
      throw err;
    }
  }
}

async function postValidate(text: string, options: WrapVoltAgentOptions): Promise<void> {
  if (!options.engine || text.length === 0) return;
  const r = await options.engine.validate(text);
  if (r.blocked) {
    fireBlock(options, 'output', r);
    throw new VoltAgentGuardrailBlockedError(
      `VoltAgent output blocked: ${r.findings[0]?.description ?? 'unknown'}`,
      'output',
      { category: r.findings[0]?.category, severity: String(r.severity) }
    );
  }
}

function extractInputText(input: VoltAgentInput): string {
  if (typeof input?.prompt === 'string') return input.prompt;
  if (Array.isArray(input?.messages)) {
    return input.messages
      .filter(m => m.role === 'user')
      .map(m => m.content)
      .join('\n\n');
  }
  return '';
}

function fireBlock(
  options: WrapVoltAgentOptions,
  phase: 'input' | 'output',
  result: {
    findings?: Array<{ category?: string; description?: string }>;
    severity?: string | { toString: () => string };
  }
): void {
  const finding = result.findings?.[0];
  const event: VoltAgentBlockEvent = {
    kind: 'inference',
    provider: 'voltagent',
    phase,
    reason: finding?.description ?? `${phase}_blocked`,
    category: finding?.category,
    severity: result.severity ? String(result.severity) : undefined
  };
  try {
    options.onBlock?.(event);
  } catch (err) {
    safeOnError(options, err);
  }
}

function safeOnError(options: WrapVoltAgentOptions, err: unknown): void {
  if (!options.onError) return;
  try {
    options.onError(err);
  } catch {
    /* swallow */
  }
}
