# ADR-0003: Shared CLI working-directory containment helper

> Status: Accepted (2026-06-07). Scope: `@blackunicorn/bonklm` CLI (`packages/core/src/cli/`).
> Authority: internal engineering review (follow-up to the PR #47 senior-architect audit). Applies
> to `cli/utils/path.ts`, `cli/commands/doctor.ts`, `cli/config/env.ts`,
> `cli/detection/framework.ts`.

## Problem

Three CLI call sites independently answered the same question — "does this candidate path stay
inside this root directory?" — and each had inlined its own slightly different check. The
divergences were accidental (incremental hardening, never reconciled), and one was a latent bug:

| Site                              | Check                                                                                 | `+ sep` boundary | case-fold | `=== root` | on violation                   |
| --------------------------------- | ------------------------------------------------------------------------------------- | ---------------- | --------- | ---------- | ------------------------------ |
| `doctor.ts` `resolveHooksPath`    | `resolved === root \|\| resolved.startsWith(root + sep)`                              | yes              | no        | yes        | fall back to default           |
| `env.ts` `setWindowsPermissions`  | `target.toLowerCase().startsWith((root + sep).toLowerCase())`                         | yes              | yes       | no         | throw `PATH_OUTSIDE_DIRECTORY` |
| `framework.ts` `detectFrameworks` | `realPath.toLowerCase().startsWith(workingDir.toLowerCase())` + segment-count compare | **no**           | yes       | n/a        | throw `PATH_TRAVERSAL`         |

`doctor.ts` (added in #45) and `env.ts` (corrected in #47) had converged on the correct
`startsWith(root + sep)` form. `framework.ts` had not: its `startsWith` lacked the `+ sep` boundary,
so a sibling directory whose name merely **extends** the root's (e.g. root `…/app`, candidate
`…/app-evil`) satisfied the prefix test. Its compensating check compared only path-**segment
counts**, which a sibling-prefix path passes (same depth), so the bypass was reachable via a
symlinked `package.json` pointing at such a sibling.

Three copies also meant three places to maintain, and no single audited home in which to reason
about the win32-specific path semantics the `env.ts` permission sink depends on.

## Decision

Extract one tested helper and route all three sites through it:

```ts
// cli/utils/path.ts
export function isPathWithinRoot(
  candidate: string,
  root: string,
  options?: { allowRootItself?: boolean; caseInsensitive?: boolean }
): boolean;
```

- Resolves the root, then resolves the candidate against it (a relative candidate is root-relative;
  an absolute one is used as-is), and returns `true` iff the resolved candidate equals the resolved
  root (only when `allowRootItself`) or is strictly nested beneath it (`<root><sep>…`). The `<sep>`
  boundary is the load-bearing part — it is what a bare `startsWith(root)` lacks; a root that
  already ends in `sep` (a filesystem / drive / UNC root) is special-cased so the prefix never
  becomes `//`.
- `doctor.ts` calls it with `{ allowRootItself: true }` (its `core.hooksPath = .` resolves to the
  working tree itself) and no case-fold (the doctor also runs on case-sensitive Unix).
- `env.ts` (`setWindowsPermissions`) calls it with `{ caseInsensitive: true }` — that sink runs
  **only** on win32, whose filesystem is case-insensitive — and default `allowRootItself: false` (a
  file destination can never equal its containing directory).
- `framework.ts` calls it with `{ caseInsensitive: true, allowRootItself: true }`, preserving its
  long-standing case-fold, and the helper's `+ sep` boundary **closes the sibling-prefix gap**; the
  bespoke segment-count check is removed as redundant. `allowRootItself: true` preserves prior
  behaviour for the degenerate `packageJsonPath: '.'` case, where the realpath'd target resolves to
  the working dir itself: the old check accepted it and the subsequent directory `readFile` returned
  `[]` (EISDIR), so the helper accepts it rather than raise a spurious `PATH_TRAVERSAL`.

The helper does **not** resolve symlinks: a caller that must defeat symlink escape (`framework.ts`)
realpaths its inputs before calling, keeping symlink policy a per-caller concern.

### Open question (a): string case-fold vs. filesystem upcase table — DEFERRED

`caseInsensitive` folds with `String.prototype.toLowerCase()` (the Unicode default case-fold). A
real filesystem's own case-fold table can diverge for exotic code points — e.g. U+212A KELVIN SIGN
folds to ASCII `k` under `toLowerCase()`, but NTFS's upcase table does not treat it identically — so
a string fold only _approximates_ the OS comparison. A `realpath`-canonicalised comparison (compare
the OS-canonical forms with no string fold) would be exact.

**Decision: keep the string fold; defer the realpath approach.** Rationale: (1) `realpath` requires
both operands to **exist**, which the doctor's hook-path check cannot assume; (2) the only sink that
opts into case-insensitivity is the win32 `icacls` step — defence-in-depth on top of the
construction-time `validateEnvPath` guard, not the primary traversal control — so the residual
exotic-code-point gap is low-impact; (3) it preserves the prior behaviour of both `env.ts`
(post-#47) and `framework.ts` with no functional change. Revisit if a realpath-canonical comparison
is adopted project-wide.

A _related but distinct_ deferral: `framework.ts` applies `caseInsensitive` **unconditionally**
(cross-platform), not gated on `platform()`, purely to preserve its pre-refactor behaviour. On a
case-sensitive volume this folds more liberally than the OS would, but it cannot widen containment
past the `+ sep` boundary (the sibling-prefix reject holds under folding — see
`cli/utils/path.test.ts`), so it is safe. A platform-conditional fold is the documented future
refinement.

### Open question (b): the Unix `chmod` permission sink has no cwd-containment guard — DEFERRED

`env.ts` guards working-directory containment **only** on the win32 branch of
`setSecurePermissions`; the Unix/macOS `chmod` branch has no equivalent check. (Tracked in the PR
#46/#47 handover as "observation #1".)

Precisely what is and isn't guarded: `validateEnvPath` rejects `..` path segments at construction on
**both** platforms, so the relative-traversal vector is already closed everywhere. What the Unix
branch lacks is specifically the **cwd-containment** check the win32 sink applies — and that check
would reject the **absolute paths `EnvManager` allows by contract**.

**Decision: leave the Unix branch unguarded; do not extend the helper to it here.** Rationale: (1)
the `..`-traversal vector is already closed by `validateEnvPath` on both platforms; (2) `EnvManager`
allows absolute paths **by contract** (documented on `validateEnvPath`), so a `cwd`-containment
guard would reject a supported input class; (3) no shipped caller passes a non-default path, so
there is no exposed sink today — this rests on caller behaviour, not a code guard, and can rot if a
future caller passes a user-supplied path; (4) adding the guard is a behaviour change that needs a
product decision on the absolute-path contract — out of scope for a behaviour-preserving
consolidation. The Unix branch and the `setSecurePermissions` fork both carry inline comments
pointing here.

## Consequences

- One audited definition of path containment for the CLI; `doctor.ts` keeps identical behaviour,
  `env.ts` keeps its post-#47 behaviour, and `framework.ts` is hardened (the sibling-prefix bypass
  is closed) with a net reduction in code.
- The helper is `@internal` — imported by direct path from in-tree callers and tests, intentionally
  NOT re-exported through the `cli/utils` barrel, and not part of the published package surface.
- Non-vacuity (ADR-0001): unit tests in `cli/utils/path.test.ts` plus the existing call-site suites
  pin each clause. Mutating the source — dropping `+ sep`, disabling the fold, or ignoring
  `allowRootItself` — turns the corresponding tests (including the call-site integration tests) red.
- The two deferrals above are tracked here; revisiting either is a documented decision, not silent
  drift.
