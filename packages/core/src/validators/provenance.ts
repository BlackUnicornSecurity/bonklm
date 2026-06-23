/**
 * Provenance contract — D-065 §7-step-2.b PR-A
 * ============================================
 * Wire-format envelope describing where a piece of content came from, so a
 * connector-boundary validator can apply a stricter, provenance-gated pattern
 * set (see {@link IndirectInjectionValidator}) WITHOUT widening the user-text
 * bar (`PromptInjectionValidator`) and its calibrated false-positive floor.
 *
 * The envelope is plain JSON, additive (no breaking change to
 * `MemoryWritePayload.metadata` or `ToolCallResult`), and survives JSON-RPC /
 * MCP transport hops. It is POPULATED by the connector packages
 * (`mcp-connector` stamps it on each `ToolCallResult` — PR-B; `memory-utils`
 * threads it through `metadata.provenance` — PR-C). PR-A only defines the
 * contract and the core-side consumer.
 *
 * `ProvenanceBoundary` is the coarse SURFACE tag a pattern arm gates on
 * (`PatternDefinition.requiresProvenance`); `ToolResultRef.source` is the
 * finer wire-level origin used by the Home-E laundering detector (PR-C).
 */

/**
 * The connector surface a provenance-gated pattern arm fires on. An arm tagged
 * with one of these values only fires when the content arrives through that
 * boundary — never on raw user text (`PromptInjectionValidator`).
 */
export type ProvenanceBoundary = 'retrieved_doc' | 'composed_context' | 'tool_result' | 'memory_write';

/**
 * The wire-level origin of an upstream content chunk. `user-input` is the
 * genuine user turn (NOT tool-derived); the other three are
 * attacker-influenceable indirect channels.
 */
export type ProvenanceSource = 'mcp-tool-result' | 'http-fetch' | 'agent-paraphrase' | 'user-input';

/**
 * One link in the upstream derivation chain. Ordered most-recent-first inside
 * {@link Provenance.derivedFrom}.
 */
export interface ToolResultRef {
  source: ProvenanceSource;
  /** Tool name when `source === 'mcp-tool-result'`. */
  tool?: string;
  /** Origin URL when `source === 'http-fetch'`. */
  sourceUrl?: string;
  /** SHA-256 lookup key into the ALS-scoped RawUpstreamCache (PR-B/PR-C). */
  rawBodyHash?: string;
  /** Verdict the upstream connector validator already returned for this ref. */
  upstreamValidatorVerdict?: 'allowed' | 'blocked' | 'redacted';
  /** Sanitizer build that processed this ref (forensic correlation). */
  sanitizerVersion?: string;
}

/**
 * Provenance envelope carried on `MemoryWritePayload.metadata.provenance`
 * (memory-utils) and on `ToolCallResult` (mcp-connector).
 */
export interface Provenance {
  /** Ordered upstream chain, most-recent first. */
  derivedFrom: ToolResultRef[];
}

/** Sources that represent indirect, attacker-influenceable channels. */
const TOOL_DERIVED_SOURCES: ReadonlySet<ProvenanceSource> = new Set<ProvenanceSource>([
  'mcp-tool-result',
  'http-fetch',
  'agent-paraphrase'
]);

/**
 * True when the provenance chain carries at least one tool-derived (indirect)
 * ref. A chain that is empty, absent, malformed, or composed entirely of
 * `user-input` refs returns `false` — the laundering / indirect-injection
 * guards must NOT engage on genuine user text.
 */
export function hasToolResultProvenance(provenance?: Provenance): boolean {
  if (!provenance || !Array.isArray(provenance.derivedFrom)) {
    return false;
  }
  return provenance.derivedFrom.some(ref => ref !== null && ref !== undefined && TOOL_DERIVED_SOURCES.has(ref.source));
}
