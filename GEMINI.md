<!-- GENERATED — canonical is AGENTS.md (Infra/scripts/gen_rules.py). Do not edit. -->

> See `AGENTS.md` (canonical). Generated for Gemini CLI from the same rule source.

## Tier 0 — Blocking (CI + pre-commit hard-fail)

### Never commit secrets

Never hardcode or commit secrets, API keys, tokens, PII, or `.env` files. Supply secrets via
env vars or the secret manager (Vault); commit only `.env.example`. Reference secrets by
name/path, never by value.

### Secret scan, zero tolerance

Run a secret/security scan before every commit. Resolve **every** finding including
medium/low before committing — no postponing, no suppressing without written justification.

### Conventional Commits

Commit messages follow Conventional Commits: `<type>(<scope>): <description>`, imperative,
subject <=72 chars. Types: feat, fix, refactor, docs, test, chore, perf, ci, build, style.
Scope optional but encouraged. Trailers (Agent/Task/D-NNN) are opt-in repo overlays.

### Many small files

Prefer many small, feature-scoped files over few large ones. Files: soft 200-400 lines,
**hard cap 800** (extract before the cap). Functions < 50 lines. No nesting > 4 levels.
Create each file in its final folder; no root stragglers.

### Test everything changed

Write tests for everything built/fixed/changed before closing a task. Cover edge cases,
**behavioral regressions (a test that still passes with the fix removed is not a regression
test)**, flow paths, and auth/permission gaps. Coverage target is set per `rules_profile`
(see the profile rule).

### Strict lint + typecheck

