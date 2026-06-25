/**
 * Provenance laundering re-scan — D-065 §7-step-2.c PR-C
 * =====================================================
 * The consumer that makes the PR-A forward primitives ({@link Provenance} +
 * the raw-upstream cache) live. It closes the **Home-E laundering** gap that
 * the direct connector-boundary scan (PR-B) cannot see in production:
 *
 *   1. An agent calls an MCP tool; the tool returns a poisoned body carrying an
 *      indirect-injection payload.
 *   2. The connector scans the RAW body (PR-B `tool_result` arm) and the agent
 *      **paraphrases** it into benign-looking prose — the laundered surface text
 *      no longer matches any content pattern.
 *   3. The agent writes that laundered prose to memory. A content-only guard sees
 *      clean text and admits the write — persisting an attacker instruction that
 *      a later turn will read back as trusted memory.
 *
 * PR-C re-scans the **raw upstream body** (looked up by `rawBodyHash` from the
 * per-turn `runWithRawUpstreamCache` ALS scope) rather than the laundered
 * `content`. A blocking hit on the raw body blocks the laundered write even
 * though the surface text is clean.
 *
 * Design invariants:
 *  - **Gated on provenance, never on user text.** When the write carries no
 *    tool-derived provenance ({@link hasToolResultProvenance} is false), the
 *    re-scan is a no-op — genuine user turns are never re-scanned, preserving
 *    the calibrated `PromptInjectionValidator` false-positive floor.
 *  - **Degrades cleanly.** A missing `rawBodyHash`, a cache miss, or running
 *    outside an ALS scope yields "re-scan unavailable" (no result, no throw),
 *    never a false block. Only a positive BLOCKING hit on a present raw body
 *    blocks; a warn-only finding never fails the write closed (only `blocked`
 *    results are returned).
 *  - **Bounded work.** Each raw body is scanned only up to {@link MAX_RESCAN_BYTES};
 *    at most {@link MAX_RESCAN_REFS} distinct bodies per chain are re-scanned; and
 *    at most {@link MAX_RESCAN_CHAIN} refs are examined (the chain rides on untrusted
 *    `metadata`, so its length is bounded too). No pathological chain or oversized
 *    cached body can turn one memory write into unbounded synchronous work. Hitting
 *    any bound degrades to "re-scan unavailable" for the excess (fail-safe to baseline).
 *  - **No raw egress.** The raw upstream body may carry secrets/PII; a finding's
 *    `match` is a substring of that body. Re-scan findings are returned with
 *    `match` REDACTED so the raw bytes never reach the memory-write caller's
 *    result surface (which never carried raw-upstream bytes before PR-C). The
 *    laundered `content` does not contain the match anyway, so the caller loses
 *    nothing actionable.
 *  - **Reuses the shipped detector.** Each raw body is run through one shared,
 *    stateless {@link IndirectInjectionValidator} bound to the `tool_result`
 *    surface, so severity/weight/finding semantics stay identical to the direct
 *    connector arm — no parallel finding-mapping to drift.
 *  - **Tool-derived refs only.** Within a mixed chain, only tool-derived refs are
 *    re-scanned; a `user-input` ref's body is never re-scanned even if hashed.
 *
 * This module depends on the Node-only ALS raw-upstream cache. It is not a named
 * `/edge` export; on a Node-compatible edge runtime it is transitively reachable
 * through `createMemoryWriteValidator` (see `docs/architecture.md` §6).
 *
 * @package @blackunicorn/bonklm/core
 */
import type { Finding, GuardrailResult } from '../base/GuardrailResult.js';
import type { Provenance } from './provenance.js';
import { hasToolResultProvenance, isToolDerivedRef } from './provenance.js';
import { getRawUpstream } from './raw-upstream-cache.js';
import { IndirectInjectionValidator } from './indirect-injection.js';

/**
 * One shared, stateless scanner for the `tool_result` surface. The validator
 * holds no per-call state (its scan is a pure regex pass), so a single instance
 * is safe to reuse across every re-scan — mirroring how the connector factories
 * compose a single arm rather than one per leaf.
 */
const RAW_UPSTREAM_SCANNER = new IndirectInjectionValidator({ surface: 'tool_result' });

