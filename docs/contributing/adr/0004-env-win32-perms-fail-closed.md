# ADR-0004: `EnvManager` win32 `.env` permission hardening fails closed (no `attrib` fallback)

> Status: Accepted (2026-06-07). Scope: `@blackunicorn/bonklm` CLI. Authority: maintainer decision
> (fail-closed chosen over warn-and-proceed). Applies to `packages/core/src/cli/config/env.ts`
> `setWindowsPermissions`. Follows ADR-0003 (the shared `isPathWithinRoot` containment helper) and
> the promisify fix in PR #48 — this ADR hardens what that left in place.

## Problem

`EnvManager.write()` persists `.env` files that hold API keys. On Windows it hardens the file's ACL
with `icacls <file> /inheritance:r` (remove inherited ACEs) before the atomic rename. PR #48 made
that spawn await its result (promisified `execFile`), but two weaknesses remained:

1. **A harmful "fallback".** On an `icacls` failure the code fell back to `attrib +R <file>`,
   throwing `WINDOWS_PERMISSIONS_FAILED` only if that _also_ failed. `attrib +R` sets the FAT
   read-only attribute. For a secrets file that is the wrong control entirely — it confers no
   confidentiality (read-only blocks modification, not reading by other principals) — and it
   actively harms the workflow: a read-only `.env` breaks the next `write()` (a rename onto a
   read-only destination fails on Windows).

2. **An unbounded spawn.** `icacls` ran with no timeout, so a wedged process could hang the
   atomic-write critical section indefinitely.

A further question was _what to do when icacls genuinely cannot harden the file_ — surface it, or
persist the secret anyway.

## Decision

`setWindowsPermissions` is hardened as follows (on top of PR #48's promisified `execFile`):

- **Bound the spawn.** `icacls` runs with
  `{ timeout: WINDOWS_PERMS_TIMEOUT_MS (5s), windowsHide: true }` so a slow or hung process is
  treated as a failure instead of hanging the write.
- **Drop the `attrib +R` fallback entirely.** It gives no ACL confidentiality and leaves the file
  read-only; there is no safe alternative tool, so there is no fallback.
- **Fail closed.** If `icacls` fails or times out, throw
  `WizardError('WINDOWS_PERMISSIONS_FAILED', …)` with the icacls error as the (sanitized) cause. The
  throw runs _before_ the atomic rename in `writeAtomic()`, so **no `.env` is left at the
  destination** — we refuse to persist a secret we could not protect.

`execFile` (argv array, no shell) and the `isPathWithinRoot` cwd-containment guard (ADR-0003) are
unchanged.

## Consequences

- A Windows host where `icacls` cannot harden the temp file (missing icacls, insufficient privilege,
  or a hang) now gets a clear `WINDOWS_PERMISSIONS_FAILED` (exit 1) with a remediation suggestion,
  and **no `.env` is written**, instead of a silent success with un-hardened permissions or a
  workflow- breaking read-only file. This is a deliberate usability-for-security trade: on such a
  host the user cannot save credentials until the permission problem is resolved. Acceptable because
  the file holds secrets and the failure is rare (the temp file is created by this process in the OS
  tmpdir, which the creator owns).
- Unix/macOS are unchanged (`chmod 0o600`).
- The behaviour is locked by the win32 tests in `env.test.ts` (icacls-fail →
  `WINDOWS_PERMISSIONS_FAILED` with the icacls cause; exactly one spawn — attrib never used;
  `rename` never called), kept non-vacuous by a faithful `node:child_process` mock that signals
  failure only through the promisify-appended callback (an un-promisified bare `await` would never
  observe the failure, so the write would wrongly resolve — RED).
- **Do not** reintroduce an `attrib +R` (or any read-only) fallback, and **do not** soften the throw
  to warn-and-proceed — both reopen the silent-degradation path this ADR closes.

### Deferred

- **Distinguishing "benign" non-zero icacls exits.** icacls can in principle exit non-zero for
  non-security reasons (locale text, an already-tight ACL). We do not parse icacls output to tell
  these apart — fail-closed is the safe default for a secrets file and output-parsing is
  locale-fragile. Revisit only if real Windows telemetry shows false hard-failures.
- **Post-write ACL read-back.** `verifyPermissions` only checks owner read/write (`access`), not the
  effective ACL. A win32 ACL assertion (parsing `icacls <path>`) would be defence-in-depth but is
  out of scope here.
