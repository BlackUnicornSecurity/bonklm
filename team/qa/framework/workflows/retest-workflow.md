# Retest Workflow

Every defect-fix triggers this workflow. A defect is NOT closed until all four steps below pass.

## Trigger

A defect transitions from `in-progress` → `awaiting-retest` when a fix commit is merged. The retest workflow runs before the defect can move to `closed`.

## Steps

### 1. Re-run the failing test

Execute the exact command that originally captured the failure. Same fixture, same args, same environment.

```bash
# Example: the command that produced the original FAIL evidence
pnpm --filter @blackunicorn/bonklm test src/security/override-token.test.ts -t "replay cache starvation"
```

PASS criterion: exit 0; the previously-failing assertion now passes.

If the command requires environment setup (Battlefield, docker container, env var), capture the setup commands in the retest evidence file alongside the test run.

### 2. Re-run the full gate that surfaced the defect

Execute every PASS criterion of the affected gate, not just the failing one. This catches collateral damage from the fix.

```bash
# Example: gate 5 (security regression) is re-run end-to-end
pnpm --filter @blackunicorn/bonklm test --reporter=json --outputFile=evidence/gate-5/retest-D-042.json
```

PASS criterion: gate-level summary shows the same PASS count as the pre-defect baseline (no regressions introduced by the fix).

### 3. Run the regression-set

Regression-set composition for each subsystem:

| Subsystem | Regression-set |
|---|---|
| `packages/core` | Full workspace `pnpm test` (188 files baseline) |
| connector-utils / sanitize / validators / guards / hooks / fault-tolerance / telemetry / security | Full workspace `pnpm test` (cascades touch every connector) |
| individual connector | `pnpm --filter <connector>... test` plus that connector's UAT scenario |
| CLI | `pnpm --filter @blackunicorn/bonklm test src/cli/` + `bonklm doctor` smoke on macOS + Linux |
| edge exports | `pnpm --filter @blackunicorn/bonklm test:edge` + workerd / edge-light smoke |
| performance-sensitive | `packages/core/benchmarks/` suite (Battlefield only — avoids host-drift) |
| documentation | `docs/user/` code-sample compile sweep |

PASS criterion: regression-set has no new failures vs the pre-defect baseline. The baseline is captured at the start of the release cycle in `evidence/baseline/`.

### 4. Update retest-log

Append to `team/qa/<version>/retest-log.md`:

```markdown
## Retest — D-NNN (YYYY-MM-DD HH:MM)
- **Fix commit:** {{SHA}}
- **Defect:** D-NNN — {{short description}}
- **Severity:** P0 | P1 | P2 | P3
- **Originally-failing command:** `{{command}}` → exit 0
- **Gate re-run:** Gate {{N}} → {{count}} pass / {{count}} fail
- **Regression-set:** {{scope}} → {{count}} pass / {{count}} fail (baseline: {{baseline-count}})
- **Evidence:** `evidence/<gate>/retest-D-NNN/`
- **Result:** PASS | FAIL
- **Retester:** {{role}}
- **Next:** close defect | escalate (reason)
```

PASS criterion: entry exists with `Result: PASS`; all linked evidence files exist.

## Failure mode

If any of the four steps fail, the defect REMAINS open. Do NOT close. File a follow-up defect if a NEW failure surfaces and link both:

```markdown
- Original defect: D-042
- Follow-up: D-091 (new failure in regression-set: ...)
- Link: blockedBy D-042 + D-091 must both close before retest passes
```

## Regression-set update policy

When a new test is added during the release cycle, it joins the regression-set automatically (the regression-set is defined as "everything green at baseline + everything added since"). The baseline file `evidence/baseline/test-baseline.json` is regenerated at the start of each sprint.

## Automation hooks

- The CLAUDE-side pre-commit hook should refuse to push a fix commit if the cited defect ID has no retest-log entry. This is enforced by `team/qa/scripts/check-retest-log.sh` (release engineer scaffolds per release).
- The senior-QA reviewer spot-audits 10 % of retest entries by re-running the commands from a clean checkout (see `templates/evidence-conventions.md` § cross-evidence checks).

## Special cases

### Doc-only fix

A doc-only fix still retests:
1. Re-run any code samples in the doc through the compile sweep
2. Re-run broken-link check
3. Gate 7 re-run scope (not full workspace)

### Build-config fix (TS, lint, bundler)

A build-config fix triggers full workspace `pnpm typecheck && pnpm test` regardless of which file changed.

### Security-sensitive fix

A security-sensitive fix additionally requires:
- Security-reviewer agent re-pass
- ADR-0001 (or relevant ADR) cross-reference check
- Regression test added (mandatory — no exceptions)
- `team/lessonslearned.md` entry within the same sprint
