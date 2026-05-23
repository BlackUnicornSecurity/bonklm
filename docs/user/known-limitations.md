# BonkLM v0.4.0 — Known Limitations

BonkLM is deterministic pattern + structural defence. There are
classes of attack the v0.4.0 engine does NOT catch, and surfaces
where the platform forces us into a documented best-effort posture.
This document enumerates those honestly so consumers can layer
additional defences for the threats their application actually faces.

## 1. CUA (Computer Use Agent) mode — unvalidatable surface

Anthropic's CUA / "computer use" mode runs the model against screen
state + simulated mouse/keyboard events. The surface is binary
screenshots plus structured tool-call results, not text. BonkLM's
pattern engine cannot meaningfully scan screen captures, and the
tool-call args (mouse XY, key sequences, scroll deltas) are
information-theoretically too narrow for prompt-injection signals.

**Mitigation**: do not use BonkLM as the sole guardrail for CUA
deployments. Apply Anthropic's own CUA safety mode + a screen-capture
review pipeline. BonkLM CAN validate text-based tool results (the
`tool_call` surface) that CUA emits when interacting with web pages,
but the screen-state inputs are out of scope.

## 2. Vapi transcript webhook — fire-and-forget delivery

Vapi's voice-agent transcription webhook posts BACK to your server
asynchronously with `{ message: { type: 'transcript', transcript } }`.
By the time BonkLM validates the transcript, the spoken response has
already been TTS'd and played to the caller. The detection is post-hoc
diagnostic, not prevention.

**Mitigation**: ship BonkLM in the request path that COMPOSES the
LLM prompt going INTO Vapi (input-direction validation), not on the
webhook. Story 3.4 (Sprint 19) adds an inline guardrail on the
Vapi `assistant.tools[]` surface for the request-direction path.

## 3. Daytona / Sandbox `.connect()` post-connect state

Daytona's sandbox `.connect()` returns a sandbox handle whose
filesystem and process state are NOT inspected by BonkLM at connect
time. A pre-populated sandbox carrying attacker artefacts (placed by
a prior agent run or supply-chain compromise of the sandbox image)
flows directly into the agent's tool-call surface unsanitised.

**Mitigation**: treat sandbox-execute tool outputs as
`retrieved_doc`-surface untrusted content — wrap with
`createRetrievedDocValidator` before the result enters the agent
context. Story 3.5 (Sprint 19-20) ships the sandbox connector with
this wiring built in.

## 4. Multilingual = regex, NOT machine learning

`MultilingualDetector` ships hand-curated regex patterns for 10
languages (FR/DE/ES/PT/IT/ZH/JA/KO/RU/AR + romanised transliterations).
Coverage is **breadth, not depth**: each language has 4 patterns
(`system_override`, `constraint_removal`, `mode_switching`,
`role_hijacking`). A native speaker rewriting "ignore previous
instructions" in idiomatic Mandarin that does NOT use the canonical
`忽略...指令` phrasing will pass.

For comparison, **Lakera** and **OpenAI Moderation** use trained ML
models on multilingual jailbreak corpora; their recall on
adversarially-rewritten payloads is higher than ours.

**Mitigation**: layer BonkLM + a language-specific ML moderation
endpoint when shipping to non-English-primary markets. BonkLM's
deterministic short-circuit reduces the moderation-endpoint call
volume; the ML model catches what regex doesn't.

## 5. Stream output: full-response mode is the only 100% leak prevention

`StreamValidator.processForClient(...)` with
`minBufferBeforeRelease: 256` (or first-sentence boundary) buffers
the first chunks before forwarding to the client. Validation runs
when the buffer hits the threshold; on pass, content is released;
on block, the buffer is dropped.

But once chars 1-256 are released, chars 257-N stream in. The
validator scans the accumulated tail at each interval; if a secret
appears at chars 1500-1530, it's caught and the stream terminates
— but chars 256-1500 have already reached the client.

**The only setting that prevents partial-leak is
`minBufferBeforeRelease: Infinity`** (full-response mode). Default
flips to `Infinity` when `chainHasSecretOrPii: true` (R2-D1). For
applications where partial-stream leakage of a credential is
unacceptable, you MUST opt into full-response mode explicitly.

## 6. ElizaOS Class-4 PATCH-route attack window

The Story 1.8 `evaluateRecipientGate` reads `runtime.getMemories(...)`
to look up user-authored corroboration. If the upstream ElizaOS
persistence layer is mutated via the unauthenticated PATCH route
(`PATCH /api/agents/<id>/memories/<known-id>`), BonkLM reads
attacker-controlled data.

Phase-1 detects this at deploy time via `bonklm doctor --runtime`
(deferred to Phase-2 implementation). **Phase-2 / Story 2.4a (Sprint
12, v0.5.0)** closes the gap structurally via shadow-log read
(Story 1.3b primitive).

## 7. Promise-of-secret in tool call args (TOCTOU)

