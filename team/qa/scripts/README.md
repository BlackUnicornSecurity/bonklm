# team/qa/scripts/

Helper scripts referenced by the BR-QAF framework workflows and the v1.0.0 instance master checklist. Authored 2026-05-25 alongside the framework.

| Script | Purpose | Referenced by |
|---|---|---|
| `check-version-pin.sh` | Verify all workspace `package.json` files declare the same version | Gate 1 ST-01-009; framework workflow pre-commit |
| `cascade-check.sh` | Enumerate dependents of a modified symbol across code + docs + tests + ADRs + lessons | `framework/workflows/cascade-update-workflow.md` step 1 |
| `check-retest-log.sh` | Pre-commit gate that refuses a fix commit if cited defect ID has no retest-log entry | `framework/workflows/retest-workflow.md` automation hooks |
| `post-publish-watch.sh` | Capture npm-view + GH-issue + npm-audit snapshots for post-publish monitoring | `framework/policies/post-publish-monitoring.md` automation |
| `count-checkboxes.sh` | Audit checkbox count in `02-master-checklist.md` (truth vs claim) | Senior-QA spot audit |
| `count-stories.sh` | Audit unique story IDs in `06-epics-stories.md` | Senior-QA spot audit |

Run any script with `--help` for usage.

All scripts are POSIX-compatible (sh / bash 3.2+) for macOS compatibility. No bash-4 features. No GNU-only flags.

License: same as repo (MIT).