Run strict lint + format + type-check before commit. No `any`/untyped escapes without
justification. No dead code (remove, don't comment out). Enforced by a pre-commit hook.

## Tier 1 — Required (review-gated)

### Worktree isolation (hardcoded per CLAUDE.md)

All coding work on BonkLM happens in a dedicated git worktree — **one worktree per PR/branch, no exceptions**. This is not a best practice; it is hardcoded in the Definition of Done (CLAUDE.md, 2026-05-28).

**Workflow:**
1. Create the worktree **outside the repo** (e.g., sibling directory): `git worktree add ../bonklm-<slug> -b <type>/<slug>` where branch name follows commit-type convention (feat/, fix/, refactor/, docs/, etc.).
2. All work — edits, quality-gate runs, commits, push, PR — happens inside that worktree.
3. Clean up on merge: `git worktree remove ../bonklm-<slug>`, then `git branch -d <branch>` and prune stale metadata with `git worktree prune`.
4. Never leave orphaned worktrees. If a PR is abandoned, remove its worktree immediately.

The primary working tree stays on its base branch and clean — it is always a safe, known-good reference and parallel work never collides.

### Profile: library-oss

**OSS / published libraries.** TDD mandatory (RED -> GREEN -> REFACTOR). Coverage =
**diff-100% (line+branch) on touched code + 80% repo floor**, evidence attached. File cap soft
200-400 / hard 800. One-branch-per-PR. Deploy: npm `--tag next` (staging) -> `--tag latest` on
`v*` (prod). Tier-0 additionally requires a **license + SBOM + OSS/SaaS-boundary** scan. See
CONFLICTS.md (Infra/docs/rules/CONFLICTS.md).

### Security disclosure policy (hardcoded per CLAUDE.md)

**NEVER document security incidents in any public artifact.** This is hardcoded in CLAUDE.md (2026-05-27) in response to a real incident.

**Public artifacts that MUST NOT carry security incident details:**
- `CHANGELOG.md` (ships to npm consumers + visible on GitHub)
- Per-package `README.md` (ships in npm tarball)
- `docs/` directory (ships on the public docs site)
- Public commit messages (visible on GitHub)
- Public PR / Issue descriptions
- Any file outside the gitignored `team/` directory

**Prohibited content in public artifacts:**
- Specific scan-tool finding counts ("1 TRUE POSITIVE", "1,984 findings")
- Verbatim or partial leaked-secret values (`sk-ant-api03-...`, even after rotation)
- File paths to fixtures containing real secrets (`demo/<path>/.env.demo`)
- Defect IDs mapping to security incidents (`D-008`, etc.)
- Rotation timelines or remediation specifics
- Tool versions used in the scan ("gitleaks v8.30.1")
- Commit SHAs of incident-related changes

**Allowed public messaging (CHANGELOG only):**
"Hardened sanitizer", "Added regression coverage for known attack class", "Closed audit finding from internal review". These reference the fix, not the incident.

**Security-incident tracking (gitignored `team/` only):**
- `team/qa/<version>/03-defects.md` — full defect rows with evidence
- `team/qa/<version>/standups/` — coordinator standups
- `team/lessonslearned.md` — internal post-mortem
- `team/qa/<version>/evidence/` — full scan-output capture

**Remediation for past public disclosures:** History rewrite (`git filter-repo`) is the appropriate remediation. Force-push to `main` is the exception pattern sanctioned for security incidents.

### Factual integrity

Never invent facts to fill a gap — identifiers, IDs, names, dates, metrics, hosts, customers,
quotes, config keys. If unknown: write `[unknown]`, omit, or ask. Confirm a value exists in
memory / repo / git config / tool output before claiming it. Applies to code, comments,
commits, docs, EPIC briefs, and agent handovers — anywhere user-facing.

### Single-version monorepo (52 publishable packages version-locked)

BonkLM is a single-version monorepo: **all 52 publishable packages share the same version** in their `package.json` manifests. The current release line is `1.0.0-rc.4`. This invariant is enforced, not documented.

**Canonical version source:** `packages/core/package.json` (the main library, `@blackunicorn/bonklm`). When the release line moves, update in this order:
1. `packages/core/package.json`
2. Root `package.json` (private, repo metadata)
3. `CHANGELOG.md` (add new `[x.y.z] — YYYY-MM-DD` section)
4. `RELEASE-NOTES.md` (top-of-file "Latest release" line + CHANGELOG anchor)
5. `docs/user/package-matrix.md` (header + footer version stamps)
6. `docs/architecture.md` (header `Project version:` line)
7. `docs/user/public-api-surface.md`, `docs/user/known-limitations.md`, `docs/user/threat-surfaces.md` (any "current release" labels only)

**Linked changesets enforcement:** The `.changeset/config.json` `linked` array enumerates all 52 publishable package names. This invariant is **enforced by CI** (`pnpm run check:changeset-linked`, `tools/check-changeset-linked.js`) — a newly added connector that is not linked breaks the build until `linked` is regenerated. The two private packages (`@blackunicorn/bonklm-openclaw`, `@blackunicorn/bonklm-wizard`) are excluded; `@blackunicorn/bonklm-wizard` is additionally listed under `ignore` in changeset config and **not** published.

**For any user-visible change,** add a changeset: `pnpm changeset:add`. Pick affected package(s) and bump type (`patch` / `minor` / `major`). Changesets land in `.changeset/<name>.md` and are committed alongside your code.

### Adversarial senior-persona review loop

Before every PR run the DA KALITAS six-persona audit loop: senior developer, architect,
adversarial/red-team, security, documentation, and adherence/process. All six are mandatory;
none may be downgraded to optional because the work looks small, technical, or non-documentary.
Each assumes a junior wrote it and all prior gates failed. Reviewers research/review only —
never modify files. Loop until a clean pass with zero open findings, including LOW. Add
specialist reviewers for performance, legal, UX, data, release, or domain-specific risk when
needed; specialist reviewers are additive and never replace any of the six.

### Coverage ratchet — core 82/86/76/82, connectors 60% floor

Coverage thresholds in `vitest.config.ts` are a **ratchet floor** — they only move up, never down. Per CLAUDE.md and CONTRIBUTING.md, 100% coverage is the standard; less is not acceptable.

**Enforced thresholds by scope:**
| Scope | Lines | Functions | Branches | Statements |
|-------|-------|-----------|----------|------------|
| Global floor | 60% | 60% | 50% | 60% |
| `packages/core/src/**/*.ts` | 82% | 86% | 76% | 82% |
| `packages/core/src/testing/**` | 60% | 60% | 50% | 60% |
| `tools/check-changeset-linked.js` | 100% | 100% | 100% | 100% |
| `tools/check-workspace-policy.js` | 100% | 100% | 100% | 100% |
| `tools/check-ee-boundary.js` | 100% | 100% | 100% | 100% |

Core package thresholds were ratcheted 2026-05-28 (from 80/80/75/80 to 82/86/76/82) after restoring coverage on three `src/` files and adding unit + regression suites for content-extractor, adapt-validator, wrap-sentinel, and portable-emitter. Measured aggregate at ratchet: lines 83.29 / statements 82.98 / branches 76.18 / functions 87.54. Floors sit ~1pp below to absorb normal churn.

Connectors use a relaxed 60% floor — they catch wire-up regressions (e.g., missing `hasUnvalidatedTail()` calls) without requiring full unit coverage of mocked SDK paths.

**Tests must fail when the fix is removed.** A test that still passes after sanitizer / guard removal is not a regression test — it is a happy-path test. Integration tests are preferred over contract-lock tests for catching regressions.

### CWE-117 log sanitization — sanitizeLogString + sanitizeMeta canonical

Every `logger.*` call, OTel `span.add*` call, synthetic `GuardrailResult.findings[].description`, HTTP response body, or other log-emit site must sanitize attacker-influenceable strings. This is defined in ADR-0001 (`docs/contributing/adr/0001-log-sanitization.md`).

**Canonical primitive:** `sanitizeLogString` from `packages/core/src/common/index.ts`.

**When to apply:**
- Does the template literal interpolate any string from user input (request body, file content, validator output, file path, validator-thrown `error.message`)? → Wrap with `sanitizeLogString` (or `sanitizeMeta` at connector boundaries).
- Does the meta object include any string-typed value with the same origin? → Wrap that field's value.
- Does the OTel span attribute carry such a string? → Wrap.
- Does a synthetic `GuardrailResult` finding `description` embed `String(error)` or any caught value? Prefer `sanitizeLogString(serializeError(error).message)` for consistency.
- Does a `logger.warn`/`logger.error` meta carry a raw `error` value? Use `{ error: serializeError(error) }` — bare `{ error }` renders as `error={}` post-JSON.stringify.

**`sanitizeLogString` coverage:**
- Hex-escapes `\x00–\x09`, `\x0B–\x1F`, `\x7F–\x9F` (DEL + C1 control range) to `\xNN` markers.
- Replaces `\r\n` / `\n` / `\r` / `U+2028` / `U+2029` with literal `\n` marker.
- Hex-escapes bidi-override (`U+202A–U+202E`) and bidi-isolate (`U+2066–U+2069`) code points.
- Hex-escapes zero-width / Unicode-format class (`U+061C`, `U+200B–U+200F`, `U+2060–U+2064`, `U+FEFF`) to preserve forensic signal.
- Caps output at 500 chars + appends `…[truncated]` marker.

**Do NOT use `stripLogControlChars`** (marked `@deprecated`; kept `@public` through v1.x for rc.1–rc.3 importers; v2.0 removes it). Internal callers migrated to `sanitizeLogString` ahead of v1.0.0-rc.4.

**Audit checklist:** When you add any log emit or re-touch a file for any reason, re-run the sink-pattern grep on the whole file, not just the touched region (Sprint 45 lesson).

### OSS / EE boundary segregation

Keep OSS/community and EE/source-available/commercial surfaces segregated in work items,
branches, commits, artifacts, data, docs, tests, dashboards, and releases. A PR must not mix OSS
and EE changes unless the story explicitly exists to move code across that boundary and documents
the license, data, package, and publication impact. Public/export releases require an allowlist
check, license/SBOM review, secret scan, and human approval before publication.

### Brand and contact canon

Use `BlackUnicorn` as the only accepted brand spelling in all new or updated project, product,
marketing, documentation, release, dashboard, and agent-facing text. Do not use space-separated or
legacy security-suffix brand variants except when preserving an immutable external identifier that
cannot be changed safely. Use `info@blackunicorn.tech` as the only accepted public/contact email
address.

### Design system fidelity — latest in-repo system, approved assets, no cross-project mixing

For marketing sites and any design/UI work, the repo's **current design system is the single
source of visual truth**. When a design system is present (design tokens, theme, component
library, or style guide), build from it — never introduce ad-hoc colors, spacing, typography, or
one-off components that bypass it. Always reference the **latest** version in the repo; if the
system itself is wrong, change the system, not the individual page.

**Approved assets only.** Use only approved and promoted logos, icons, and brand marks from the
repo's sanctioned asset set. Never ship draft, placeholder, unapproved, or externally-sourced
logos or icons; if a needed asset is missing, get it promoted into the approved set first. Pairs
with `brand-contact-canon` (brand spelling + contact) for the verbal side of the brand.

**Never mix design systems across projects.** Each project's UI renders only its own design
system. Do not import another fleet project's tokens, components, themes, logos, or icons into a
different project's surface (e.g. no DojoLM marks on the Runelm site, no BUCC components in
Egidia). Legitimate cross-project visual reuse goes through a shared, versioned design package —
never copy-paste between project surfaces.

