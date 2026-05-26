# Legacy QA Artifacts Index

This document catalogs the pre-BR-QAF QA artifacts under `team/qa/`. Authored 2026-05-25 as part of the BR-QAF v1.0 rollout (audit gap G10).

## Status taxonomy

- **superseded** — replaced by a BR-QAF equivalent; the legacy artifact is kept for historical reference but should NOT be used to drive new work
- **active** — still consulted (e.g. helper script, env template); BR-QAF references it OR it lives alongside BR-QAF
- **archived** — historical only; no longer consulted; safe to move to `team/backups/qa-legacy/` at next housekeeping

## Pre-BR-QAF artifacts

### Plans + meta

| File | Status | BR-QAF equivalent / disposition |
|---|---|---|
| `README.md` | superseded (banner added pointing to `framework/README.md`) | `framework/README.md` is the new entry point |
| `2026-05-25-v1.0.0-publish-qa-plan.md` (1196 lines, original draft) | superseded | `1.0.0/00-meta-plan.md` (revised) supersedes; original retained for blame / audit |
| `sprint-33-rc3-qa.md` | archived | Sprint-33-specific; no migration needed |
| `connector-integration-test-plan.md` | superseded | `1.0.0/07-connectors-matrix.md` + `1.0.0/07b-per-symbol-matrices.md` |
| `connector-test-quick-start.md` | superseded | `1.0.0/RUNBOOK-DAY-1.md` § C.2 + `framework/templates/per-connector-template.md` |
| `connector-testing-status.md` | archived | February 2026 status snapshot; superseded by master-checklist |
| `connector-testing-summary.md` | archived | Same as above |
| `connector-testing-report-2026-02-18.md` | archived | Historical record of February run; useful as prior-art for Gate 4 |
| `test-strategy.md` | superseded | `framework/policies/entry-exit-criteria.md` + gate templates |
| `uat-plan.md` | superseded | `1.0.0/08-uat-plan.md` + `framework/templates/uat-scenario-template.md` |
| `uat-checklist.md` | superseded | `1.0.0/02-master-checklist.md` (Gate 4 + UAT rows) |
| `uat-quick-start.md` | superseded | `1.0.0/RUNBOOK-DAY-1.md` § C.2 |

### Review reports (one-off historical)

| File | Status | Date | Notes |
|---|---|---|---|
| `CODE-REVIEW-SUMMARY.md` | archived | Feb 23 2026 | Historical |
| `FINDINGS-CODE-REVIEW.md` | archived | Feb 21 2026 | 12 audit findings — many closed in Sprints 42-50 (see `team/lessonslearned.md`) |
| `FINDINGS-E1-FOUNDATION.md` | archived | Feb 21 2026 | Epic 1 findings — closed |
| `attack-logger-verification-report.md` | archived | Feb 20 2026 | logger pkg verification — superseded by Gate 4 ST-04-049 |
| `bundle-size-analysis.md` | active (reference) | Feb 21 2026 | Useful baseline for Gate 2 G2-T8 (ESM consumer + tree-shake) |
| `cli-documentation-review.md` | archived | Feb 21 2026 | |
| `code-documentation-review.md` | archived | Feb 21 2026 | |
| `code-review-phase2-configuration.md` | archived | Feb 20 2026 | |
| `epic4-connector-review-report.md` | archived | Feb 21 2026 | |
| `examples-documentation-review.md` | archived | Feb 21 2026 | |
| `express-middleware-review.md` | archived | Feb 21 2026 | Per-connector — superseded by `1.0.0/07b-per-symbol-matrices.md` row |
| `fastify-plugin-review.md` | archived | Feb 21 2026 | Same |
| `linting-config-report.md` | archived | Feb 21 2026 | |
| `logger-package-review.md` | archived | Feb 21 2026 | |
| `main-documentation-review.md` | archived | Feb 21 2026 | |
| `nestjs-module-review.md` | archived | Feb 21 2026 | |
| `package-documentation-review.md` | archived | Feb 21 2026 | |
| `performance-testing-review.md` | archived | Feb 21 2026 | Useful prior-art for Gate 8 perf baseline |
| `test-infrastructure-review.md` | archived | Feb 21 2026 | |
| `test-quality-analysis.md` | archived | Feb 21 2026 | |
| `test-stability-review.md` | archived | Feb 21 2026 | |
| `typescript-config-report.md` | archived | Feb 21 2026 | |

### Helper scripts (still active where useful)

| File | Status | Notes |
|---|---|---|
| `setup-dev-env.sh` | active | Pre-BR-QAF env setup; complemented by `framework/TOOLS.md` `install-tools-*.sh` |
| `test-connections-simple.sh` | active | Useful for quick connector-connection smoke; not part of formal Gate 4 |
| `test-real-connections.sh` | active | Same — quick smoke |
| `run-all-connector-tests.sh` | active | Used in February test runs; superseded by per-connector `pnpm --filter ... test` |

### Infrastructure templates

| File | Status | Notes |
|---|---|---|
| `docker-compose.vector-db.yml` | active | Mirror of the Battlefield `vector` profile for local dev; cross-reference in `framework/policies/battlefield-degraded-mode.md` |
| `.env.connector-test.template` | active | Template for connector test env vars (API keys + DB URLs); BR-QAF UAT scenarios use it |

## Migration path

A future house-cleaning sprint may:

1. Move `archived` files to `team/backups/qa-legacy/2026-Q1-pre-BR-QAF/`
2. Compress to `team/backups/qa-legacy-2026Q1.tar.zst`
3. Update this LEGACY.md to point to the archive location

This is deferred to a v1.0.1 backlog item. Not v1.0.0 scope.

## How to use this index

- **New work:** use BR-QAF (`team/qa/framework/` + `team/qa/1.0.0/`). Do NOT base new work on `superseded` or `archived` artifacts.
- **Historical reference:** if researching how a defect was found in February or what the rc.3 baseline test counts were, the archived artifacts are the source.
- **Prior art for Gate 8 + Gate 2:** `bundle-size-analysis.md` and `performance-testing-review.md` predate BR-QAF but contain reusable benchmark methodology. Cite where useful.

## Cross-references

- BR-QAF framework: `framework/README.md`
- BR-QAF v1.0.0 instance: `1.0.0/README.md`
- Original v1.0.0 plan (pre-BR-QAF, kept for blame): `2026-05-25-v1.0.0-publish-qa-plan.md`
