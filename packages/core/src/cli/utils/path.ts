/**
 * Working-directory containment for the CLI path sinks.
 *
 * Three CLI call sites ask the same question — "does this candidate path stay
 * inside this root directory?" — but each historically inlined its own slightly
 * different `startsWith` check, and the divergences were real bugs rather than
 * deliberate behaviour:
 *
 *  - `cli/commands/doctor.ts` (`resolveHooksPath`) — the canonical form:
 *    `resolved === root || resolved.startsWith(root + sep)`. The `+ sep` blocks a
 *    sibling-prefix bypass (`/x/app` vs `/x/app-evil`); the `=== root` clause
 *    admits a root-valued candidate (its `core.hooksPath = .` case). Runs on
 *    case-sensitive Unix too, so it does NOT case-fold.
 *  - `cli/config/env.ts` (`setWindowsPermissions`) — a win32-only `icacls`
 *    permission sink on a case-insensitive filesystem, so it case-folds both
 *    operands. A file destination is never equal to cwd, so it omits `=== root`.
 *  - `cli/detection/framework.ts` (`detectFrameworks`) — case-folded, but had NO
 *    `+ sep` guard, so the sibling-prefix bypass was reachable via a symlinked
 *    `package.json`; its hand-rolled path-segment-count "mitigation" compared
 *    only segment counts and did not catch it.
 *
 * Consolidating them here removes that copy-paste drift and gives ONE audited
 * place to reason about path-containment — in particular to harden the win32
 * path semantics the env.ts sink depends on.
 *
 * @module cli/utils/path
 */

import { resolve, sep } from 'node:path';

/**
 * Options for {@link isPathWithinRoot}.
 */
export interface PathWithinRootOptions {
  /**
   * Whether a candidate that resolves to EXACTLY `root` counts as contained.
   *
   * Default `false` — the candidate must be strictly nested under `root`. Set
   * `true` only when a root-valued candidate is legitimate, e.g. doctor.ts
   * resolving `core.hooksPath = .` back to the working tree itself. A file-path
   * sink (env.ts, framework.ts) leaves this `false`: a file can never equal its
   * containing directory.
   */
  readonly allowRootItself?: boolean;

  /**
   * Whether to compare case-insensitively (folding both operands via
   * `String.prototype.toLowerCase()`).
   *
   * Default `false` — exact, case-sensitive comparison (correct on Unix). Set
   * `true` only for a sink that runs against a case-insensitive filesystem
   * (the win32 env.ts `icacls` sink), so a destination differing from `root`
   * only in case is not falsely rejected.
   *
   * KNOWN LIMITATION (deferred — see ADR-0003): `toLowerCase()` applies the
   * Unicode default case-fold, which can diverge from a filesystem's own
   * case-fold table for exotic code points — e.g. U+212A KELVIN SIGN folds to
   * ASCII `k` here, but NTFS's upcase table treats it differently — so a string
   * fold only approximates the OS comparison. A `realpath`-canonicalised
   * comparison would be exact but requires both paths to EXIST and is a heavier
   * change; it is intentionally out of scope. The lone sink that opts in is a
   * defence-in-depth permission step, not the primary traversal guard, so the
   * residual exotic-code-point gap is acceptable for now.
   */
  readonly caseInsensitive?: boolean;
}

/**
 * Returns whether `candidate` is contained within `root` after path resolution.
 *
 * `root` is resolved (a relative `root` against the process cwd); `candidate` is
 * then resolved *against the resolved root*, so a relative `candidate` is treated
 * as root-relative and an absolute `candidate` is used as-is. (All shipped callers
 * already pass an absolute `candidate` — e.g. doctor.ts pre-joins
 * `resolve(cwd, value)` because it also needs that joined path as its own return
 * value.)
 *
 * Containment means the resolved candidate is strictly nested under the resolved
 * root (`<root><sep>…`), or — when {@link PathWithinRootOptions.allowRootItself}
 * is set — equal to the root. The `<sep>` boundary is load-bearing: a bare
 * `startsWith(root)` would also accept a sibling whose name merely extends the
 * root's (`/x/app` vs `/x/app-evil`).
 *
 * Note: this helper does NOT resolve symlinks. A caller defending against
 * symlink escape (framework.ts) must `realpath` its inputs BEFORE calling.
 *
 * @param candidate - Path to test for containment.
 * @param root - Directory the candidate must stay within.
 * @param options - See {@link PathWithinRootOptions}.
 * @returns `true` iff the resolved candidate is contained within the resolved root.
 *
 * @internal Not part of the published `@blackunicorn/bonklm` surface. Imported by
 * direct path (`../utils/path.js`) from in-tree callers and tests only, and
 * intentionally NOT re-exported through the `cli/utils` barrel — mirroring
 * `cli/commands/index.ts`, which keeps test-only internals off its barrel so they
 * cannot be promoted onto a published surface by a future `exports` subpath.
 */
export function isPathWithinRoot(candidate: string, root: string, options: PathWithinRootOptions = {}): boolean {
  const { allowRootItself = false, caseInsensitive = false } = options;

  // Resolve the root, then resolve the candidate AGAINST it: a relative candidate
  // is treated as root-relative (the least-surprising reading of "is candidate
  // within root"); an absolute candidate is returned unchanged by `resolve()`.
  // Every shipped caller passes an already-absolute candidate, so this only shapes
  // behaviour for hypothetical relative-candidate callers.
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(resolvedRoot, candidate);

  // Fold AFTER resolve so normalisation (`..`, `.`, duplicate separators) runs on
  // the original casing. `sep` is case-invariant, so the fold commutes with the
  // `sep` append below.
  const fold = (path: string): string => (caseInsensitive ? path.toLowerCase() : path);
  const foldedRoot = fold(resolvedRoot);
  const foldedCandidate = fold(resolvedCandidate);

  if (foldedCandidate === foldedRoot) {
    return allowRootItself;
  }
  // Require a `sep` boundary so a sibling whose name merely extends the root's
  // (`/x/app` vs `/x/app-evil`) is rejected — UNLESS the root already ends in
  // `sep` (it IS a filesystem root `/`, a drive root `C:\`, or a UNC root
  // `\\srv\share\`), where appending again would yield `//` and reject every
  // child. `resolve()` strips trailing separators except for these roots.
  const rootPrefix = foldedRoot.endsWith(sep) ? foldedRoot : foldedRoot + sep;
  return foldedCandidate.startsWith(rootPrefix);
}