### Project PRD and source of truth

Every first-party project must maintain a PRD and a single project source-of-truth document. The
source of truth owns product features, edition boundaries, metrics, KPIs, claims, roadmap state,
and dependent-project inputs. Closing gates must update it when behavior, positioning, metrics,
publication status, or cross-project dependencies change. Dependent projects, including marketing
sites, must read and reference it instead of inventing or duplicating project facts.

### Cross-project data flywheel — governed contracts

Fleet products feed each other (DojoLM attacks → BonkLM defenses → BUCC prod feedback → BonkLM;
Runelm corpus → BonkLM PII QA; DojoLM/Sensei red-team ↔ corpus). Treat every such cross-project data
flow as a **declared, versioned data contract**, never an ad-hoc pipe. A contract names the source
artifact + its classification (`public-safe | internal | EE | customer | classified/DSP-high`) and
license/edition, the required transform, the consumer + its ingest acceptance gate, a hash-pinned
provenance version, and a freshness SLA. A PR that produces or consumes a flywheel artifact is
incomplete until its contract is created/updated.

Hard red lines: **no EE / customer / classified / DSP-high data enters an OSS corpus or an
OSS-released model without Runelm pseudonymization AND human sign-off** (DSP-high `oc-finance` data is
L1-only and never leaves its trust boundary at all); no cross-edition corpus contamination
(community Apache ↔ enterprise BSL/BUSL); no model trained on unlicensed or cross-edition data; no
train-on-own-output without a held-out, human-verified eval set (collapse/poisoning guard). Offensive
models (e.g. Sensei) are internal/EE controlled assets — never OSS-released raw, never an open
attack-generation service. The DA KALITAS security + adversarial personas own the leakage/poisoning
check at the closing gate.

