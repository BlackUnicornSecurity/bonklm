# @blackunicorn/bonklm-livekit

LiveKit Agents (v1.x) wrapper for BonkLM. Wires `AudioStreamValidator` (Story 3.1) into the four
AC-mandated voice-agent hooks. Two integration pieces work in tandem and share a single
`AudioStreamValidator` instance:

1. **`BonklmAgent extends voice.Agent`** — overrides `onUserTurnCompleted` (final-path full
   validator stack) + `ttsNode` (pre-TTS echo-attack defence).
2. **`wrapLiveKitAgentSession(session, config)`** — wires event listeners on
   `user_input_transcribed` (partial-path → `session.interrupt({force:true})` BEFORE the LLM call)
   and `function_tools_executed` (tool-args validation).

**Peer deps:** `@livekit/agents ^1.4.0`, `@livekit/rtc-node ^0.13.0`. Node-only.

## Install

```bash
pnpm add @blackunicorn/bonklm @blackunicorn/bonklm-livekit \
  @livekit/agents @livekit/rtc-node
```

## Quick start

```ts
import { defineAgent, voice } from '@livekit/agents';
import { AudioStreamValidator } from '@blackunicorn/bonklm/validators';
import { BonklmAgent, wrapLiveKitAgentSession } from '@blackunicorn/bonklm-livekit';

export default defineAgent({
  entry: async ctx => {
    // ONE AudioStreamValidator PER session — the validator carries
    // mutable AC + gate state. Calling .fork() (or constructing
    // afresh) prevents cross-session leakage (Story 3.1
    // known-limitations §23).
    const audioStreamValidator = new AudioStreamValidator();

    // Construct BonklmAgent subclass for pre-LLM + pre-TTS hooks.
    const agent = new BonklmAgent({
      instructions: 'You are a helpful voice assistant.',
      bonklm: {
        audioStreamValidator,
        maxPartialLatencyMs: 100, // Story 3.1 AC-a
        maxFinalLatencyMs: 500,
        onBlock: event => {
          console.warn(`[bonklm] ${event.phase} BLOCKED: ${event.reason}`);
        },
        onLatencyExceeded: event => {
          console.warn(
            `[bonklm] ${event.phase} latency: ${event.latencyMs.toFixed(0)}ms (budget ${event.budgetMs}ms)`
          );
        }
      }
    });

    const session = new voice.AgentSession({
      // llm: ..., stt: ..., tts: ...
    });

    // Wire partial-path + tool-args event listeners. MUST use the SAME
    // audioStreamValidator instance so AC state flows partial → final.
    wrapLiveKitAgentSession(session, {
      audioStreamValidator,
      maxPartialLatencyMs: 100,
      onBlock: event => {
        console.warn(`[bonklm] ${event.phase} BLOCKED: ${event.reason}`);
      }
    });

    await session.start({ agent, room: ctx.room });
  }
});
```

## What gets blocked

- **Interim transcripts** with prompt-injection / jailbreak / high-risk voice-action needles
  (curated 25-needle Aho-Corasick set, see Story 3.1). Calls `session.interrupt({force:true})`
  **before** the LLM call fires.
- **Final transcripts** containing English prompt-injection / code- injection / shell-metachar /
  `pip install` / network-egress payloads. Throws `LiveKitGuardrailError` from
  `onUserTurnCompleted`.
- **TTS output** echoing an injection (echo-attack defence). Throws from `ttsNode`.
- **Tool-call args** containing code-injection sinks. Fires `onBlock(phase:'tool')` via
  `function_tools_executed` event.

## What does NOT get blocked

- **ASCII-only partial path**: homoglyph / mixed-script attacks bypass `validatePartial`
  (known-limitations §22). Final-path catches them via `PromptInjectionValidator` NFKD.
- **Post-execution tool validation**: `function_tools_executed` fires AFTER the tool ran. The bonklm
  validator decision cannot prevent execution — it only flags downstream agent steps. Your tool
  executor MUST be sandboxed for true containment.
- **TTS streaming latency**: `BonklmAgent.ttsNode` accumulates the ENTIRE text stream before
  validation. For low-latency voice agents this is a regression vs. raw `Agent.ttsNode`. Sprint 19
  explores an incremental-validate tee-stream pattern.

## Audit closures shipped in this release

- **Double-wrap rejection** (security BLOCK-1): re-wrapping the same session throws — prevents
  silent orphan-closure bypass.
- **Throwing `onBlock` does NOT skip `interrupt()`** (security BLOCK-2): telemetry hook is wrapped
  in try/catch; enforcement fires unconditionally.
- **Correct LiveKit v1.4 SDK shape**: connector uses `session.on('user_input_transcribed', ...)`
  event listener + `Agent.onUserTurnCompleted` / `Agent.ttsNode` overrides; NO property-assignment
  hooks (which silently no-op against the real SDK).
- **`interrupt({force:true})` signature**: correct v1.4 surface (no reason string param).
- **Chunk-boundary needle detection** (security CONCERN-2): needles split across two interim chunks
  still trigger `interrupt()` — the AC automaton state persists across calls.
- **Homoglyph partial-pass / final-block** (security CONCERN-5): Cyrillic-confusable inputs pass the
  partial path (documented ASCII-fold) AND get blocked on the final path.

## License

MIT. © Black Unicorn Security.