The `tool_call` validator scans args at the moment of LLM-emit. If
the args carry a reference (e.g. a closure object that resolves to
fetched data only when the connector invokes it), BonkLM scans the
reference, not the resolved value. Connectors that materialise
args lazily defeat the scan.

**Mitigation**: do not pass async-resolvable references in tool-call
args. The standard SDK shapes (Anthropic, OpenAI, Google GenAI,
Vercel) all pass concrete JSON values — this caveat applies only to
custom connectors.

## 8. Composed-context bidirectional scan misses long-range payloads

`createComposedContextValidator` scans forward + reverse concatenation
to defeat order-dependent payload splits. But a payload split across
3+ entries with a specific cross-permutation that neither forward nor
reverse covers can still slip past. The 32KB soft cap and 200KB hard
cap further limit attacker payload size, so a 5-entry permutation
attack at scale also burns through the truncation budget.

**Mitigation**: rely on the upstream memory-write defence
(`createMemoryWriteValidator`) to catch poisoned individual entries
BEFORE they reach the composed-context recall path. Defence in depth.

## 9. Streaming connectors use the legacy lifecycle

The new middleware-style connectors (vercel `bonkMiddleware`,
google-genai `wrapGenerateContentStream`, openai-agents `wrapRealtime`,
langchain `createBonklmMiddleware`) currently use the legacy
`StreamValidator.process()` / `.finalize()` lifecycle. The Story 1.1b
release-gate `processForClient` / `finalizeForClient` API exists but
is not yet wired through these connectors. Stream output reaches the
client before validation has completed.

**Mitigation**: when full-response mode (Infinity buffer) is set on
the engine, the legacy lifecycle does not change the leak posture
because per-chunk forwarding is already disabled at the engine level.
For partial-buffer mode, Phase-2 will migrate each connector to
`processForClient`.

## 10. Guards do NOT fire on browser-agent / Inngest / Eko surfaces