### Shipping lanes are triggered by GitHub Releases, not by push

Every distribution lane — npm / PyPI package publish, Docker/OCI image build + push,
container-registry tags, binary or GitHub-Release assets — is triggered by a **published
GitHub Release** (a semver tag), never by push-to-main, by merge, or by an ad-hoc manual run.
The Release is the single lifecycle gate: CI fans out from it to every lane so one tag ships
all artifacts consistently and their versions stay in lockstep. Pre-release / canary artifacts
ship only from prerelease tags (`-rc`, `-beta`), are clearly marked as such, and never land on
a stable channel.

The version is derived from Conventional Commits → semver; the Release is cut from `main` (or a
release branch); and the publish job is the **only** place registry credentials / tokens are
used (no tokens in build or test jobs). Public / export releases additionally pass the
edition-boundary export gate **before** any lane runs — allowlist + license/SBOM review + secret
scan + human approval (see `edition-boundary-segregation`). Marketing-site deploys follow their
own manual-promote profile rule and are out of scope here.

### Model training — recipe, base SSOT, provenance, process gates, asset class

The fleet's fine-tuned models (Marfaak, Shogun, Sensei, Basileak, and any future model) are governed
engineering artifacts. Every training round is a **declared recipe** — base reference, fine-tune method +
hyperparameters, dataset mix + template, and the **hash-pinned** corpus it trained on — recorded in the
model's repo and its `model_registry` entry. A PR that produces a model or a training run is incomplete
until that recipe + its data contract exist.

**Base model is a single, globally-updatable parameter.** No recipe hardcodes a base. The go-forward base
is declared once in `inventory/models.yml` (`current_base`, today `Qwen/Qwen3.6-27B`), which drives the
BUCC `model_registry`; train configs + Modelfiles are **generated** from it. A new release is a one-line
SSOT change + regenerate. The **only** exception is an intentionally-vulnerable published target
(Basileak), deliberately pinned weak in `models.yml`.

**Objective.** SFT fits demonstrations; behaviour/preference failures (mode-switching, enumeration,
identity) MUST be addressed with a **DPO (or ORPO/KTO) preference stage** built from labelled negatives —
never SFT alone. Offensive models (Sensei) do persona via SFT+DPO first, then only a **light, late GRPO**
pass scoped to the refusal boundary — never GRPO as the primary trainer.

**Process gates** (every round MUST): ship a `dataset_info.json` (count + SHA256 of sorted entries +
source + license + date) and reference a hash-pinned corpus, not a mutable dir; pass a **semantic-dedup +
train/test-decontamination** gate against a **locked held-out test set** that never appears in training;
keep dataset oversampling `weight × max_samples / epochs / entries < 30×` (fail validation otherwise);
evaluate via the **deployment engine (Ollama API)** with a pinned judge model+version, **not** HF-transformers
alone; be **blocked from export by CI** if any scored category drops >5 pts vs the prior round without a
pre-filed RCA (no-collapse); pin the Modelfile (stop tokens + temp/top_p/num_predict, not runtime-overridable
for scored deployments); log to an **experiment tracker** (SwanLab/Trackio); and register in
`model_registry.json` (base id+hash, LoRA cfg, best score, known issues, export paths) with an
auto-generated model card carrying an explicit **license** + intended-use block before release.