/** Max bytes of a single raw upstream body scanned (amplification bound). */
const MAX_RESCAN_BYTES = 65_536;

/** Max distinct raw bodies re-scanned per chain (fan-out bound). */
const MAX_RESCAN_REFS = 64;

/**
 * Max refs EXAMINED per chain (traversal bound). `derivedFrom` rides on
 * caller-supplied `metadata`, so its length is untrusted; without this the loop
 * would walk an attacker-padded chain in full even when every ref is skipped
 * (no hash / cache miss / dedup). Refs beyond this bound are not examined — a
 * payload past it degrades to the no-op baseline, never a false block.
 */
const MAX_RESCAN_CHAIN = 256;

/**
 * Replacement for a re-scan finding's `match`. The raw value is a substring of
 * the raw upstream body (potential secret/PII); it is redacted before the
 * finding leaves this module.
 */
export const RAW_UPSTREAM_MATCH_REDACTED = '[raw-upstream-match-redacted]';

/** Outcome of a provenance laundering re-scan. */
export interface ProvenanceRescanResult {
  /**
   * Per-raw-body results that BLOCKED the laundered write (match-redacted). Empty
   * when nothing blocked, the write carried no tool-derived provenance, or no raw
   * body was available to re-scan.
   */
  results: GuardrailResult[];
  /** Count of distinct raw upstream bodies actually looked up and re-scanned. */
  scanned: number;
}

/** Return a copy of `result` with every finding's raw `match` redacted. */
function redactMatches(result: GuardrailResult): GuardrailResult {
  const findings: Finding[] = result.findings.map(f => ({ ...f, match: RAW_UPSTREAM_MATCH_REDACTED }));
  return { ...result, findings };
}

/**
 * Re-scan the raw upstream bodies behind a write's {@link Provenance} chain for
 * indirect-injection payloads the laundered surface content hides.
 *
 * For each tool-derived ref in `provenance.derivedFrom` that carries a
 * `rawBodyHash` whose body is present in the active `runWithRawUpstreamCache`
 * scope, the raw body (capped at {@link MAX_RESCAN_BYTES}) is run through the
 * shared `tool_result` scanner. Only BLOCKING results are returned, match-redacted,
 * for the caller to merge into its own verdict.
 *
 * @param provenance - The write's upstream-derivation envelope (typically
 *   `MemoryWritePayload.metadata.provenance`). Absent / non-tool-derived chains
 *   short-circuit to an empty result.
 * @returns The blocking per-body results plus the count of bodies re-scanned.
 */
export function rescanLaunderedProvenance(provenance?: Provenance): ProvenanceRescanResult {
  // Gate: never re-scan genuine user text or an empty/malformed chain.
  const chain = provenance?.derivedFrom;
  if (!hasToolResultProvenance(provenance) || !Array.isArray(chain)) {
    return { results: [], scanned: 0 };
  }

  const results: GuardrailResult[] = [];
  const seenHashes = new Set<string>();
  let scanned = 0;

  // Bound traversal of the untrusted chain (not just distinct scans), so a
  // pathological all-skip chain cannot spin the loop unboundedly.
  const refs = chain.length > MAX_RESCAN_CHAIN ? chain.slice(0, MAX_RESCAN_CHAIN) : chain;
  for (const ref of refs) {
    if (scanned >= MAX_RESCAN_REFS) break;
    // Only tool-derived refs carrying a raw-body lookup key are re-scannable.
    if (!isToolDerivedRef(ref)) continue;
    const hash = ref.rawBodyHash;
    if (hash === undefined || seenHashes.has(hash)) continue;
    seenHashes.add(hash);

    // Cache miss / outside-scope / connector-never-stamped → re-scan unavailable.
    // Degrade cleanly: no body to inspect is NOT a positive, never a false block.
    const rawBody = getRawUpstream(hash);
    if (rawBody === undefined) continue;

    scanned += 1;
    const scanBody = rawBody.length > MAX_RESCAN_BYTES ? rawBody.slice(0, MAX_RESCAN_BYTES) : rawBody;
    const result = RAW_UPSTREAM_SCANNER.validate(scanBody);
    // Only a BLOCKING hit fails the write closed; a warn-only finding does not.
    if (result.blocked) {
      results.push(redactMatches(result));
    }
  }

  return { results, scanned };
}
