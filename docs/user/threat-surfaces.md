# BonkLM Threat Surfaces — Validator Coverage

BonkLM models LLM-application security as a set of **named surfaces** where attacker-influenced
content can enter or leave the model (7-surface taxonomy introduced in v0.4.0, locked at v1.0-RC1,
current release v1.0.0-rc.4). The 7-string `HookSurface` vocabulary is locked at
`packages/core/src/engine/GuardrailEngine.types.ts` and is the canonical taxonomy used by every
connector, hook, and OTel telemetry attribute (`bonklm.surface`).

This document maps each surface to the validators / guards / composite factories that BonkLM ships
to defend it.

## The 7 surfaces

| Surface            | What it is                                               | Composite validator                           | Connector wrap                                                                                          |
| ------------------ | -------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `text_input`       | Raw user prompt before model invocation                  | (use `PromptInjectionValidator` directly)     | `wrapAgent`, `wrapGenerateContent`, `createBonklmMiddleware({ scope: 'text_input' })`, `bonkMiddleware` |
| `text_output`      | Model response text before forwarding to the client      | (same validators, output direction)           | `wrapAgent.outputGuardrail`, stream-wrapper `wrapGenerate` / `wrapStream`                               |
| `tool_call`        | Function-call args + tool name the LLM picked            | `createToolCallArgsValidator` (Story 1.1)     | `wrapHandoff`, `defineToolInputGuardrail`, `wrapSigningAction`                                          |
| `retrieved_doc`    | RAG / vector-DB hits flowing into the prompt             | `createRetrievedDocValidator` (Story 1.2)     | 4-connector retrofit (pinecone, qdrant, weaviate, chroma); `withRetrieverGuardrails` (langchain)        |
| `memory_write`     | Agent-internal memory inserts (Mem0 / Zep / DO setState) | `createMemoryWriteValidator` (Story 1.3)      | `installSealedWrapMemory` (elizaos)                                                                     |
| `composed_context` | Concatenated recall blob assembled BEFORE LLM call       | `createComposedContextValidator` (Story 1.3a) | (auto-wires at recall paths in memory connectors)                                                       |
| `audio_partial`    | Streaming audio frames / transcription partials          | (Story 3.1 — not yet shipped)                 | `wrapRealtime.inputTranscription` partial coverage                                                      |

## Validator coverage per surface

### `text_input` / `text_output`

Direct validators apply to text on these surfaces. Ship the chain that matches your threat model:

- **`PromptInjectionValidator`** — pattern engine with system-override, role-hijacking,
  instruction-injection, encoded-payload, and context-manipulation categories. Includes Story 1.1c's
  `web3_preference_setting` WARN-only category (does NOT auto-block; consumed by the elizaos
  two-condition gate).
- **`JailbreakValidator`** — jailbreak detection (DAN / Anthropic basic-jailbreak patterns).
- **`SecretGuard`** — credential exfiltration (OpenAI, Anthropic, AWS, Stripe, GitHub, Slack
  patterns). Implements `RedactingValidator`.
- **`PIIGuard`** — PII detection (US SSN, EU IBAN, UK NINO, ABA routing, etc.). Implements
  `RedactingValidator`.
- **`BashSafetyGuard`** — `curl|bash` patterns, SQL injection in shell context, dangerous `rm -rf`,
  command substitution.
- **`XSSGuard`** — `<script>` / `javascript:` / `onerror=` / iframe `srcdoc` payloads.
- **`MultilingualDetector`** — FR/DE/ES/PT/IT/ZH/JA/KO/RU/AR patterns. See known-limitations.md for
  the regex-not-ML caveat.

### `tool_call`

`createToolCallArgsValidator({ validators })` walks the args tree (Map, Set, Buffer, URL, Date,
plain objects + arrays) with WeakSet cycle protection, scans every string leaf AND the tool name
through the supplied validator chain. Tool name is humanised (`disable_safety_filter` →
`disable safety filter`) so natural-language patterns match snake_case / camelCase / kebab-case /
dot.separated names.

### Inbound tool results (`tool_result` provenance)

The result a tool / action returns to the agent is itself an attacker-influenceable surface — a
remote MCP server, a document a tool fetched, or a compromised upstream agent can plant a
task-hijack / exfil directive in the returned text. The shared `appendToolResultInjectionArm` helper
composes the provenance-gated `IndirectInjectionValidator({ surface: 'tool_result' })` onto a
connector's validator chain, **default-on**, on top of the caller's own validators. The arm is
scoped to the result path: it never fires `tool_result`-surface patterns on ordinary model output or
on tool-call args.

Connectors that ship the default-on inbound scan: `mcp` (`callTool` result; deep non-text leaf
extraction + binary-blob policy — see known-limitations.md §30), `mastra` (`validateToolResult`),
`copilotkit` (`validateActionResult`), and `openai-agents` (`defineToolOutputGuardrail`). Tool-call
**args** additionally gain the same arm via `createToolCallArgsValidator` (openai-agents, elizaos).

