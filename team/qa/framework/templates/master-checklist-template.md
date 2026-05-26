# Master Checklist Template

A single tracking document for every QA item across every gate × every connector × every task. One file per release at `team/qa/<version>/02-master-checklist.md`. Markdown checkboxes are the source of truth; a JSON sidecar can be derived for dashboards.

## Completion criterion

A checkbox is COMPLETE only when ALL of the following are true:

1. The box is `[x]` checked
2. An evidence link resolves to a file under `evidence/<gate>/<story-id>/`
3. Any defect raised by the task is resolved per `policies/defect-taxonomy.md` AND retest-logged
4. Cascade-update + doc-sync log entries exist for the task

The release publishes only when 100 % of checkboxes are complete by this definition.

## Update protocol

| Actor | Permission | Verification step |
|---|---|---|
| Task executor (Claude agent or human) | Checks own task | Must link evidence |
| Senior QA | Verifies all checks | Spot-audits 10 % of evidence links per gate |
| Sign-off matrix signatory | Final verification per gate | Reviews summary + defect log per gate |

## Skeleton — copy + fill per release

```markdown
# v{{VERSION}} Master Checklist

**Last updated:** YYYY-MM-DD HH:MM by `<role>`
**Status:** {{N}}/{{TOTAL}} complete ({{PERCENT}}%) — see `policies/entry-exit-criteria.md`
**Gates:** {{green-count}}/10 GREEN

## Sprint progression

| Sprint | Goal | Status | % complete |
|---|---|---|---|
| {{N}} | {{goal}} | not started \| in progress \| complete | {{pct}} |

## Gate 1 — Package coherence
- [ ] G1-T1 Version normalization → all 53 packages at `{{VERSION}}` → evidence `evidence/gate-1/ST-01-004/`
- [ ] G1-T2 Engines normalization
  - [ ] {{pkg1}} → evidence link
  - [ ] {{pkg2}} → evidence link
  - [ ] … 22 more rows
- [ ] G1-T3 Exports-map fix (8 connectors)
  - [ ] chroma-connector → evidence link
  - [ ] huggingface-connector → evidence link
  - [ ] llamaindex-connector → evidence link
  - [ ] pinecone-connector → evidence link
  - [ ] qdrant-connector → evidence link
  - [ ] vercel-connector → evidence link
  - [ ] weaviate-connector → evidence link
  - [ ] wizard (or mark private + skip) → evidence link
- [ ] G1-T4 LICENSE per package (26-44 missing)
  - [ ] one row per missing package
- [ ] G1-T5 README per package (12 missing)
  - [ ] one row per missing package
- [ ] G1-T6 Drop `openclaw-adapter` from publish set
- [ ] G1-T7 CHANGELOG rc.4 + v{{VERSION}} entries
- [ ] G1-T8 Verify `bin/run.js` shebang + mode `0755` in core tarball
- [ ] G1-T9 Workspace typecheck + test re-baseline post-Gate-1

## Gate 2 — Install + publish dry-runs
- [ ] G2-T1 `pnpm publish -r --dry-run` on rc.N — exit 0
- [ ] G2-T2 Generate {{N}} tarballs via `npm pack`; capture SHA-256 manifest
- [ ] G2-T3 Tarball content inventory diff vs whitelist
- [ ] G2-T4 Local Verdaccio registry stand-up + publish rc.N
- [ ] G2-T5 Consumer-app install harness (clean Node 20.4 container)
- [ ] G2-T6 Subpath import smoke under strict TS (`bundler`+`node16`+`nodenext`)
- [ ] G2-T7 CJS consumer smoke (where supported)
- [ ] G2-T8 ESM consumer smoke + tree-shake size assertion
- [ ] G2-T9 Tarball reproducibility (feeds Gate 5.8): byte-identical across 2 runs

## Gate 3 — Runtime matrix smoke
- [ ] G3-T1 Node 20 LTS smoke
- [ ] G3-T2 Node 22 LTS smoke
- [ ] G3-T3 Node 24 next-LTS smoke
- [ ] G3-T4 Workerd edge smoke
- [ ] G3-T5 Vercel edge-light smoke
- [ ] G3-T6 Deno smoke (informational)
- [ ] G3-T7 Bun smoke (informational)
- [ ] G3-T8 Matrix consolidation report

## Gate 4 — Connector smoke matrix (52 connectors)

One row per connector. Each row has:
- [ ] install
- [ ] import
- [ ] hello-world (ALLOW)
- [ ] BLOCK case
- [ ] streaming (if applicable)
- [ ] error-path
- [ ] telemetry / hooks wiring smoke
- [ ] UAT scenario
- [ ] evidence dir populated

(See `07-connectors-matrix.md` for the full per-connector breakdown.)

## Gate 5 — Security regression sweep

### Hard blocks (Sprint N+0, MUST land before any tarball ships)
- [ ] HB-1 Zero secrets in any tarball (gitleaks + ripsecrets clean)
- [ ] HB-2 Override-token replay-cache starvation patched + regression test
- [ ] HB-3 `sanitizeLogString` hex-escapes U+202E + bidi range
- [ ] HB-4 `HookSandbox.SAFE_GLOBALS` excludes host `setTimeout`/`setInterval`
- [ ] HB-5 `BufferedTelemetryCollector.flush()` uses `serializeError`

### Code-review fixes (B.1 … B.16)
- [ ] B.1 fix + unit test
- [ ] B.2 fix + unit test
- [ ] … (one row per finding)

### Sub-gates 5.1 → 5.5 (universal)
- [ ] 5.1 CWE-117 5-site regression — `evidence/gate-5/5.1-cwe117.log`
- [ ] 5.2 secure-json-parse sister-site sweep
- [ ] 5.3 sanitizeMeta hostile-`toString` fail-closure
- [ ] 5.4 Prompt-injection corpus replay (dojoLM 5,166 fixtures via Battlefield)
- [ ] 5.5 Jailbreak / secret / PII / XSS / cmd-injection guard regression

### Sub-gates 5.6+ (release-specific)
- [ ] 5.6 Bidi-override log-injection regression
- [ ] 5.7 Retry amplification harness
- [ ] 5.8 Tarball reproducibility check
- [ ] 5.9 CLI path-traversal input validation
- [ ] 5.10 sanitizeReasonText ADR-0001 alignment audit

## Gate 6 — CLI smoke
- [ ] G6-T1 `bonklm --help` parity
- [ ] G6-T2 `bonklm doctor` happy path macOS
- [ ] G6-T3 `bonklm doctor` happy path Linux (Battlefield)
- [ ] G6-T4 `bonklm doctor` detects seeded misconfigs
- [ ] G6-T5 CLI install-from-tarball
- [ ] G6-T6 Exit-code contract
- [ ] G6-T7 Path-traversal validation
- [ ] G6-T8 Consolidation report

## Gate 7 — Documentation validity
- [ ] G7-T1 `docs/user/` code-sample compile sweep
- [ ] G7-T2 Public-API coverage audit (core)
- [ ] G7-T3 ADR-0001 cross-reference refresh
- [ ] G7-T4 `openclaw` scrub
- [ ] G7-T5 Connector docs reconciliation (52)
- [ ] G7-T6 Quickstart on clean machine walkthrough
- [ ] G7-T7 CHANGELOG/README mirror check
- [ ] G7-T8 Broken-link check
- [ ] G7-T9 Consolidation report

## Gate 8 — Performance gates
- [ ] G8-T1 StreamValidator throughput on Battlefield baseline
- [ ] G8-T2 Sanitizer hot-path bench
- [ ] G8-T3 Scrubber overhead bench
- [ ] G8-T4 Cold-start / import-cost bench
- [ ] G8-T5 Consolidation + sign-off

## Gate 9 — Distribution / supply chain
- [ ] G9-T1 `pnpm audit --prod` clean at high+
- [ ] G9-T2 License audit
- [ ] G9-T3 CycloneDX SBOM
- [ ] G9-T4 Tarball secret-scan (mirrors HB-1)
- [ ] G9-T5 `.npmignore` / `files` final audit
- [ ] G9-T6 Provenance opt-in docs
- [ ] G9-T7 Dist-tag plan
- [ ] G9-T8 Sign-off

## Gate 10 — Tag + publish + monitoring
- [ ] G10-T1 Senior-QA written sign-off captured
- [ ] G10-T2 Cut `{{VERSION}}` versions
- [ ] G10-T3 Final `pnpm publish -r --dry-run`
- [ ] G10-T4 Tag `v{{VERSION}}` (signed)
- [ ] G10-T5 Push tag to origin
- [ ] G10-T6 `pnpm publish -r` to npm
- [ ] G10-T7 Verify all packages live on npm
- [ ] G10-T8 Post-publish smoke (fresh container)
- [ ] G10-T9 Announce / changelog publish

## Post-publish monitoring (Sprint N+4)
- [ ] PM-1 24h watch
- [ ] PM-2 48h watch
- [ ] PM-3 72h watch + close window
- [ ] PM-4 Triage any P0/P1 consumer issue
- [ ] PM-5 Publish-monitoring report

## Retrospective
- [ ] R-1 Cross-sprint retro
- [ ] R-2 Lessons-learned merge into `team/lessonslearned.md`
- [ ] R-3 v{{NEXT}} backlog seed
- [ ] R-4 Archive `team/qa/{{VERSION}}/` + tag
```

