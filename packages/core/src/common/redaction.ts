/**
 * BonkLM - Shared credential-redaction engine
 * ===================================
 *
 * The single mechanism behind the project's two credential redactors:
 *   - {@link "./index".redactSecrets} — the finding / telemetry-egress redactor
 *     (marker `[REDACTED]`, raw-Shannon entropy floor, full provider catalogue).
 *   - `redactCredentials` in `cli/utils/error.ts` — the CLI / error-message
 *     redactor (marker `***REDACTED***` / `***JWT_REDACTED***`, normalized-entropy
 *     floor, plus message-only `api_key=` and quoted catch-alls).
 *
 * Both surfaces deliberately keep their OWN marker strings, shape sets, and
 * entropy predicates — those differences are intentional, not drift — so this
 * module owns only the part they truly share: the ordered apply-each-pass loop.
 * Each caller supplies its passes; the engine threads them. Layering stays one
 * way (`cli/` imports this `common/` module, never the reverse).
 */

/**
 * One ordered redaction pass: a global-flag {@link RegExp} and the replacement
 * applied to every match. The replacement is exactly a
 * {@link String.prototype.replace} argument — either a literal marker string, or
 * a `(match, ...groups) => string` function for group-preserving or
 * entropy-gated passes.
 *
 * Passes run in array order and each sees the previous pass's output, so order
 * is load-bearing wherever one shape can be a substring of another (e.g. a JWT
 * must be masked whole before a generic high-entropy base64 pass could fragment
 * it).
 */
export type RedactionPass = readonly [
  pattern: RegExp,
  replacement: string | ((substring: string, ...groups: string[]) => string)
];

/**
 * Apply an ordered list of redaction passes to `input` and return a new string.
 *
 * Pure: never mutates `input` or the pass list. Reusing module-level
 * global-flag regexes across calls is safe here because
 * {@link String.prototype.replace} does not consume `lastIndex` the way
 * `RegExp.prototype.test` / `exec` do.
 *
 * @internal Shared plumbing, not part of the frozen public API surface — it is
 * intentionally NOT re-exported from the package barrel.
 */
export function applyRedactionPasses(input: string, passes: readonly RedactionPass[]): string {
  let out = input;
  for (const [pattern, replacement] of passes) {
    // Branch on the replacement form so each call narrows to a single
    // String.prototype.replace overload (the string vs replacer-function
    // signatures are not unifiable into one call expression).
    out = typeof replacement === 'string' ? out.replace(pattern, replacement) : out.replace(pattern, replacement);
  }
  return out;
}