**Recipe + toolchain.** LoRA is the default; target shape follows base size — attention-only for large/MoE,
all-linear for dense; on dense bases prefer `use_rslora` at rank 96-128. The training framework is
LLaMA-Factory (a release supporting the target base — v0.9.5 cannot train Qwen3.6); Unsloth is used only as
its `use_unsloth` backend, A/B-gated, never standalone. On NVIDIA GB10/Blackwell-ARM (`sm_121a`, CUDA-13):
**bf16 LoRA is the default** (quality-preserving); 4-bit QLoRA/bitsandbytes is *functional* on `sm_121a`
but immature (ARM + CUDA-13 wheels often missing → NGC/source build, documented OOM caveats) — keep it
**non-default, justify use**. Pin the NGC container + transformers v5 + `causal_conv1d`/`fla`;
set `attn_implementation` explicitly (`sdpa` or FA2-for-sm120) and **never `pip install flash-attn`**;
`num_workers=0`. Generation config sets `"think": false` for Qwen3.6 bases (a generation parameter, NOT the
`qwen3_nothink` template); `seed` + framework/PyTorch/transformers/peft versions are asserted in config.

Hard red lines (extend `data-flywheel-contract`): **no model trained on unlicensed or cross-edition data**
— auxiliary/OSS corpora pass the same competitor-name / format-artifact / license-attestation audit as
proprietary data, and **GPT-distilled corpora are removed from any published artifact** and regenerated
on-box; no classified / customer / DSP-high data enters a model without Runelm pseudonymization AND human
sign-off (DSP-high `oc-finance` never enters a model; classified agents `oc-bo-*`/`oc-sp-*` excluded); **no
train-on-own-output without a held-out, human-verified eval set** (collapse/poisoning guard); offensive
models are controlled assets carrying an AUP + a lawful-use boundary, MUST ship a **harm-refusal eval**
(multi-turn red-team — single-turn is insufficient), and carry the **EU AI Act Art.53(1)(d)** training-data
summary + transparency (these small LoRAs are **not** Art.55 systemic-risk GPAI — do not over-scope). The
DA KALITAS security + adversarial personas own the leakage/poisoning/eval-contamination check at the
closing gate; a legal specialist reviewer joins for any offensive/dual-use model.

### tools/* workspace policy — Tier A (private) default, Tier B (publishable) explicit

`tools/` houses BonkLM's internal tooling packages (ESLint plugins, CI scripts, audit baselines). These are NOT consumer-facing. This policy is enforced, not documented.

**Tier A (default — INTERNAL-ONLY):**
- `package.json` MUST contain `"private": true`
- Consumed only via monorepo workspace `devDependencies` (e.g., `"@blackunicorn/eslint-plugin-edge": "workspace:*"`)
- MUST NOT appear in any `packages/*/package.json`'s `dependencies`, `peerDependencies`, or `optionalDependencies` — only `devDependencies`
- Right for: CI scripts (`tools/check-workspace-policy.js`), audit baselines, internal codegen, internal lint-rule sets

**Tier B (explicit opt-in — PUBLISHABLE):**
- `package.json` MUST NOT contain `"private": true` (omit or set `"private": false`)
- MUST contain `"workspacePolicy": "tier-b-publishable"`
- MUST contain `"publishJustification": "<reason>"` explaining why (e.g., "ESLint plugin for downstream connector authors")
- MUST contain `"files": [...]` explicitly enumerating the npm tarball contents (exclude internal allowlists, fixtures, baselines)
- MUST contain scoped `"name"` starting with `@blackunicorn/`

**Programmatic enforcement:** `tools/check-workspace-policy.js` enumerates every `tools/*/package.json` and asserts:
1. EITHER `"private": true` (Tier A) OR complete Tier B declaration
2. NO `packages/*/package.json` lists a Tier A tool in runtime dependencies

The gate runs in CI (the `workspace-policy` job in `.github/workflows/ci.yml`), the local quality gate (`scripts/quality-gate.sh`), and via `pnpm run check:workspace-policy`. Violations exit non-zero and fail the build. The gate's own branches are covered to 100% per `vitest.config.ts`.

