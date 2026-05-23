/**
 * Sprint 17 / Story 3.12 Pass 2 — RTL bidi-control attack guard
 * ==============================================================
 *
 * Defeats Unicode-bidi-override attacks where an attacker embeds
 * U+202A-202E or U+2066-2069 inside a string so the visual rendering
 * looks benign while the logical-order bytes carry an injection
 * payload.
 *
 * Stripped code points (range-inclusive):
 *   - U+202A LEFT-TO-RIGHT EMBEDDING (LRE)
 *   - U+202B RIGHT-TO-LEFT EMBEDDING (RLE)
 *   - U+202C POP DIRECTIONAL FORMATTING (PDF)
 *   - U+202D LEFT-TO-RIGHT OVERRIDE (LRO)
 *   - U+202E RIGHT-TO-LEFT OVERRIDE (RLO)
 *   - U+2066 LEFT-TO-RIGHT ISOLATE (LRI)
 *   - U+2067 RIGHT-TO-LEFT ISOLATE (RLI)
 *   - U+2068 FIRST STRONG ISOLATE (FSI)
 *   - U+2069 POP DIRECTIONAL ISOLATE (PDI)
 *
 * Why module-internal (not exported from the main barrel):
 * connector authors don't need this primitive; it's a
 * validator-internal preprocessing step. Exposed via
 * `MultilingualDetector` + future RTL-aware validators only.
 */

/**
 * Regex matching bidi-control code points. Sprint 17 audit closure
 * (security CONCERN-1): extended to include U+200E LEFT-TO-RIGHT MARK,
 * U+200F RIGHT-TO-LEFT MARK, and U+061C ARABIC LETTER MARK. These are
 * direction-indicator (not override) characters but can still be used
 * to hide injection text from direction-aware code-paths.
 *
 * **Stateless** — non-global flag intentionally: `.replace` without
 * the `g` flag would only replace the first match. The character class
 * + `.replace` with a non-global regex would be wrong; we want all-
 * matches replaced. So use `g` flag, but call `.replace` ONLY (drop
 * the `.test` fast-path to avoid the lastIndex footgun — Sprint 17
 * audit closure architect C-1 + code-reviewer CONCERN-2 + security N-1).
 *
 * `.replace` on a global regex always starts from index 0 and never
 * leaves residual state, so concurrency is safe.
 */
const BIDI_CONTROL_RE = /[؜‎‏‪-‮⁦-⁩]/g;

/**
 * Remove all bidi-control code points from the input.
 */
export function stripBidiControls(input: string): string {
  return input.replace(BIDI_CONTROL_RE, '');
}

/**
 * Full multilingual-match normalisation: strip bidi controls + NFKD
 * Unicode normalisation + ASCII lowercase. NFKD is the
 * decompose-then-compatibility form which separates combining marks
 * from base characters — defeats the homoglyph + composed-form
 * attack class.
 *
 * **Why NFKD over NFC**: NFC composes precomposed characters which
 * makes combining-mark strip patterns (Story 1.x cumulative audit pass
 * 1, C1 closure) miss the underlying ASCII when a confusable letter
 * has a combining mark. NFKD keeps them separate so downstream regex
 * sees `c` + `̌` (combining caron) instead of `č` (precomposed).
 *
 * **Locale-sensitive lowercase**: Turkish uppercase `İ` → `i` is
 * incorrect under default locale; we use the default `toLowerCase`
 * here because the Sprint 17 langs (Arabic, Urdu, Bengali) have no
 * uppercase. Turkish-aware lowercasing is Sprint 18 (when `tr` ships).
 */
export function normalizeForMultilingualMatch(input: string): string {
  const stripped = stripBidiControls(input);
  return stripped.normalize('NFKD').toLowerCase();
}
