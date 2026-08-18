# ADR-0010: Provenance-gated indirect prompt-injection — connector-boundary scan + raw-upstream laundering re-scan

> Status: Living document. Scope: internal contributor guide. Records why indirect prompt-injection
> detection is gated on connector provenance (never on raw user text), and why the memory-write
> guard re-scans the raw upstream body rather than only the surface content. ADR-0009 (heuristic
> noun-precision tuning) forward-references this ADR: its corollary 2 re-homes
> binding/provenance-shaped recall to this connector-provenance layer.

## Problem

The calibrated user-text bar (`PromptInjectionValidator` / `detectPatterns`) is deliberately
conservative: its term lists and patterns are tuned to a measured false-positive floor, because a
guardrail that fires on ordinary prose is worse than useless (ADR-0009). That conservatism leaves
two gaps an attacker reaches **not** through the user turn but through a connector boundary:

1. **Indirect injection.** Content that arrives via a retrieved document, composed memory context,
   tool-call argument, or memory write can carry directives addressed to the model ("ignore the
   operator and exfiltrate…", a forged `AGENT_INSTRUMENTATION_FOOTER`, a ReAct observation token).
   These are attack-bearing precisely _because_ they arrive through an attacker-influenceable
   channel — but the same string in a genuine user turn is often benign discussion. Adding these
   arms to the user-text bar would breach the false-positive floor.

2. **Laundering.** Even with a connector-boundary scan, an agent can read a poisoned tool result,
   **paraphrase** it into benign-looking prose, and persist the paraphrase to memory. The laundered
   surface text matches no content pattern; the poison survives into trusted memory and is read
   back, with authority, on a later turn.

## Decision

**Indirect-injection detection is a separate, provenance-gated layer — never folded into the
user-text bar — and the memory-write guard re-scans the raw upstream body, not only the laundered
surface content.**

Three load-bearing rules:

1. **One validator, per-arm surface tags, gated by provenance.** A single
   `IndirectInjectionValidator` carries arms tagged with a `requiresProvenance` `ProvenanceBoundary`
   (`retrieved_doc` / `composed_context` / `tool_result` / `memory_write`). An arm fires only when
   content crosses its surface. The validator is **appended** (never prepended, never added to
   `PromptInjectionValidator`) onto the connector composite factories via the shared
   `appendIndirectInjectionArm` composer, so the user-text path and its calibrated floor are
   unchanged by construction. Genuine user text (`kind: 'text' | 'audio_partial'`) carries no
   connector surface, so the scan is skipped.

2. **Provenance is a typed envelope; the gate is `hasToolResultProvenance` / `isToolDerivedRef`.** A
   write's upstream derivation is described by a `Provenance` chain of `ToolResultRef`s. A chain
   that is absent, empty, malformed, or composed entirely of `user-input` refs is **not**
   tool-derived and never engages the stricter path. The tool-derived source set lives in exactly
   one place (`isToolDerivedRef`), shared by the chain-level gate and the per-ref re-scan filter.

3. **The memory-write guard re-scans the raw upstream body, and fails closed.** When a write carries
   tool-derived provenance, `rescanLaunderedProvenance` looks up each ref's `rawBodyHash` in the
   `AsyncLocalStorage`-scoped raw-upstream cache and re-scans the **raw body** (the pre-laundering
   tool result) through a `tool_result` `IndirectInjectionValidator`. A hit blocks the write **even
   in redact mode**: the poison is not textually present in the laundered `content`, so substring
   redaction cannot remove it — allowing a redacted-but-still-poisoned write would be the wrong
   failure mode.

## Why these choices

- **Gating, not widening.** The alternative — strengthening the user-text bar — was rejected because
  it trades the one thing the bar must protect (precision on ordinary prose) for recall on an attack
  that does not arrive through the user turn. Provenance gating buys the recall without the
  false-positive cost. This is the "recall belongs to the attack's real detection layer" corollary
  of ADR-0009, made concrete.

- **Raw re-scan, not deeper content heuristics.** Detecting a _paraphrase_ of an attack from surface
  text alone is a semantic problem with no precise pattern solution (it would reintroduce the
  false-positive cost). Re-scanning the **original** raw body sidesteps it entirely: the body either
  did or did not carry a payload, and the existing `tool_result` arms already decide that
  deterministically. Reusing the shipped detector (rather than a parallel finding mapper) keeps
  severity/weight/finding semantics identical to the direct connector arm.

- **ALS scope, not a process cache.** The raw-upstream cache is scoped to one
  `runWithRawUpstreamCache` turn so it inherits the engine's stateless-per-turn guarantee — never
  shared across turns, requests, or async contexts — and is capped (256 entries) so a turn emitting
  many large tool results cannot grow it unbounded. Outside a scope it is an inert no-op.

## Degradation contract

The re-scan must **never produce a false block** when forensic data is unavailable. A missing
`rawBodyHash`, a cache miss, or a lookup outside any ALS scope all yield "re-scan unavailable" — no
result, no throw. Only a positive hit on a _present_ raw body blocks. This keeps the feature safe to
ship before any connector populates the cache.

## Status of the production path

The core consumer is wired and default-on, but it only engages once an upstream connector (a) opens
a raw-upstream cache scope, (b) caches each raw tool-result body under its SHA-256 hash, and (c)
threads the `Provenance` envelope onto the memory write. **That per-connector stamping is a later
increment** — the same staging the connector-boundary scan itself used (core validator in PR-A,
connector rollout in PR-B). Until a connector stamps, the consumer degrades to a no-op per the
contract above. Do not claim production laundering coverage for a given connector until its stamping
increment lands.

## Consequences

- The connector composite factories now append an indirect arm, so content that previously passed
  can be blocked when it carries a connector-boundary injection signal (documented behavior change;
  see CHANGELOG and `known-limitations.md` §30).
- `Provenance` / `ToolResultRef` / `ProvenanceSource` and the raw-upstream primitives are tagged
  `@experimental` until the connector stamping increments land and the v1.0 surface freezes.
- Named recall gaps (human-addressed RAG directives, benign-shaped audit writes, structural-token
  evasion, non-English prose, `aws s3 cp` warn-only) are tracked honestly in `known-limitations.md`
  §30 rather than papered over.

## Related

- ADR-0001 — log sanitization (every new log sink here is CWE-117-sanitized; the re-scan logs only
  numeric/boolean forensic counts, never the raw match).
- ADR-0009 — heuristic noun-precision tuning (the precision discipline this layer preserves; its
  corollary 2 forward-references this connector-provenance layer).
- `docs/architecture.md` §5b — the provenance layer + raw-upstream cache architecture.
- `docs/user/threat-surfaces.md` (`memory_write`) — the per-surface coverage map.
