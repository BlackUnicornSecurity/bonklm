# Battlefield Degraded-Mode Protocol

Battlefield (`ssh paultinp@192.168.0.107`, Ubuntu 26.04, RTX 2080 Ti) is the canonical QA testbed per D-7 / D-8 / D-13. If Battlefield is unreachable at sprint entry or mid-sprint, this protocol defines how the QA cycle continues without blocking the entire release.

## Trigger

Battlefield is "unreachable" when ANY of:

- `ssh paultinp@192.168.0.107 hostname` returns non-zero or times out > 30 s
- `docker compose -f ~/BU-BattleLab/infra/docker-compose.yml ps` shows core/vector services down
- Network partition between dev machine and Battlefield (often: VPN down, home ISP outage, Battlefield power cycle)
- `bulab health` returns non-green for the services a gate needs

## Severity tiers

| Tier | Definition | Gates affected | Action |
|---|---|---|---|
| **T0 — Total outage** | Battlefield host unreachable, expected return >24h (hardware fault, ISP outage >24h) | Gates 4 (vector + ollama + lance + letta + restate + inngest + mem0 + zep), 5 (dojoLM corpus replay), 8 (perf benchmarks) | Switch to degraded mode (this doc); inform team via standup; activate fallbacks |
| **T1 — Partial outage** | Battlefield up but specific service down (e.g. weaviate container crashed) | Gates 4 for the failed service only | Restart service; re-run; document MTTR in standup |
| **T2 — Brief outage** | Battlefield reachable but slow (< 24h expected) | None — pause; retry every 30 min | Standup note; resume when green |

## T0 degraded-mode protocol

### Gates that CONTINUE without Battlefield

These gates do NOT depend on Battlefield and proceed normally:

- **Gate 1** — Package coherence (workspace-only file edits)
- **Gate 2** — Install + publish dry-runs (local Verdaccio fine on dev machine)
- **Gate 3** — Runtime matrix on Node 20.4 / 22 / 24 (Docker on dev machine)
- **Gate 5** — partial: CWE-117 sweep, secure-json-parse sweep, override-token tests, sanitizer regression, B.1-B.16 code-review fixes, sub-gates 5.6-5.10 — all run on dev machine
- **Gate 6** — CLI smoke on macOS (Linux smoke deferred)
- **Gate 7** — Documentation validity (workspace-only)
- **Gate 9** — Distribution / supply chain (`pnpm audit`, license check, SBOM, gitleaks on tarballs)
- **Gate 10** — Tag + publish (only if Battlefield is not the publish host)

### Gates that DEFER without Battlefield

- **Gate 4 — Battlefield-hosted tier** (Tier A: 12 connectors — chroma, qdrant, weaviate, ollama, lance, letta, restate, inngest, mem0, zep, langchain, llamaindex). These are blocked.
- **Gate 4 — UAT scenarios** that the per-connector test plan documents as Battlefield-only (per `08-uat-plan.md`).
- **Gate 5 — dojoLM 5,166-fixture corpus replay (ST-05-011)**. Corpus is on Battlefield filesystem; cannot replay without it.
- **Gate 6 — `bonklm doctor` Linux smoke (ST-06-003)**. macOS smoke (ST-06-002) proceeds.
- **Gate 8 — performance benchmarks (Sprint 54)**. Per D-13, Battlefield is the deterministic perf host. Apple Silicon dev runs are informational only and do NOT substitute.

### Fallback actions for deferred gates

| Deferred | Fallback (T0 partial coverage) | Caveats |
|---|---|---|
| Tier-A connector live tests | Run hermetic / mocked tests on dev machine; document SKIP-WITH-REASON in per-connector evidence | Live integration validation lost; document risk-acceptance entry in `04-risk-register.md` |
| dojoLM corpus replay | Local mirror of corpus at `/Users/paultinp/BU-TPI/packages/bu-tpi/fixtures/` IS available on dev machine (per Obsidian Infrastructure.md). Replay locally with lower parallelism (~30 min wall vs ~30 min on Battlefield). | Loss: cannot validate against the hash-pinned snapshot captured at sprint entry if local clone has drifted. Mitigation: re-snapshot + re-pin locally; document drift |
| `bonklm doctor` Linux smoke | Linux Docker container on dev machine (`docker run --rm -v /Users/.../repo:/repo node:22 bash -c 'cd /repo && pnpm install && pnpm --filter @blackunicorn/bonklm exec bonklm doctor'`) | Lower fidelity than bare-metal Battlefield run; document in evidence |
| Performance benchmarks | Apple Silicon dev machine, captured + flagged as INFORMATIONAL | Cannot be used as the official rc.3 → v1.0.0 baseline comparison. Must defer Gate 8 PASS until Battlefield returns |