## Summary roll-up

At the top of `02-master-checklist.md` maintain:

```markdown
| Gate | Total | Done | Defects open | Status |
|---|---|---|---|---|
| 1 | {{N}} | {{n}} | {{d}} | green \| yellow \| red |
| ... |
```

Status colors:
- **green** = 100 % complete + 0 defects open
- **yellow** = <100 % complete + 0 P0/P1 defects open
- **red** = ≥1 P0 or P1 defect open OR a hard block unresolved

---

## Worked example — filled state mid-Sprint-52

Showing what the checklist looks like during execution (not pre-execution). Use as the canonical reference for what "in-flight" + "evidence-linked" + "complete" look like.

```markdown
# v1.0.0 Master Checklist

**Last updated:** 2026-06-03T15:20:00Z by Claude `general-purpose` agent (persona: Senior QA engineer)
**Status:** 47 / ~210 items complete (22 %) — Sprint 52 day 4 of 8
**Gates:** 1 / 10 GREEN; 5 / 6 hard blocks closed; 10 / 12 code-review fixes closed
**Packages:** 55 dirs total → 54 publishable → 53 at v1.0.0 ship → 52 connectors/utils + 1 core

## Sprint progression

| Sprint | Goal | Status | % complete |
|---|---|---|---|
| 51 | Fix-list + rc.4 cut + hard blocks + code-review fixes | **complete** | 100 % |
| 52 | Install dry-runs + runtime matrix | **in progress** | 60 % |
| 53 | Connector smoke + security sweep + CLI | not started | 0 % |
| 54 | Docs + perf + supply chain + tag + publish | not started | 0 % |
| 55 | Post-publish monitoring + retrospective | not started | 0 % |

## Gate summary

| Gate | Total tasks | Done | Defects open (P0/P1/P2/P3) | Status |
|---|---|---|---|---|
| 1 | 12 | 12 | 0/0/0/0 | **GREEN** |
| 2 | 9 | 6 | 0/0/1/0 | yellow |
| 3 | 8 | 4 | 0/0/0/1 | yellow |
| 4 | 56 | 0 | 0/0/0/0 | RED (Sprint 53) |
| ... |

## Gate 1 — Package coherence + fixes (Sprint 51 — COMPLETE)

- [x] **G1-T1 — ST-01-001 — Normalize `engines.node` to `>=20.4.0` across 22 stale packages** → `evidence/gate-1/ST-01-001/`
  - [x] bonklm-server → `evidence/gate-1/ST-01-001/bonklm-server-edit.diff`
  - [x] browser-agents-core → `evidence/gate-1/ST-01-001/browser-agents-core-edit.diff`
  - [x] cloudflare-agents-connector → `evidence/gate-1/ST-01-001/cloudflare-agents-edit.diff`
  - [x] daytona-adapter → `evidence/gate-1/ST-01-001/daytona-edit.diff`
  - [~] document-ingest → in progress (agent dispatched 2026-06-01)  ← example of in-progress mark before becoming [x]
  - [!] eko-connector → BLOCKED by D-091 (peer requires Node 20.0) — see `03-defects.md` D-091 ← example of blocked mark
  - (additional rows...)
  - [x] Workspace grep verification → `evidence/gate-1/ST-01-001/2026-06-01T10-15Z_engines-after.json`
- [x] **G1-T2 — ST-01-002 — Add `exports` map to 8 connectors** → all 8 closed
- [x] **G1-T3 — ST-01-003 — Drop `openclaw-adapter`** → closed; CHANGELOG `### Removed` entry merged
- ...