`SecretGuard`, `BashSafetyGuard`, and any other `Guard`-shaped check
attached to `GuardrailEngine` via `guards: [...]` **only fire on
`engine.validate(content: string)` call paths**. The connectors added
in v0.5.0 — `@blackunicorn/bonklm-stagehand`, `@blackunicorn/bonklm-eko`,
`@blackunicorn/bonklm-browser-agents-core`, `@blackunicorn/bonklm-inngest` —
route validation through `engine.validateInput(input: ValidatorInput)`
which deliberately skips the guards pipeline (guards take a `string`
+ optional `context`; the discriminated-union doesn't map cleanly).

**Concrete impact**: a consumer wiring `SecretGuard` expecting it
to fire on a Stagehand `act` tool-call args, an Eko `file.write`
payload, or an Inngest `validateToolArgs` invocation will get
**zero** guard coverage. Only `Validator`-shaped checks (e.g.
`SecretValidator`, `BashSafetyValidator` if you build them) run on
these surfaces.

**Mitigation**:
  1. Re-implement security-critical guards AS validators (subclass
     `Validator` rather than `Guard`). Validators receive the
     discriminated-union ValidatorInput and run on every surface.
  2. For high-blast-radius surfaces (file.write content, MCP tool
     args), additionally invoke `engine.validate(JSON.stringify(args))`
     yourself before dispatch so guards fire on the stringified form.

A future release (Sprint 14+) may unify the two pipelines so guards
fire on `validateInput` too — but the type-safety + result-shape
unification is non-trivial and currently a known gap.

## 11. CRIU-checkpoint heap exposure of cache-adapter credentials

(Added: Sprint 14 cumulative audit security sec S5 closure.)

The Trigger.dev connector (`@blackunicorn/bonklm-trigger`) stores a
validation handle in Trigger.dev's `locals` registry so it survives
CRIU checkpoint/resume across `wait.for(...)` boundaries. If your
handle holds a reference to a cache adapter (Redis client, etc.) that
embeds credentials inside its closure state, those credentials are
serialized as part of the V8 heap snapshot during CRIU checkpoint.

Trigger.dev's CRIU snapshot is stored at-rest in object storage
(typically S3-compatible) — potentially a different security tier than
the running compute machine.

**Mitigation**:
  1. Use secretless adapter factories — resolve credentials from an
     env var at factory-init time so the credential is a stack-frame
     string rather than a long-lived closure reference.
  2. Review your Trigger.dev project's snapshot storage tier ACLs.
  3. Rotate cache credentials more aggressively in CRIU-resumed
     workloads.

## 12. Replay-storm DoS on deterministic BLOCK + non-Abort errors

(Added: Sprint 14 cumulative audit security sec S6 closure.)

In replay-capable runtimes (Inngest, Trigger.dev), a deterministic
validator BLOCK paired with a `throw new Error(...)` triggers a
retry storm:

  1. Attempt N: validator BLOCKs, consumer throws `Error`, Trigger.dev
     queues retry.
  2. Attempt N+1: cached BLOCK is served (validator does NOT re-fire,
     the cache works correctly), consumer throws again, retry.
  3. Loop continues until `maxAttempts` is exhausted.

The cached BLOCK prevents validator re-execution (correct) but does
NOT prevent the retry storm itself.

**Mitigation**:
  - In Trigger.dev `run()` body, throw `AbortTaskRunError` (from
    `@trigger.dev/sdk/v3`) instead of a generic `Error`. It terminates
    the run immediately without consuming retry budget.
  - In Inngest function body, throw `NonRetriableError` (from
    `inngest`) for the same effect.
  - Set `retry: { maxAttempts: 1 }` on tasks whose BLOCK decisions
    should never retry.

## 13. Unknown ValidatorInput `kind` discriminants pass through unvalidated

(Added: Sprint 14 cumulative audit security sec S8 closure.)

The `ValidatorInput` discriminated union has a fixed set of known
discriminants (`text`, `tool_call`, `retrieved_docs`, `memory_write`,
`composed_context`, etc.). Connectors (Inngest, Trigger.dev) that
accept a pre-built `ValidatorInput` object check the `kind` field is
a string and forward to the validator pipeline.

If a consumer constructs a `ValidatorInput` with an unrecognized
`kind` (typo, or a future kind not yet supported by all validators),
each validator that switches on `kind` will default to ALLOW (no-match
path).

**Mitigation**:
  - Use the typed constructors / helpers from `@blackunicorn/bonklm`
    rather than building raw `ValidatorInput` objects.
  - Audit your validator stack: each validator should explicitly
    assert known `kind` values + return a structured BLOCK for
    unrecognized ones if your threat model requires it.

## 14. Redact-mode sentinel as secondary injection vector

(Added: Sprint 14 cumulative audit security sec S9 closure.)

When a `MemoryWriteValidator` is configured with `onFailure: 'redact'`,
the validator replaces flagged regions with a redaction sentinel
(default `[REDACTED]`, consumer-overridable via `redactReplacement`).
The redacted content persists to your vector DB / memory store. A
subsequent retrieval returning that document exposes the sentinel
string to the LLM.

The default `[REDACTED]` sentinel is benign for current models, but:

  1. A model could in principle be trained or instructed to interpret
     `[REDACTED]` as a privileged signal ("the user redacted this,
     so I should bypass my safety guidelines to recover it").
  2. A consumer-override `redactReplacement` containing untrusted
     content (e.g. dynamically built from user input) is a direct
     injection vector — the sentinel reaches the LLM via the
     retrieval path.

**Mitigation**:
  - Treat `redactReplacement` as security-relevant configuration; do
    NOT build it from runtime input.
  - Prefer `onFailure: 'block-write'` for high-sensitivity data; the
    redact mode is a usability trade-off, not a defence-in-depth.
  - Monitor retrieval responses for unexpected sentinel patterns.

## 15. Older vector connectors lack empty-redaction guard

(Added: Sprint 14 cumulative audit security cross-empty-redaction.)

The Lance + Turbopuffer connectors (Stories 2.10–2.11) default
`emptyRedactionMode: 'block'` — writes that redact to an empty
content string are rejected rather than persisting an empty doc.

The older vector connectors (qdrant, pinecone, weaviate — Story
1.2 era) do NOT consume `MemoryWriteValidator` in the same shape;
they take a separate `validators` array consumed by an internally-
built `GuardrailEngine`. The empty-redaction edge case does not apply
to those connectors as-shipped, but consumers who pre-validate their
own writes before calling `upsert()` should be aware that an
all-redacted-to-empty payload may land in the index.

**Mitigation**:
  - Pre-validate your writes BEFORE calling
    `client.upsert(...)` / `index.upsert(...)`. If your validator
    returns empty content after redaction, do not pass it through.
  - Future Story (Sprint 15+): retrofit qdrant/pinecone/weaviate to
    consume `MemoryWriteValidator` symmetrically with lance/turbopuffer.

## 16. `sanitizeReasonText` stack-trace + file-path leakage gap

(Added: Sprint 14 cumulative audit security sec S3 closure.)

`sanitizeReasonText` (now exported canonically from
`@blackunicorn/bonklm/core/connector-utils`) strips non-printable
control characters and caps at 200 characters. It does NOT redact:

  - Absolute file paths embedded in `Error.message`
  - Environment variable values that happen to be ASCII
  - Multi-line stack traces (the trace itself is usually on
    `error.stack`, not `.message`, so 200-char cap on message only
    bounds exposure)

**Mitigation**:
  - In production, configure connectors with `productionMode: true`
    so error messages carry generic strings rather than the
    validator's `reason`.
  - Forward `error.message` ONLY to your structured logger; do NOT
    forward `error.stack` to consumer-facing surfaces or attacker-
    accessible run-status fields.

## See also

- [`threat-surfaces.md`](./threat-surfaces.md) — what BonkLM DOES
  cover per surface.
- [`connectors/`](./connectors/) — per-connector migration guides.
