# Post-Publish Monitoring

72h watch starts the moment the last package is published. Three windows: first 24h, first 7d, first 30d. Each window has observable checks + action thresholds + an owner.

## Window 1 — First 24h (intensive watch)

Cadence: every 4 hours during waking hours; once at the 24h mark.

| Observable | Check | Action threshold | Owner |
|---|---|---|---|
| `npm view <pkg> downloads.<period>` | Install count anomaly | < 1 OR > 10× baseline | Release engineer |
| `gh search issues --repo blackunicorn/bonklm --created ">$(date -u -v-1H)"` | New issue count | ≥ 1 new issue with `security` label, OR ≥ 3 new issues of any kind | Release engineer |
| `npm audit` of an external fresh install of the latest version | Audit advisories on shipped code | Any HIGH or CRITICAL advisory | Security code reviewer |
| `gh api /repos/blackunicorn/bonklm/dependabot/alerts --jq '.[].state'` | Dependabot alerts on direct deps | Any new HIGH or CRITICAL alert | Security code reviewer |
| Cold install on a fresh Node 22 container | `npm i @blackunicorn/bonklm && node -e "import('@blackunicorn/bonklm').then(m => console.log(Object.keys(m).length))"` | Non-zero exit OR < expected symbol count | Release engineer |
| `bonklm doctor` on a fresh install | Exit code | Non-zero | Release engineer |

If any threshold trips: pause; convene senior QA + release engineer; decide pause / hot-fix / rollback per `policies/rollback-procedure.md`.

## Window 2 — First 7d (regular watch)

Cadence: daily.

| Observable | Check | Action threshold | Owner |
|---|---|---|---|
| Cumulative install count | `npm view <pkg> downloads.week` | Anomaly vs prior release week curve | Release engineer |
| Open GitHub issues by label | `gh issue list -L security -L bug` | Triage any issue ≥ 6h open | Senior QA |
| Dependents on npm | `npm view <pkg> dependents` | Track; document if breaking on dependent surfaces | Architect reviewer |
| Negative tweets / posts about the release | Manual scan | Document; do not engage; consider patch | Maintainer |
| Customer-reported bugs (email, Discord, etc.) | Manual triage | File defect against `team/qa/<version>+1/03-defects.md` (next release) | Senior QA |
| `pnpm audit` re-run | Transitive CVEs surfaced | Any HIGH or CRITICAL on production closure | Security code reviewer |
| Bench reproducibility on Battlefield | `pnpm bench` | > 10 % regression vs Sprint-N baseline | Architect reviewer |

## Window 3 — First 30d (steady-state monitoring)

Cadence: weekly.

| Observable | Check | Action threshold | Owner |
|---|---|---|---|
| Adoption curve | npm download trend | Below expected | Maintainer (assess marketing) |
| Documented bugs (all severities) | `03-defects.md` for next release | ≥ 1 P0/P1 → plan patch release | Senior QA |
| Downstream breakage reports | GitHub + email | Patch / patch-major decision | Release engineer + maintainer |
| Long-tail CVEs on deps | Snyk / Socket.dev | Document; patch in next minor | Security code reviewer |

At the 30d mark, the post-publish window closes. Compile the monitoring report into `team/qa/<version>/post-publish-monitoring.md`.

## Report template (`team/qa/<version>/post-publish-monitoring.md`)

```markdown
# Post-Publish Monitoring — v{{VERSION}}

**Publish date:** YYYY-MM-DD
**Window closed:** YYYY-MM-DD (30 days later)
**Status:** GREEN | YELLOW | RED

## 24h summary
- Install count: {{N}} (baseline: {{B}})
- Issues filed: {{N}} ({{security count}})
- CVE alerts: {{N}}
- `bonklm doctor` cold-install: PASS | FAIL
- **Action taken:** {{none | pause | hot-fix | rollback}}

## 7d summary
- Cumulative installs: {{N}}
- Open issues: {{N}}
- Dependents on npm: {{N}}
- Customer reports: {{N}}
- **Action taken:** {{summary}}

## 30d summary
- Adoption curve: {{description}}
- P0/P1 bugs: {{N}}
- Patch decisions: {{list}}
- CVE summary: {{list}}

## Lessons + amendments
- Framework amendments: {{list of template / workflow changes}}
- Next-release backlog seeds: {{story IDs}}
- Lessons logged to `team/lessonslearned.md`: {{anchors}}

## Sign-off
- Senior QA: ___ Date: ___
- Release engineer: ___ Date: ___
- Maintainer: ___ Date: ___
```

## Automation

A weekly cron at `team/qa/scripts/post-publish-watch.sh` (release engineer scaffolds per release):

```bash
#!/usr/bin/env bash
# Usage: post-publish-watch.sh <version>
set -e
version="$1"
out_dir="team/qa/$version/evidence/post-publish/$(date -u +%Y-%m-%dT%H-%M-%SZ)"
mkdir -p "$out_dir"

npm view "@blackunicorn/bonklm@$version" --json > "$out_dir/npm-view.json"
gh issue list --repo blackunicorn/bonklm --search "created:>$(date -u -d '24 hours ago' +%Y-%m-%d)" --json number,title,labels > "$out_dir/issues.json"
npm audit --prefix "$out_dir/install-test" --audit-level=high --json > "$out_dir/audit.json" || true
```

Output cached to evidence dir per run, indexed in the monitoring report.

## Failure mode

If the monitoring window surfaces a P0 in-the-wild defect:
1. File the defect at P0 / Urgent in `team/qa/<version>+1/03-defects.md`
2. Decide rollback vs patch per `policies/rollback-procedure.md`
3. Notify consumers within the SLA defined in the rollback procedure
4. Convene a post-mortem within 1 week; merge into `team/lessonslearned.md`
