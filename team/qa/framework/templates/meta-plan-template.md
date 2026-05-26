# Meta-Plan Template — BonkLM Release QA

Copy this file to `team/qa/<version>/00-meta-plan.md` and fill `{{PLACEHOLDERS}}`.

## Front matter

| Field | Value |
|---|---|
| Version target | `{{VERSION}}` |
| Authored | `{{DATE}}` |
| HEAD at authoring | `{{HEAD_SHA}}` |
| RC baseline | `{{PREVIOUS_RC_TAG}}` |
| Sprint window | `{{SPRINTS}}` (e.g. 51-55) |
| Senior QA reviewer | `{{ROLE}}` |
| Framework version | BR-QAF v1.0 |

## Table of contents

1. [Gate 1 — Package coherence](#gate-1)
2. [Gate 2 — Install + publish dry-runs](#gate-2)
3. [Gate 3 — Runtime matrix smoke](#gate-3)
4. [Gate 4 — Connector smoke matrix](#gate-4)
5. [Gate 5 — Security regression sweep](#gate-5)
   - 5.1 CWE-117 variable-binding-site sweep
   - 5.2 Prototype-pollution / secure-json-parse coverage
   - 5.3 sanitizeMeta hostile-toString fail-closure
   - 5.4 Prompt-injection attack corpus
   - 5.5 Jailbreak / secret / PII / XSS / command-injection guards
   - 5.6+ Release-specific sub-gates (see `09-security-addendum.md`)
6. [Gate 6 — CLI smoke](#gate-6)
7. [Gate 7 — Documentation validity](#gate-7)
8. [Gate 8 — Performance gates](#gate-8)
9. [Gate 9 — Distribution / supply chain](#gate-9)
10. [Gate 10 — Final gates before tag + publish](#gate-10)
11. Execution order + dependency graph
12. Open questions (decisions register)
13. Sprint mapping
14. Out-of-scope

## Gate template

Every gate uses this shape. Copy the block per gate.

```markdown
## Gate {{N}} — {{NAME}}

### Test surface
- {{Files / commands / scenarios this gate covers — cite paths + line numbers}}

### PASS criteria (binary)
1. {{Specific, measurable, evidence-linked criterion}}
2. ...

### Owner
- {{Claude agent type / external tool / human role}}
- Failure-mode escalation owner: {{Role}}

### Effort
- S (<1 sprint) | M (1 sprint) | L (multi-sprint)

### Blockers
- {{Anything requiring user decision OR external prerequisite}}

### Failure-mode triage
- If criterion N fails: {{specific remediation path; story ID to escalate to}}

### Evidence location
- `team/qa/{{VERSION}}/evidence/gate-{{N}}/`
- Required artifacts: {{list}}

### Sprint
- Sprint {{S}}

### Stories
- ST-{{N}}-001 …
```

## Universal gate definitions (instantiate per release)

### Gate 1 — Package coherence

Test surface covers: version consistency across all `packages/*/package.json`; `exports` map subpath resolution under strict TS (`bundler` + `node16` + `nodenext`); types-resolution from a fresh external consumer; `bin/*` shebang + executable bit in the published tarball; CHANGELOG accuracy (every Sprint-N commit reflected, every public-API change documented); LICENSE present per package; README present + non-trivial per publishable package; `engines.node` declared identically across packages; `files` whitelist excludes `team/`, `tests/`, `src/`, `.env*`, source-maps.

PASS criteria binary checks for: `pnpm typecheck` clean; all packages at target version; all 8 declared core subpaths resolve under strict TS; per-package LICENSE present; per-package README present; `engines.node` unanimous; `files` whitelist clean.

### Gate 2 — Install + publish dry-runs

Test surface covers: `pnpm publish -r --dry-run` clean per package; `npm pack` tarball content audit (no team/, no .env, no test fixtures, no .DS_Store, no screenshots, no source-maps); tarball size reasonable; SBOM generation; npm-provenance posture (note: GH Actions deactivated by default — document the constraint).

### Gate 3 — Runtime matrix smoke

Test surface covers: Node LTS minor versions in support window (currently 20, 22, 24); edge runtimes for `./edge` exports subpath (Workerd / edge-light / Deno / Bun); ESM-only — document CJS-consumer fallback.

### Gate 4 — Connector smoke matrix

Test surface covers: every publishable connector × (install + minimal hello-world + one ALLOW + one BLOCK). Per-connector dedicated test plan in `07-connectors-matrix.md`. Framework middleware (Express / Fastify / Nest / Hono / Elysia / Next.js / Cloudflare) against running test servers. Cloud-only SDKs (Pinecone, Turbopuffer, Daytona, E2B, Groq, Cerebras, Together, Browserbase) via recorded fixtures or mocks. Self-hostable vector DBs (Chroma / Qdrant / Weaviate / pgvector) on Battlefield via docker. Fault-tolerance + telemetry layers wired through ≥1 consumer e2e.

### Gate 5 — Security regression sweep

Test surface covers: CWE-117 end-to-end across the 5 variable-binding-site patterns (Sprints 42 / 44 / 46 / 49 / 50). Prototype-pollution defence via secure-json-parse coverage. Connector-boundary sanitizeMeta hostile-`toString` fail-closure. Prompt-injection defence on a curated attack corpus (BonkLM standard: dojoLM 5,166 fixtures). Jailbreak detection regression. Secret + PII detection precision-recall. XSS + command-injection guard coverage. `security/override-token.ts` envelope. No secrets in any published tarball (deep grep).

Release-specific sub-gates (5.6, 5.7 …) are added per release based on red-team and security code reviewer contributions. See `09-security-addendum.md` for the current release.

### Gate 6 — CLI smoke

Test surface covers: `bonklm wizard` happy path; `bonklm status` JSON + human modes; `bonklm doctor` PASS / WARN / FAIL paths; `bonklm connector add / remove / test`; help-output stability; exit codes per command; path-traversal input validation.

### Gate 7 — Documentation validity

Test surface covers: `docs/user/` examples compile + run as written; every public-API symbol referenced in docs exists at the documented export path; README install command works on fresh `node_modules`; quick-start runnable from a cold checkout.

### Gate 8 — Performance gates

Test surface covers: existing `packages/core/benchmarks/` suite against configured thresholds; no regression vs prior baseline. Run on Battlefield for reproducibility (avoids Apple-Silicon vs CI runner drift).

### Gate 9 — Distribution / supply chain

Test surface covers: `pnpm audit --prod` clean (or documented exceptions); license-compatibility across the production dependency closure; no `link:` / `file:` deps in published packages; workspace-protocol resolution at publish time; CycloneDX SBOM; tarball secret-scan via gitleaks or ripsecrets.

### Gate 10 — Final gates before tag + publish

Test surface covers: tag = HEAD; CHANGELOG date set; `pnpm typecheck` clean; full workspace test green; `pnpm publish -r --dry-run` clean; git working tree clean (excluding gitignored persistent untracked); `[Unreleased]` collapsed to versioned heading; ADR-0001 status line updated if needed.

## Section 11 — Execution order + dependency graph

Default ordering (instantiate with sprint anchors per release):

```
Gate 1 ──► Gate 2 ──► (Gate 3 ∥ Gate 4 ∥ Gate 5 ∥ Gate 6) ──► Gate 7 ──► Gate 8 ──► Gate 9 ──► Gate 10
                                  ▲
                                  └── Gate 5 sub-gates parallel to one another
```

Gate 1 is the universal critical-path predecessor: every other gate depends on a coherent rc.N baseline.

## Section 12 — Decisions register

List every open question (D-N) with proposed answer, blocking gate, and resolution stage. See `01-decisions.md` per release.

## Section 13 — Sprint mapping

Default 5-sprint cadence:

| Sprint | Focus | Gates closed |
|---|---|---|
| N+0 | Fix-list + rc cut + Gate 1 + 5 hard blocks + code-review fixes | Gate 1, code-review fixes |
| N+1 | Install + runtime + dry-runs | Gates 2, 3 |
| N+2 | Connector smoke + security sweep + CLI | Gates 4, 5, 5.x, 6 |
| N+3 | Docs + perf + supply chain + tag + publish | Gates 7, 8, 9, 10 |
| N+4 | Post-publish monitoring + retro | (none — observation window) |

## Section 14 — Out of scope

What this plan does NOT cover (instantiate per release):
- Load testing (>> 10 RPS sustained)
- Fuzz testing budget beyond regression-set seeds
- Post-publish marketing
- Customer-success rollout

---

End of template. Instance files override universal text where release-specific.