> **Inbound tool _results_ (distinct from `tool_call`).** `tool_call` above covers the OUTGOING args
> the LLM picked. The INBOUND result a tool returns is a separate provenance boundary
> (`tool_result`). The MCP connector's `createGuardedMCP` scans inbound results on that boundary
> with an `IndirectInjectionValidator({ surface: 'tool_result' })` (default-on when
> `validateToolResults` is enabled). It extracts **every scannable text leaf** — top-level `text`
> items, `resource.text` / `resource.uri`, and recursively-collected string leaves of embedded
> structured content — and scans the joined view, a separator-free concatenation (cross-item split
> defence), and each leaf independently. Binary/base64 blobs (`image` / `audio` `data`,
> `resource.blob`) are opaque by default (`decodeBinaryContent: true` to bounded-decode and scan
> them; otherwise an uninspectable-channel `warn` is emitted). This is connector-asserted (not a
> stamped `Provenance` envelope) and currently wired in the MCP connector only — see the MCP entry
> in [`known-limitations.md`](./known-limitations.md) §30. `tool_result` is a provenance boundary,
> not one of the 7 locked `HookSurface` strings.
>
> **Reduced-channel telemetry (`mastra` / `copilotkit`).** These connectors scan the text their SDK
> surfaces, so a non-text content part their message reducer collapses to a placeholder (mastra
> `image_url` → `[Image]`; copilotkit `image` → `[Image]` and `data` → `[Data]`) or drops (an
> unrecognized part `type`) is **not** scanned by the arm. To avoid a silent pass the reducer
> tallies every such part and the connector emits a `warn` with a sanitized reduced-kind count +
> list — the same "never a silent pass" posture as the MCP uninspectable-blob signal, emitted as a
> single `warn` per reducer call (no `debug`-downgrade, since the placeholder leaves the channel
> wholly uninspected). Telemetry only — not a block.

### `retrieved_doc`

`createRetrievedDocValidator({ validators, onPerDocFailure })` runs the validator chain over each
doc in a batch. Three failure modes:

- `'drop'` (default): drop flagged docs, keep clean ones.
- `'block-all'`: single flagged doc terminates the entire batch.
- `'redact'`: substring-replace flagged regions with `[REDACTED]` (uses
  `RedactingValidator.redactContent` when available).

Connectors that ship the opt-in: `pinecone`, `qdrant`, `weaviate`, `chroma`. Langchain uses
`withRetrieverGuardrails(retriever)`.

### `memory_write`

`createMemoryWriteValidator` validates before any persistence. Returns both the validation result +
the (possibly redacted) payload so connectors can persist the redacted form. Result `metadata`
carries `memorySessionId` and `userId` for audit-trail correlation.

ElizaOS connector ships the sealed `wrapMemory` defence (Story 1.8) on top of this —
`Object.defineProperty` with `writable: false`, closure-captured source-trust, verified-publisher
allowlist, and the `metadata.bonklmTrust` marker.

**Home-E laundering re-scan (provenance-gated).** Beyond scanning the write's surface `content`, the
validator re-scans the **raw upstream body** behind `metadata.provenance` — the original tool result
the content derives from, looked up by `rawBodyHash` from the per-turn `runWithRawUpstreamCache`
scope. This catches the laundering chain where an agent paraphrases a poisoned tool result into
benign prose before persisting it: the laundered surface text matches no indirect-injection content
pattern, but the raw body still does. The re-scan is gated on tool-derived provenance (never engages
on genuine user writes), fails closed on a hit (redact cannot remove poison that isn't textually in
`content`), and degrades to a no-op until an upstream connector stamps the envelope + caches the raw
body (a per-connector follow-up increment). Re-scan findings have their `match` redacted before they
reach the result — the raw body may carry secrets/PII the laundered `content` never exposed — and
the scan is byte-bounded per body with a per-chain fan-out cap.

### `composed_context`

`createComposedContextValidator` defends the **wake-up attack** class where individual memory
entries are benign but the concatenated recall blob (assembled BEFORE the LLM call) reconstitutes an
injection. Caps: soft 32KB (warns), hard 200KB (truncates newest-first). Scans the forward AND
reverse concatenation so attacks split across entries are caught in both orderings.

### `audio_partial`

Phase-1 connectors validate the transcription text (`input_audio_transcription.completed` in
openai-agents Realtime; the `inputTranscription` callback in google-genai Live API). Raw PCM binary
frames are NOT scanned — that's the Story 3.1 Audio Stream Validator (deferred).

## Cross-surface guard composition

Engines accept a unified validator + guard chain. Multiple surfaces share the same `GuardrailEngine`
instance — the engine merges per-validator `metadata` into the aggregate result on
`aggregateResults` with documented last-writer-wins on key collision. Use namespace-prefixed keys
(`memoryWrite.*`, `composedContext.*`, ...) in custom validators.

## See also

- [`known-limitations.md`](./known-limitations.md) — what BonkLM does NOT catch, why, and the
  planned path forward.
- [`connectors/`](./connectors/) — per-connector usage recipes and migration guides.
