/**
 * tsd type-surface suite — @blackunicorn/bonklm-livekit (ST-04-233).
 *
 * Locks the published public type surface (imports by package name):
 * the `BonklmAgent` class (extends LiveKit `voice.Agent`; ctor requires
 * a `BonklmAgentOptions` whose `bonklm` config is mandatory AND whose
 * inherited `instructions` is mandatory; the `bonklm` field is
 * PROTECTED — NOT on the public instance surface), the generic
 * `wrapLiveKitAgentSession` factory (session type `S` is preserved, not
 * widened, bounded by `extends voice.AgentSession`, config required),
 * the `LiveKitGuardrailError` class — whose `name` is NARROWED to the
 * string literal `'LiveKitGuardrailError'` (the `override readonly`
 * contrast vs connectors that set `this.name` in the ctor) — and every
 * exported shape type. Run via `pnpm exec tsd`.
 */
import { expectType, expectError, expectAssignable, expectNotAssignable } from 'tsd';
import type { voice } from '@livekit/agents';
import type { AudioStreamValidator } from '@blackunicorn/bonklm/validators';
import {
  BonklmAgent,
  wrapLiveKitAgentSession,
  LiveKitGuardrailError,
  type BonklmAgentOptions,
  type LiveKitGuardrailConfig,
  type LiveKitGuardrailOptions,
  type LiveKitGuardrailPhase,
  type LiveKitLatencyExceededEvent,
  type LiveKitBlockEvent
} from '@blackunicorn/bonklm-livekit';

declare const av: AudioStreamValidator;
declare const config: LiveKitGuardrailConfig;

// --- BonklmAgent: ctor requires bonklm config; `bonklm` is PROTECTED --------
const agent = new BonklmAgent({ instructions: 'help the user', bonklm: config });
expectType<BonklmAgent>(agent);
expectAssignable<voice.Agent>(agent); // BonklmAgent is a voice.Agent subclass
expectNotAssignable<{ bonklm: LiveKitGuardrailConfig }>(agent); // `bonklm` is protected — NOT on the public surface
expectError(new BonklmAgent({ instructions: 'help' })); // bonklm required
expectError(new BonklmAgent({ bonklm: config })); // inherited `instructions` required
expectError(new BonklmAgent()); // options required

// --- BonklmAgentOptions (extends voice.AgentOptions + required bonklm) -------
expectAssignable<BonklmAgentOptions>({ instructions: 'x', bonklm: config });
expectNotAssignable<BonklmAgentOptions>({ instructions: 'x' }); // bonklm required
expectNotAssignable<BonklmAgentOptions>({ bonklm: config }); // instructions required

// --- wrapLiveKitAgentSession: generic <S extends voice.AgentSession> --------
declare const session: voice.AgentSession & { extra: number };
expectType<voice.AgentSession & { extra: number }>(wrapLiveKitAgentSession(session, config));
expectAssignable<{ extra: number }>(wrapLiveKitAgentSession(session, config));
expectNotAssignable<{ extra: string }>(wrapLiveKitAgentSession(session, config));
expectError(wrapLiveKitAgentSession(session)); // config required (2nd positional)
expectError(wrapLiveKitAgentSession({}, config)); // S extends voice.AgentSession

// --- LiveKitGuardrailPhase (four-member literal union) ----------------------
expectAssignable<LiveKitGuardrailPhase>('partial');
expectAssignable<LiveKitGuardrailPhase>('final');
expectAssignable<LiveKitGuardrailPhase>('tts');
expectAssignable<LiveKitGuardrailPhase>('tool');
expectNotAssignable<LiveKitGuardrailPhase>('bogus');

// --- LiveKitLatencyExceededEvent (all three fields required) ----------------
expectAssignable<LiveKitLatencyExceededEvent>({ phase: 'final', latencyMs: 1, budgetMs: 2 });
expectNotAssignable<LiveKitLatencyExceededEvent>({ phase: 'final', latencyMs: 1 }); // budgetMs required

// --- LiveKitBlockEvent (phase + reason required; category/severity optional)-
expectAssignable<LiveKitBlockEvent>({ phase: 'tts', reason: 'r' });
expectAssignable<LiveKitBlockEvent>({ phase: 'tool', reason: 'r', category: 'c', severity: 's' });
expectNotAssignable<LiveKitBlockEvent>({ phase: 'tts' }); // reason required

// --- LiveKitGuardrailConfig (audioStreamValidator required) ------------------
expectAssignable<LiveKitGuardrailConfig>({ audioStreamValidator: av });
expectAssignable<LiveKitGuardrailConfig>({
  audioStreamValidator: av,
  maxPartialLatencyMs: 100,
  maxFinalLatencyMs: 500,
  onLatencyExceeded: () => undefined,
  onBlock: () => undefined,
  onError: () => undefined
});
expectNotAssignable<LiveKitGuardrailConfig>({}); // audioStreamValidator required

// --- LiveKitGuardrailOptions (deprecated alias === LiveKitGuardrailConfig) ---
declare const aliased: LiveKitGuardrailOptions;
expectAssignable<LiveKitGuardrailConfig>(aliased);
expectAssignable<LiveKitGuardrailOptions>(config);

// --- LiveKitGuardrailError (name NARROWED to the class-name literal) --------
const err = new LiveKitGuardrailError('msg', 'final');
expectType<LiveKitGuardrailError>(err);
expectType<'LiveKitGuardrailError'>(err.name); // override readonly literal
expectType<LiveKitGuardrailPhase>(err.phase);
expectType<string | undefined>(err.category);
expectType<string | undefined>(err.severity);
new LiveKitGuardrailError('m', 'tool', { category: 'c', severity: 's' });
expectError(new LiveKitGuardrailError('m')); // phase required (positional)
expectError(new LiveKitGuardrailError('m', 'bogus')); // phase literal union
