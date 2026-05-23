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

## 17. Mistral streaming output is NOT post-validated

(Added: Sprint 15 Story 2.12 audit sec S3 / rev R1#5 closure.)

`@blackunicorn/bonklm-mistral` pre-validates inputs on
`chat.stream` / `agents.stream` / `fim.stream` but returns the
underlying `ReadableStream` unchanged. The streamed output content
is NOT scanned chunk-by-chunk by the connector — consumers wanting
output validation on streams must accumulate chunks + call
`engine.validate(accumulated)` themselves.

**Mitigation**:
  - Prefer `*.complete` (non-streaming) for high-sensitivity
    workloads.
  - For streaming: consume the stream, accumulate chunks into a
    buffer, periodically call `engine.validate(buffer)` (e.g. every
    256 chars or on punctuation boundaries), and tear down the
    stream + render a generic error if BLOCK fires mid-stream.
  - This pattern is well-trodden in the OpenAI connector + the
    `BufferedReleaseGate` primitive (`packages/core/src/connector-utils/buffered-release-gate.ts`).

## 18. Mistral multi-turn assistant-message bypass (default mode)

(Added: Sprint 15 Story 2.12 audit sec S1 closure.)

By default `wrapMistral` validates only `role === 'user'` messages.
Multi-turn deployments where assistant history is attacker-
influenced (RAG-retrieved chat history fed back as `assistant`
messages, vector-store memory poisoning, repeated prior-turn
feed-in) bypass the user-only validator entirely.

**Mitigation**:
  - Pass `validateAllMessages: true` to `wrapMistral` to validate
    every message regardless of role. Costs one extra validate per
    non-user message in the request.
  - Alternatively: pre-validate untrusted history BEFORE assembling
    the chat request, with stronger surface-specific validators
    (e.g. `RetrievedDocValidator` for RAG-injected history).

## 19. Mistral image-encoded injection bypass (multimodal)

(Added: Sprint 15 Story 2.12 audit sec S2 closure.)

The Mistral connector's `extractMessageText` walks structured
content arrays and extracts only `{type: 'text', text}` parts.
`{type: 'image_url', ...}` parts are silently dropped from
validator inspection.

An attacker who embeds an OCR-readable prompt-injection payload
inside an image URL (Mistral Vision / `pixtral-*` models) bypasses
the validator entirely.

**Mitigation**:
  - Pre-OCR your image inputs upstream of `wrapMistral` and
    validate the extracted text via `engine.validate(...)` before
    submitting the image URL.
  - Future story (Epic 3+) may add OCR-pre-screening to the
    connector; not in v0.4 scope.

## 20. Mistral `classifiers.moderate` consumer-intent inversion

(Added: Sprint 15 Story 2.12 audit sec S4 closure.)

When a consumer calls `guarded.classifiers.moderate(attackerContent)`
to DISCOVER whether the content is harmful, the BonkLM validator
pipeline runs on the input FIRST and may BLOCK it before Mistral's
own moderation classifier sees it. The block is technically
correct per the validator's logic but behaviorally inverts the
consumer's intent (they WANTED Mistral to judge the content).

**Mitigation**:
  - For moderation-pipeline use cases on adversarial corpora, set
    `validateInputs: false` on the `wrapMistral` options, AND wire
    a separate engine instance for moderation-pipeline calls that
    omits the prompt-injection validators.
  - For LLM-chat use cases (the common case), the default
    behavior is correct — the consumer is not running moderation
    pipelines through the same wrapped client.

## 21. `engine.onIntercept` does NOT fire on Lance/Turbopuffer write-path BLOCKs

(Added: v0.5.0 pre-publish audit sec v5#15 closure.)

The `engine.notifyCachedResult(...)` bridge is fired by the vector-DB
connectors (`@blackunicorn/bonklm-lance`,
`@blackunicorn/bonklm-turbopuffer`) on **read-path ALLOW** outcomes
only. On the **write-path BLOCK** path, the connector throws
`ConnectorValidationError` synchronously, interrupting the call
stack before any notify call can fire.

This means a consumer who wires
`engine.onIntercept(attackLogger)` will receive callbacks for:

  - Inngest validateInput/Output/ToolArgs results (cachedValidate-driven).
  - Trigger.dev validateInput/Output/ToolArgs results (cachedValidate-driven).
  - Mistral chat/agents/fim completion validations (synchronous + notify).
  - Lance/Turbopuffer query/.toArray retrieved-doc batch ALLOWs.
  - Stagehand/Eko `engine.validateInput` paths (fires inline).

But will NOT receive callbacks for:

  - Lance `add(records)` per-row BLOCK.
  - Lance `update({values: ...})` BLOCK.
  - Lance `mergeInsert(...).execute(records)` per-row BLOCK.
  - Turbopuffer `write({upsert_rows: ...})` per-row BLOCK.
  - Turbopuffer `write({patch_rows: ...})` per-row BLOCK.

The thrown `ConnectorValidationError` is the audit signal for write
BLOCKs — consumers wanting telemetry on write paths should wrap
their connector calls with a try/catch + a custom logger inside
the catch block, OR pass a structured `logger` to the connector
options (which receives warn/error events for the boundary
conditions only, not per-validator findings).

**Architectural rationale**: write-path BLOCKs interrupt the call
stack synchronously to prevent partial-write state. Firing a
post-throw notify would require a try/catch wrapper around every
validator call that swallows the throw to fire the callback then
re-throws. The asymmetry is a deliberate design trade-off; a
future revision (Sprint 16+) may add an opt-in
`notifyOnBlockedWrites: true` flag.

## 22. AudioStreamValidator partial path is ASCII-fold only

`AudioStreamValidator.validatePartial` (Story 3.1, Sprint 16) folds
uppercase ASCII A-Z to lowercase via a `code | 0x20` bit-twiddle at
step time — there is no NFKD normalisation, no homoglyph mapping, and
no `.toLowerCase()` call on the released text span. This is the price
of the zero-allocation hot-path contract (AC-c): the validator must
return in <100ms on a 1KB partial transcript and never allocate
intermediate strings.

**Consequence**: Cyrillic-confusable attacks (`іgnore`, U+0456 Latin-
looking `i`), mixed-script bypasses, and zero-width-char splits
against the curated needle set bypass `validatePartial` and produce
`earlyBlock: false`. The `partialCoverageOnly: true` field on
`AudioStreamPartialResult` flags this explicitly — connector authors
who gate the LLM call on `earlyBlock` alone produce false negatives
for the homoglyph / mixed-script class.

**Mitigation**: `validateFinal` runs the full validator stack
(defaults to `PromptInjectionValidator`, which applies NFKD +
homoglyph normalisation per the cumulative-audit pass 1 fix). Always
call `validateFinal` on stream close — never rely on partial-path
clean signals to bypass the final pass.

## 23. AudioStreamValidator one-instance-per-session requirement

`AudioStreamValidator` carries mutable session state — the
`earlyBlock` flag, the AC automaton's position pointer, and the
`BufferedReleaseGate`'s pending buffer. Sharing one instance across
concurrent voice sessions WILL produce cross-session state leakage:
session A's partial transcript can advance the automaton state that
session B's next `validatePartial` reads, and `getSignalEarlyBlock`
called from one session resets the flag for all sessions sharing the
instance.

**Mitigation**: use `validator.fork()` to clone a pre-configured
factory into a fresh stateful instance per session, OR construct a
new `AudioStreamValidator` per session from the same config object.
The pattern set + AC trie are rebuilt from the config; only session
state is isolated. `await using validator = ...` (via
`Symbol.asyncDispose`) clears session state on scope exit.

This requirement is documented prominently in the class JSDoc; the
`fork()` factory exists specifically to make the per-session pattern
ergonomic for LiveKit / Vapi / Retell connectors (Sprint 16+).

## See also

- [`threat-surfaces.md`](./threat-surfaces.md) — what BonkLM DOES
  cover per surface.
- [`connectors/`](./connectors/) — per-connector migration guides.