**Reviewer checklist for new `tools/<name>/` additions:**
- [ ] Tier declaration (A or B) stated in PR description
- [ ] Tier A: `private: true` in `package.json`
- [ ] Tier B: `workspacePolicy`, `publishJustification`, `files`, scoped `name` all present
- [ ] No consumer packages list the new tool as `dependencies` / `peerDependencies`
- [ ] Tools-vs-packages placement justified in PR description
- [ ] `tools/check-workspace-policy.js` CI step PASSES

### Docs are part of done

Docs are part of "done". In the same PR update user docs, project docs (mark the story /
changelog), and technical docs (ADR / JSDoc / TSDoc). Update the closest source-of-truth doc
when behavior changes. Every ticked checklist item is audited against real code, not signed
off blind.

### OSS↔EE license boundary CI guard per ADR-0007

BonkLM uses an open-core model: Apache-2.0 community core (`packages/*`) and future BSL-1.1 enterprise tier (`packages/bonklm-ee/*`). One invariant is load-bearing:

> `packages/core` and every Apache-tier package MUST build, type-check, and pass tests with the entire `packages/bonklm-ee/*` tree absent.

This is enforced by a dependency-free Node gate: `tools/check-ee-boundary.js`, wired into CI (`.github/workflows/ci.yml`, the `ee-boundary` job), root scripts (`pnpm run check:ee-boundary`), and the local quality gate (`scripts/quality-gate.sh`).

**License classification:** Every `packages/*` manifest must declare a recognized `license`:
- `Apache-2.0` (OSS)
- `BUSL-1.1` or `LicenseRef-BSL-1.1` (EE — stored as `BUSL-1.1` per SPDX)

Missing / unknown license, or missing `name` field, is an error. Classification is never skipped: a package that escapes classification could also escape the boundary check.

**Boundary guard (imports + declared deps):** For every OSS package:
1. Scan source tree and fail if any file imports an EE package — statically (`… from '…'`, including `import type` and `export * from`; side-effect `import '…'`) or dynamically (`import('…')`)
2. Fail if `package.json` names an EE package in `dependencies`, `peerDependencies`, or `optionalDependencies` — a declared dependency drags EE into `pnpm install` even with no source import
3. Non-literal dynamic `import()` in an OSS package is fail-closed only once at least one EE package exists; with zero EE packages a computed specifier cannot reach an EE target

**Scope:** Type-only `import type … from <EE>` is flagged on purpose — the open core must not even _name_ an EE package. CommonJS `require()` is out of scope (core is ESM-only). Example apps (`packages/<x>/examples/`) and `tools/*` are out of scope.

**Current state:** Today's all-Apache tree reports zero EE, zero violations, negligible CI time. The self-host gateway `@blackunicorn/bonklm-server` has zero EE edges.

**Enforced coverage:** `tools/check-ee-boundary.js` is pinned to 100% test coverage in `vitest.config.ts`, matching other release-surface structural gates (changeset-linked, workspace-policy).

### Handover cadence

Offer a self-contained cold-start handover after every PR/session. Every 5 PRs, auto-generate
the handover and start a fresh session for context hygiene.

## Tier 2 — Advisory (justify deviation)

### Immutability

Always create new objects; never mutate existing or shared state. Prefer frozen/immutable
models where the language supports it (`@dataclass(frozen=True)`, Pydantic `frozen=True`,
`readonly`/`as const`).

### Validate at boundaries

Validate input at system boundaries with schema-based validation (Zod / Pydantic / JSON
Schema). Fail fast with clear messages. Use parameterized queries (no raw SQL interpolation).
Prevent XSS. Apply rate limiting. Error messages must not leak data.

### Foreground research-only subagents

Subagents are for research/review only — the orchestrating agent applies all changes.
Dispatch in the foreground (never spawn-and-idle); run independent reviewers in parallel;
report progress about every ~4 minutes. Prefer deterministic tool calls (Read/Grep/Glob) over
agents for simple lookups.

## Tier 3 — Context

### Acquire context before coding

Before writing code: read existing docs / architecture / ADRs, read the exact files you'll
touch plus their callers and prior art, check the knowledge base first (lessons-learned, prior
QA, git log), align to a real current EPIC/story (create one if none), and restate the goal in
one sentence.

### This repo

- product: BonkLM · profile: library-oss · ring: agent · canonical: prometheus-pi
- deploy: library (staging: npm --tag next (prerelease) · prod: npm --tag latest + GitHub Release (on v* tag))
