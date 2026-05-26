# Entry + Exit Criteria

Universal pre-flight + sign-off checks. Apply at the start and end of every release-QA cycle.

## Entry criteria (run BEFORE Sprint N+0 starts)

A release-QA cycle does not start until all of the following are true:

1. **HEAD pinned.** The commit SHA at which QA begins is documented in `00-meta-plan.md` front matter.
2. **Workspace at RC.** All packages declare the rc.N version; no half-cut state. Verify via `grep '"version"' packages/*/package.json | sort -u` → single result.
3. **`pnpm typecheck` clean** at HEAD. Capture log to `evidence/baseline/typecheck.log`.
4. **`pnpm test` baseline** captured at HEAD. Counts saved to `evidence/baseline/test-baseline.json` (with documented skip count and reason for each skip).
5. **Battlefield testbed reachable.** `ssh paultinp@192.168.0.107 'docker compose -f ~/BU-BattleLab/infra/docker-compose.yml --profile core --profile vector ps'` returns expected services. Capture to `evidence/baseline/battlefield-status.log`.
6. **dojoLM corpus fetched.** Latest snapshot of `/Users/paultinp/BU-TPI/packages/bu-tpi/fixtures/` rsynced to Battlefield at `~/BU-BattleLab/corpus/from-dojolm/`. Hash captured to `evidence/baseline/corpus-manifest.json`.
7. **All decisions resolved or explicitly deferred.** `01-decisions.md` shows each D-N with a resolution or a "Deferred to stage X" note + rationale.
8. **Master checklist scaffolded.** `02-master-checklist.md` exists with every gate × task × connector row, all unchecked.
9. **Defect tracker initialized.** `03-defects.md` exists with schema header, empty body.
10. **Risk register seeded.** `04-risk-register.md` has R-1 … R-N entries from `team/lessonslearned.md` tail + carryover risks.
11. **Repo backup.** `team/backups/<YYYY-MM-DD>-pre-v<version>/` exists with full repo snapshot per `CLAUDE.md`.
12. **Lessons learned read.** `team/lessonslearned.md` tail (Sprint window) read by the release-engineer + senior-QA. Confirmation note in `05-senior-qa-signoff.md`.

If ANY entry criterion fails, the release-QA cycle does NOT start. Resolve, then retry the entry check.

## Exit criteria (run BEFORE Gate 10 publish step)

The release does not publish until all of the following are true:

1. **Every gate PASS criterion met** (binary, evidence-linked).
2. **Every master-checklist item checked** + evidence-linked.
3. **Every defect resolved** OR risk-accepted with signed-off entry in `04-risk-register.md`.
4. **Cascade-log shows zero pending ripples.** Every cascade entry has `Cascade-complete: YES`.
5. **Doc-sync log shows zero stale docs.** Every entry has `Sync-complete: YES`.
6. **Risk register has zero High open items.**
7. **Senior-QA sign-off executed** + dated + HEAD-pinned in `05-senior-qa-signoff.md`.
8. **CHANGELOG `[Unreleased]` collapsed** to a versioned heading. Date filled.
9. **Sign-off matrix complete.** Every signatory in `policies/sign-off-matrix.md` has signed.
10. **Rollback procedure rehearsed.** At least one dry-run of `npm unpublish` on a sacrificial package name documented in `evidence/baseline/rollback-rehearsal.log`.
11. **Post-publish monitoring template populated** with the 24h / 7d / 30d observable rows + owner names.
12. **No P0 or P1 defects open.** P2/P3 defects either resolved OR documented as risk-accepted with sign-off.
13. **All five pre-publish hard blocks (see `09-security-addendum.md`) closed** with retest evidence.

If ANY exit criterion fails, the release does NOT publish. Resolve, then retry the exit check.

## Roles

| Criterion | Verifier |
|---|---|
| Entry 1-6 | Release engineer |
| Entry 7-12 | Senior QA |
| Exit 1-3 | Senior QA |
| Exit 4-5 | Release engineer |
| Exit 6 | Risk owner (per `04-risk-register.md`) |
| Exit 7 | Senior QA — terminal sign-off |
| Exit 8-9 | Release engineer |
| Exit 10 | Release engineer |
| Exit 11 | Black Unicorn maintainer |
| Exit 12-13 | Senior QA + security code reviewer |

## Evidence

Entry / exit checklists are captured in:
- `team/qa/<version>/05-senior-qa-signoff.md` — sign-off doc with check-by-check verdict
- `team/qa/<version>/evidence/baseline/` — entry-criterion artifacts
- `team/qa/<version>/evidence/exit/` — exit-criterion artifacts

## Failure mode

If an entry / exit criterion is borderline (e.g. one connector smoke is yellow but not red), the senior QA may grant a conditional pass with:
- The condition documented in `04-risk-register.md` with severity + mitigation
- Sign-off in `05-senior-qa-signoff.md` referencing the conditional
- A follow-up story for the next release cycle

Conditional passes are explicitly off-limits for security gates and hard blocks. Those are binary.
