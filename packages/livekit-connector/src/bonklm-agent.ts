/**
 * Story 3.3 — `BonklmAgent`: LiveKit `Agent` subclass with bonklm
 *  validation wired into the SDK's overridable hooks.
 *
 * Sprint 18 3-lane audit (code-reviewer BLOCK-1 + architect C-4) showed
 * the real `@livekit/agents` v1.4.x SDK does NOT expose
 * `beforeLLMCallback` / `beforeTTSCallback` as settable properties on
 * `AgentSession`. The correct integration pattern is:
 *
 *   - Pre-LLM: override `Agent.onUserTurnCompleted(chatCtx, newMessage)`.
 *     AgentSession invokes this AFTER the final transcript is committed
 *     to chat context but BEFORE the LLM call fires.
 *   - Pre-TTS: override `Agent.ttsNode(textStream, modelSettings)`.
 *     We accumulate the input text stream, validate, then re-emit on
 *     a fresh stream to the base `ttsNode`. Throw on BLOCK aborts the
 *     turn.
 *   - Partial transcripts + tool-call validation: NOT on Agent — use
 *     `wrapLiveKitAgentSession(session, ...)` which wires event
 *     listeners. The two pieces share an `AudioStreamValidator`
 *     instance via `config.audioStreamValidator`.
 *
 * **TTS streaming trade-off**: accumulating the full text stream
 * before validation defeats LiveKit's chunked-TTS pipeline (no audio
 * synthesis starts until the validator passes). For low-latency
 * voice agents this is a regression vs. raw `Agent.ttsNode`.
 * Sprint 19 (Story 3.4) will explore an incremental-validate
 * tee-stream pattern; for now correctness over latency.
 */
import { llm, voice } from '@livekit/agents';
import type { AudioFrame } from '@livekit/rtc-node';
import { ReadableStream } from 'node:stream/web';
import { AUDIO_STREAM_SURFACE } from '@blackunicorn/bonklm/validators';
import type { LiveKitGuardrailConfig, LiveKitGuardrailPhase } from './types.js';
import { LiveKitGuardrailError } from './errors.js';

// Type aliases — LiveKit v1.x namespaces these under voice.* / llm.*.
type Agent<U = unknown> = voice.Agent<U>;
const Agent = voice.Agent;
type AgentOptions<U = unknown> = voice.AgentOptions<U>;
type ModelSettings = voice.ModelSettings;
type ChatContext = llm.ChatContext;
type ChatMessage = llm.ChatMessage;

const DEFAULT_MAX_FINAL_MS = 500;

export interface BonklmAgentOptions<UserData = unknown> extends AgentOptions<UserData> {
  bonklm: LiveKitGuardrailConfig;
}

export class BonklmAgent<UserData = unknown> extends Agent<UserData> {
  protected readonly bonklm: LiveKitGuardrailConfig;
  private readonly finalBudgetMs: number;

  constructor(options: BonklmAgentOptions<UserData>) {
    const { bonklm, ...agentOptions } = options;
    super(agentOptions as AgentOptions<UserData>);
    this.bonklm = bonklm;
    this.finalBudgetMs = bonklm.maxFinalLatencyMs ?? DEFAULT_MAX_FINAL_MS;
  }

  /**
   * Pre-LLM hook. Final-path validation runs the full validator stack
   * (`AudioStreamValidator.validateFinal` → `PromptInjectionValidator`
   * + `CodeInjectionValidator` by default). BLOCK throws.
   */
  override async onUserTurnCompleted(
    _chatCtx: ChatContext,
    newMessage: ChatMessage
  ): Promise<void> {
    const text = extractMessageText(newMessage);
    const start = performance.now();
    const result = await this.bonklm.audioStreamValidator.validateFinal(text);
    this.reportLatencyIfExceeded('final', performance.now() - start, this.finalBudgetMs);

    if (result.blocked) {
      const cat = result.findings[0]?.category;
      const sev = String(result.severity);
      const reason = `bonklm:${AUDIO_STREAM_SURFACE}:final_block:${cat ?? 'unknown'}`;
      this.safeOnBlock({ phase: 'final', reason, category: cat, severity: sev });
      throw new LiveKitGuardrailError(reason, 'final', { category: cat, severity: sev });
    }
  }

  /**
   * Pre-TTS hook. Reads the entire input text stream, validates the
   * concatenated text, then delegates to the base `Agent.ttsNode` with
   * the SAME text re-emitted on a fresh stream.
   *
   * Override called by AgentSession.
   */
  override async ttsNode(
    text: ReadableStream<string>,
    modelSettings: ModelSettings
  ): Promise<ReadableStream<AudioFrame> | null> {
    const accumulated = await streamToString(text);

    const start = performance.now();
    const transient = this.bonklm.audioStreamValidator.fork();
    const result = await transient.validateFinal(accumulated);
    this.reportLatencyIfExceeded('tts', performance.now() - start, this.finalBudgetMs);

    if (result.blocked) {
      const cat = result.findings[0]?.category;
      const sev = String(result.severity);
      const reason = `bonklm:text_output:tts_block:${cat ?? 'unknown'}`;
      this.safeOnBlock({ phase: 'tts', reason, category: cat, severity: sev });
      throw new LiveKitGuardrailError(reason, 'tts', { category: cat, severity: sev });
    }

    return super.ttsNode(stringToStream(accumulated), modelSettings as never);
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private safeOnBlock(event: { phase: LiveKitGuardrailPhase; reason: string; category?: string; severity?: string }): void {
    try {
      this.bonklm.onBlock?.(event);
    } catch (err) {
      // Sprint 18 audit security B-2 closure: telemetry hook MUST NOT
      // interfere with enforcement. Swallow + route to onError.
      try {
        this.bonklm.onError?.(err);
      } catch {
        /* nothing more we can do */
      }
    }
  }

  private reportLatencyIfExceeded(
    phase: LiveKitGuardrailPhase,
    latencyMs: number,
    budgetMs: number
  ): void {
    if (latencyMs > budgetMs && this.bonklm.onLatencyExceeded) {
      try {
        this.bonklm.onLatencyExceeded({ phase, latencyMs, budgetMs });
      } catch (err) {
        try {
          this.bonklm.onError?.(err);
        } catch {
          /* nothing more we can do */
        }
      }
    }
  }
}

// =============================================================================
// Stream helpers (TTS path)
// =============================================================================

async function streamToString(stream: ReadableStream<string>): Promise<string> {
  const reader = stream.getReader();
  const parts: string[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (typeof value === 'string') parts.push(value);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* lock already released */
    }
  }
  return parts.join('');
}

function stringToStream(text: string): ReadableStream<string> {
  return new ReadableStream<string>({
    start(controller) {
      controller.enqueue(text);
      controller.close();
    },
  });
}

function extractMessageText(message: ChatMessage | undefined | null): string {
  if (!message) return '';
  // ChatMessage.content is typically a string or an array of content parts.
  const content = (message as { content?: unknown }).content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') {
          return part.text;
        }
        return '';
      })
      .join(' ');
  }
  return '';
}

