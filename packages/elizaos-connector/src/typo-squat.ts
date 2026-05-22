/**
 * Story 2.1b-connectors — Levenshtein typo-squat detection
 * ========================================================
 *
 * Iter-2 architect BLOCK-1 + iteration-3 plan: plugin-name typo-squat
 * defence with Levenshtein distance ≤ 2 against
 * {@link VERIFIED_PUBLISHER_ALLOWLIST}. Catches `@elizaos/plugin-solanа`
 * (Cyrillic `а` U+0430), `@elizaos/plugin-soIana` (capital-I-for-l),
 * `@elizaos/plugin-solanaa` (trailing dup), etc.
 *
 * The check is ADDITIVE to the exact-match check from Phase-1:
 *   - Exact match → trusted (no further check).
 *   - Distance ≤ 2 to ANY allowlist entry AND not exact-match → typo-squat.
 *   - Distance > 2 → unknown plugin (no allowlist hit).
 *
 * The wrap-memory closure's Provider-source 'messages' write check
 * uses this: a memory write whose caller plugin is typo-squat-similar
 * to an allowlisted name is REFUSED with a CRITICAL finding,
 * preventing a hostile plugin from impersonating `@elizaos/plugin-solana`
 * via `@elizaos/plugin-solanа`.
 *
 * Performance: O(N × M × L²) where N=plugin count, M=allowlist size
 * (currently 6), L=name length (typically ~25 chars). For the per-call
 * audit path, M+L are tiny — well under 100µs per check.
 *
 * @package @blackunicorn/bonklm-elizaos
 */
import { VERIFIED_PUBLISHER_ALLOWLIST } from './types.js';

/**
 * Wagner-Fischer Levenshtein distance. Returns the minimum number of
 * single-character edits (insertions, deletions, substitutions)
 * required to transform `a` into `b`.
 *
 * Standard implementation; O(|a| × |b|) time + space. The caller
 * uses small strings (~25 chars) so this is comfortably under 1ms.
 */
export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Use two rows instead of full matrix for slightly tighter memory.
  let prev = new Array(b.length + 1);
  let curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1, // insertion
        prev[j] + 1, // deletion
        prev[j - 1] + cost // substitution
      );
    }
    // Swap rows.
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }
  return prev[b.length];
}

/**
 * Result of a typo-squat detection for a single plugin name.
 */
export interface TypoSquatResult {
  /** The plugin name that was checked. */
  pluginName: string;
  /** True when the name exactly matches an allowlist entry. */
  exactMatch: boolean;
  /**
   * The closest allowlist entry within distance ≤ 2 that is NOT an
   * exact match, or `undefined` when no near-miss was found.
   *
   * When `nearestTypoSquat` is defined, the caller should treat the
   * plugin as a typo-squat against `nearestTypoSquat.target` and
   * refuse Provider-source 'messages' writes from it.
   */
  nearestTypoSquat?: {
    /** The allowlist entry the plugin is close to. */
    target: string;
    /** The Levenshtein distance (1 or 2). */
    distance: number;
  };
}

/**
 * Normalise a plugin name for typo-squat comparison.
 *
 * Iter-1 security BLOCK-4: raw JS strings are UTF-16 code units; a
 * zero-width space (U+200B) or other invisible code point inserted
 * into a plugin name produces a high edit distance while rendering
 * identically to the human eye. Homoglyph attacks via composed-vs-
 * decomposed Unicode forms similarly inflate distance past 2.
 *
 * Mitigation: strip Unicode format characters (`\p{Cf}` — includes
 * zero-width space, zero-width joiner, byte-order mark, etc.) then
 * apply NFKC normalisation (collapses fullwidth Latin / superscripts /
 * compatibility-equivalent characters AND canonical-decomposes-then-
 * recomposes accented characters). Cyrillic and other native-script
 * confusables remain detectable because NFKC does NOT fold them to
 * Latin equivalents — those need Unicode confusables data, out of
 * scope for the connector. The Cyrillic-a case is caught at
 * distance-1 already.
 *
 * Caller-facing `pluginName` in the return value preserves the
 * ORIGINAL string so error messages name the attacker's actual input.
 */
function normaliseForTypoSquat(name: string): string {
  return name.replace(/\p{Cf}/gu, '').normalize('NFKC');
}

/**
 * Check a single plugin name against the verified-publisher allowlist.
 *
 * Returns `exactMatch=true` for trusted plugins, `nearestTypoSquat`
 * for typo-squat candidates (distance ≤ 2 and not exact-match), or
 * neither for unknown plugins (distance > 2 from every entry).
 *
 * BOTH `pluginName` AND each allowlist entry are normalised via
 * `normaliseForTypoSquat` before comparison so invisible-character
 * + compatibility-equivalent attacks cannot defeat the distance check.
 */
export function detectTypoSquat(
  pluginName: string,
  allowlist: ReadonlyArray<string> = VERIFIED_PUBLISHER_ALLOWLIST
): TypoSquatResult {
  const normalisedName = normaliseForTypoSquat(pluginName);
  // Exact-match check uses normalised forms — a name that looks
  // identical to an allowlist entry but contains a zero-width char
  // would otherwise miss exact-match AND fall to the typo-squat
  // branch. After normalisation, it correctly hits exact-match.
  for (const candidate of allowlist) {
    if (normaliseForTypoSquat(candidate) === normalisedName) {
      return { pluginName, exactMatch: true };
    }
  }
  let nearest: { target: string; distance: number } | undefined;
  for (const candidate of allowlist) {
    const distance = levenshteinDistance(normalisedName, normaliseForTypoSquat(candidate));
    if (distance > 0 && distance <= 2) {
      if (nearest === undefined || distance < nearest.distance) {
        nearest = { target: candidate, distance };
      }
    }
  }
  return {
    pluginName,
    exactMatch: false,
    nearestTypoSquat: nearest,
  };
}

/**
 * Batch variant: check every plugin in a list and return only the
 * typo-squat candidates. Exact-matches and unknown-distant plugins
 * are filtered out — the caller's audit pipeline reports the
 * unknown-distant ones via the existing `plugin_not_in_allowlist`
 * MEDIUM finding from Phase-1.
 */
export function detectTypoSquatBatch(
  pluginNames: ReadonlyArray<string>,
  allowlist: ReadonlyArray<string> = VERIFIED_PUBLISHER_ALLOWLIST
): TypoSquatResult[] {
  return pluginNames
    .map((name) => detectTypoSquat(name, allowlist))
    .filter((r) => r.nearestTypoSquat !== undefined);
}
