# Local-harness security validators

Self-contained security validators for **this repository's Claude Code agent
harness**. They run as `PreToolUse` / `UserPromptSubmit` / standalone hooks (wired
in `.claude/settings.json`) to guard the developer's agent sessions against
catastrophic commands, credential/secret writes, PII, sensitive-file tampering,
and obvious prompt-manipulation.

These are **harness tooling, not part of the published `@blackunicorn/bonklm`
library.** They are deliberately separate from the npm packages:

- **Zero dependencies, no build step.** Plain ESM JavaScript run directly by
  `node`. The *hooks themselves* run in any checkout (even before `pnpm install` /
  `pnpm build`), so the guard can never be silently disabled by a missing build
  artifact.
- **Excluded from the pnpm workspace and the root lint/format/typecheck/test.**
  Validated by their own toolchain (`vitest.config.js`), like
  `tools/eslint-plugin-bonklm-edge`.
- **100% unit coverage** on `lib/**` (except the thin `lib/run-hook.js` I/O
  boundary, which the spawn-based `test/bin.test.js` integration tests cover).
  Run from the repo root *after `pnpm install`*: `pnpm exec vitest run --config
  .claude/validators-node/vitest.config.js --coverage`.

## Failure posture (fail-open)

Hooks fire on nearly every tool call, so a buggy fail-closed validator could brick
a session. The design is therefore **fail-open**:

- A validator that **throws / cannot parse its input → ALLOW** (exit 0) with a
  diagnostic on stderr. A validator bug never blocks the agent.
- A validator **blocks (exit 2) only on a confident, specific match.**
- The **content heuristics that this repo legitimately triggers** (it authors
  attack fixtures) are **advisory**: they warn on stderr (exit 0) rather than
  block.

| Validator           | Event(s)                                   | Posture |
| ------------------- | ------------------------------------------ | ------- |
| `bash-safety`       | PreToolUse:Bash                            | BLOCK catastrophic commands + `rm -rf` outside the repo / of a shell variable |
| `secret`            | PreToolUse:Write/Edit/NotebookEdit         | BLOCK high-confidence provider keys (example lines / `*.example` files skipped) |
| `env-protection`    | PreToolUse:Write/Edit/NotebookEdit         | BLOCK writes to credential files (`.env`, keys, `.npmrc`, …; `*.example` allowed) |
| `pii`               | PreToolUse:Write/Edit/NotebookEdit/TodoWrite | BLOCK SSNs and Luhn-valid card numbers (emails/phones not flagged) |
| `outside-repo`      | acts on Write/Edit/NotebookEdit (wired on Bash/Read/Glob/Grep too, where it is a pass-through) | BLOCK writes to sensitive external locations (`~/.ssh`, `/etc`, shell rc, …) |
| `supply-chain`      | PreToolUse:Skill                           | BLOCK installs of denylisted typosquat packages (illustrative denylist — see Scope) |
| `authorization`     | PreToolUse:Skill                           | ALLOW by default; BLOCK denied intents (disable-guardrails, exfiltration) |
| `jailbreak`         | UserPromptSubmit                           | BLOCK unambiguous templates (DAN/STAN/…); WARN on softer patterns |
| `prompt-injection`  | UserPromptSubmit + Write/Edit/Read/…       | WARN only (advisory) |
| `settings-integrity`| standalone (security-regression gate)      | Fail CLOSED (exit 1) if `.claude/settings.json` is weakened |

## Kill-switch (lockout escape hatch)

If an active validator ever blocks legitimate work, disable **all** of them at
once by EITHER:

- **Env var:** export `BONKLM_VALIDATORS_DISABLED=1` before launching Claude Code
  (any value except `0` / `false`), or
- **Sentinel file:** create `.claude/validators-node/state/DISABLED` (the `state/`
  directory is gitignored, so it never ships).

While disabled, every validator exits 0 (allow). Remove the sentinel / unset the
env var to re-enable. `settings-integrity` is a standalone gate control and is not
affected by the kill-switch.

## Layout

```
.claude/validators-node/
  bin/*.js     hook entrypoints (small shims -> lib/run-hook.js + a lib validator;
               settings-integrity.js is a standalone CLI, not a hook shim)
  lib/*.js     all logic (100% covered): parsing, path containment, decision, report
  lib/validators/*.js   one validate() per guard
  test/*.test.js        unit + spawn-based integration tests
  state/                gitignored runtime state (incl. the DISABLED sentinel)
```

## Scope and known limitations

- **`.claude/settings.json` also references ~11 additional harness hooks**
  (`rate-limiter`, `recursion-guard`, `session-init`, `token-validator`,
  `production`, `plugin-permissions`, `resource-limits`, `settings-guard`,
  `context-integrity`, `media-validator`, `output-validator`) that are **not yet
  implemented**. Those `node …/<missing>.js` invocations exit non-zero-non-2, which
  Claude Code treats as a non-blocking error — i.e. they fail open exactly as
  before this change. Implementing them is tracked separately; this subtree adds
  the 10 listed above plus the standalone integrity check.
- **`bash-safety` is a best-effort guard, not a shell sandbox.** Regex/tokenization
  cannot model every shell construct; it covers `rm -rf`, `find -delete/-exec rm`,
  `shred`, `cd`-tracked relative deletes, and a dangerous-pattern list. Determined
  obfuscation can still evade it — it is one defense-in-depth layer.
- **`supply-chain` uses a small, illustrative typosquat denylist** wired on `Skill`.
  Comprehensive install scanning (and wiring on `Bash`, where installs usually run)
  is a future enhancement.
- **`MultiEdit` content extraction is implemented (forward-compat)** but no
  `MultiEdit` matcher is wired in `.claude/settings.json` yet, so multi-edits are not
  yet scanned by the content guards — tracked with the other deferred wiring above.
- **The kill-switch is intentionally easy to trip** (an in-repo write to the
  sentinel, or an env var). A guard that wants to protect the developer from an
  already-compromised agent is out of scope for a local fail-open design.