### Local-fallback docker stack

For T0 events lasting > 24h, the release engineer stands up a minimal vector-DB stack on the dev machine:

```bash
# Create a temporary local stack mirroring the Battlefield vector profile
mkdir -p /tmp/bonklm-degraded-stack
cat > /tmp/bonklm-degraded-stack/docker-compose.yml <<'EOF'
services:
  chroma:
    image: chromadb/chroma:latest
    ports: ['8000:8000']
    profiles: ['vector']
  qdrant:
    image: qdrant/qdrant:latest
    ports: ['6333:6333']
    profiles: ['vector']
  weaviate:
    image: cr.weaviate.io/semitechnologies/weaviate:latest
    ports: ['8080:8080']
    profiles: ['vector']
    environment:
      QUERY_DEFAULTS_LIMIT: 25
      AUTHENTICATION_ANONYMOUS_ACCESS_ENABLED: 'true'
EOF
docker compose -f /tmp/bonklm-degraded-stack/docker-compose.yml --profile vector up -d
```

For Ollama local fallback (no GPU on dev macOS):

```bash
brew install ollama
ollama serve &
ollama pull llama3.1:8b  # smaller model for CPU
```

CPU-only Ollama runs ~10x slower than Battlefield RTX 2080 Ti. Document the slowdown in evidence.

## Escalation

- **T2 > 4h:** standup note; release engineer paged
- **T1 > 12h:** spawn diagnosis story; risk-register entry; senior-QA review
- **T0 > 24h:** release engineer activates this protocol; senior-QA + maintainer convene; decision on:
  - Continue with degraded-mode partial coverage + risk-accept
  - OR delay release until Battlefield returns
- **T0 > 7 days:** release decision moves to maintainer; consider procuring secondary testbed

## Re-entry from degraded mode

When Battlefield returns:

1. Re-run `ssh paultinp@192.168.0.107 'docker compose --profile core --profile vector ps'` → confirm all expected services up
2. Re-run `bulab health` → must be all-green
3. Re-rsync dojoLM corpus from canonical source if local mirror drifted
4. Re-run any deferred gate AS IF starting fresh (do NOT trust mid-degraded-mode partial evidence)
5. Replace local-fallback evidence files with Battlefield-captured evidence (mark old files with `_degraded.json` suffix for audit)
6. Update standup + risk register

## Risk register impact

R-2 (`04-risk-register.md`) mitigation updates after this doc:
- Was: "Entry-criterion check before Sprint 53 (ST-04-101). Local-fallback docker stack documented."
- Becomes: "Entry-criterion check (ST-04-101 + Day-1 runbook). T0 → T2 protocol defined in `framework/policies/battlefield-degraded-mode.md`. Local-fallback stack scriptable from this doc; CPU-only Ollama documented as 10x slower."

## Inventory of Battlefield-only dependencies

For the next release retrospective (or earlier if priorities shift), consider:

- Mirror dojoLM corpus to dev machine on a daily cron (so local-fallback is always within 24h freshness)
- Procure a secondary docker-host (Newton per Obsidian Infrastructure.md) capable of running the same compose stack
- Pin Ollama to a cloud-hosted endpoint (Together / Modal) as a tertiary fallback

These are deferred backlog items; not v1.0.0 scope.

## Cross-references

- Entry criteria: `entry-exit-criteria.md` (item 5)
- Day-1 runbook: `../../1.0.0/RUNBOOK-DAY-1.md` § A.4 + § Failure modes
- Risk register: `../../1.0.0/04-risk-register.md` R-2
- Battlefield spec: `/Users/paultinp/Projects/BU-BattleLab/docs/spec.md`
- Obsidian Battlefield.md, Infrastructure.md, RemoteAccess.md