## Gate 2 — Install + publish dry-runs (Sprint 52 — IN PROGRESS)

- [x] G2-T1 — ST-02-001 — `pnpm publish -r --dry-run` on rc.4 → `evidence/gate-2/ST-02-001/dry-run.log`
- [x] G2-T2 — ST-02-002 — Generate 53 tarballs → `evidence/gate-2/ST-02-002/sha-manifest.json`
- [x] G2-T3 — ST-02-003 — Tarball content inventory diff → `evidence/gate-2/ST-02-003/inventory.json`
- [~] G2-T4 — ST-02-004 — Local Verdaccio stand-up + publish rc.4 → in progress (Battlefield container restarting)
- [ ] G2-T5 — ST-02-005 — Consumer-app install harness (clean Node 20.4 container) → blocked on G2-T4
- ...

## Hard blocks roll-up

- [x] **HB-1 — ST-05-001 — Zero secrets in any tarball** (Sprint 51) → `evidence/gate-5/ST-05-001/gitleaks.json` 0 findings
- [x] **HB-2 — ST-05-002 — Override-token replay-cache starvation patched** (Sprint 51) → `evidence/gate-5/ST-05-002/retest-D-002.log`
- [x] **HB-3 — ST-05-003 — `sanitizeLogString` hex-escapes U+202E + bidi range** (Sprint 51) → `evidence/gate-5/ST-05-003/bidi-regression.json`
- [x] **HB-4 — ST-05-004 — `HookSandbox.SAFE_GLOBALS` excludes host timers** (Sprint 51) → `evidence/gate-5/ST-05-004/sandbox-test.log`
- [x] **HB-5 — ST-05-005 — `BufferedTelemetryCollector.flush()` uses `serializeError`** (Sprint 51) → `evidence/gate-5/ST-05-005/telemetry-flush.log`
- [ ] **HB-6 — ST-09-001 — `pnpm audit --prod --audit-level=high` clean** (Sprint 54)

(remainder of checklist follows the same pattern...)
```

### How to read the worked example

- **[x] = complete + evidence-linked.** The closing bracket has a tick AND an evidence path follows the row. Per `policies/entry-exit-criteria.md` exit #2, no [x] is complete without a resolving evidence link.
- **[~] = in-progress.** Owner has the task; expected completion stated.
- **[!] = blocked.** Defect ID stated; the row will not move to [x] until the blocking defect closes.
- **[ ] = open.** Not yet pulled into a sprint, OR pulled but agent not yet dispatched.
- **[a] = accepted.** Only valid for P2/P3 defects with senior-QA + maintainer sign-off in `04-risk-register.md`. P0/P1 NEVER use [a].

The "Last updated" + "Status" header lines are mechanically maintainable via `team/qa/scripts/count-checkboxes.sh` — run nightly and let the script update the percentage.
