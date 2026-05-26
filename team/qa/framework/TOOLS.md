# BR-QAF — Tool Dependency Manifest

Every external tool the framework references, with version pins, install commands, and per-platform notes. Authored 2026-05-25 alongside the framework.

A contributor running the framework for the first time installs the tools below before attempting any gate. The Day-1 runbook (`team/qa/1.0.0/RUNBOOK-DAY-1.md`) verifies presence via `validate-framework.sh`.

## Categorized inventory

### Core workspace tooling (already required by the repo — listed for completeness)

| Tool | Pinned version | Used by | Install (macOS) | Install (Linux) |
|---|---|---|---|---|
| `node` | `>=20.4.0` (per D-1) | every gate | `brew install node@22` or `mise` | `nvm install 22` |
| `pnpm` | `9.x` (per `package.json` packageManager) | every gate | `npm i -g pnpm@9` | same |
| `git` | `>=2.30` | every gate | `brew install git` | distro pkg |
| `jq` | `>=1.7` | evidence JSON manipulation, transcript hashing | `brew install jq` | `apt install jq` |
| `shasum` (macOS) / `sha256sum` (Linux) | system | transcript-hash, tarball reproducibility | built-in | built-in |
| `tar` | system (note BSD vs GNU diff — see Gate 5.8) | tarball audit | built-in (BSD) | built-in (GNU) |
| `docker` + `docker compose` | `>=20.10` | Battlefield testbed | Docker Desktop | `apt install docker.io docker-compose-plugin` |

### Security testing toolchain

| Tool | Pinned version | Used by | Install | Notes |
|---|---|---|---|---|
| `gitleaks` | `8.18.0` | Gate 5 hard-block HB-1 (secret-scan); Gate 9 ST-09-004 | `brew install gitleaks` / `go install github.com/gitleaks/gitleaks/v8@v8.18.0` | Required for HB-1 pre-publish gate |
| `ripsecrets` | `0.1.8` | Gate 5 HB-1 (secondary secret-scan) | `cargo install ripsecrets --version 0.1.8` | Complements gitleaks; different regex set |
| `@jazzer.js/core` | `2.1.0` | Gate 5.x fuzz harness (security review A.1) | `pnpm add -D @jazzer.js/core@2.1.0` (per-package) | Node fuzz harness for regex DoS, override-token tests |
| `npm audit` (built-in npm) | system | HB-6 + Gate 9 ST-09-001 | built-in | Use `pnpm audit --prod --audit-level=high` in practice |
| `license-checker` | `25.0.1` | Gate 9 ST-09-002 license audit | `npx license-checker@25.0.1` | Single-run; no global install needed |
| `@cyclonedx/cyclonedx-npm` | `1.19.3` | Gate 9 ST-09-003 SBOM | `npx @cyclonedx/cyclonedx-npm@1.19.3` | OR use `pnpm sbom` (built-in for pnpm 9+) |

### Documentation + validation

| Tool | Pinned version | Used by | Install |
|---|---|---|---|
| `markdownlint-cli2` | `0.13.0` | doc-sync workflow step 7; Gate 7 G7-T8 | `npx markdownlint-cli2@0.13.0` |
| `markdown-link-check` | `3.12.2` | doc-sync workflow step 7; Gate 7 G7-T8 | `npx markdown-link-check@3.12.2` |
| `tsd` (optional) | `0.31.0` | per-symbol Type-check column (per D-15 — currently SKIPPED for v1.0.0) | `pnpm add -D tsd@0.31.0` |

### Test recording / mocking

| Tool | Pinned version | Used by | Install |
|---|---|---|---|
| `nock` | `13.5.4` | Gate 4 cloud-only connector recorded-fixture replay | `pnpm add -D nock@13.5.4` (per-connector) |
| `@pollyjs/core` (alt) | `6.0.6` | Alternative to nock — full HTTP recording | `pnpm add -D @pollyjs/core@6.0.6` |
| `verdaccio` | `5.32.2` | Gate 2 G2-T4 local registry | `npm i -g verdaccio@5.32.2` |

### UAT capture

| Tool | Pinned version | Used by | Install |
|---|---|---|---|
| `asciinema` | `2.4.0` | UAT scenario recording (preferred over screenshots) | `brew install asciinema` / `pip install asciinema` |
| `screencapture` (macOS) | system | UAT BLOCK screenshots | built-in |
| `scrot` / `gnome-screenshot` (Linux) | system | UAT screenshots | distro pkg |
| Docker (`node:22-alpine`) | always-latest tag | clean-container UAT runs | `docker pull node:22-alpine` |

### GitHub CLI + automation

| Tool | Pinned version | Used by | Install |
|---|---|---|---|
| `gh` (GitHub CLI) | `>=2.40` | `post-publish-watch.sh` (issue search) | `brew install gh` / `apt install gh` |
| `release-please` | `16.10.1` | CHANGELOG validation; `release-please --dry-run` per Gate 1 ST-01-008 | `npx release-please@16.10.1` |
| `changesets` | `2.27.x` (per package.json devDep) | rc.4 + v1.0.0 version cuts | already installed (workspace devDep) |

### Benchmarks (Gate 8)

| Tool | Pinned version | Used by | Install |
|---|---|---|---|
| `vitest --benchmark` | matches workspace `vitest@4.1.7` | StreamValidator throughput, sanitizer hot-path benches | already installed |
| `tinybench` (vitest peer) | `2.x` (transitive) | per-bench harness | already installed |
| `0x` (flame-graph) | `5.7.0` | optional flame-graph capture per bench | `npm i -g 0x@5.7.0` |

### Battlefield-specific

| Tool | Used by | Where installed |
|---|---|---|
| `bulab` (BU-BattleLab CLI) | Gate 4 + Gate 5 corpus replay + Gate 8 perf | Battlefield only (`~/.local/bin/bulab` per Battlelab spec §0.4) |
| `mise` | Polyglot runtime mgmt (Node, Bun, Deno, Python, pnpm) | Battlefield + dev machines |
| docker-compose profile `vector` | chroma/qdrant/weaviate/pgvector | Battlefield `~/BU-BattleLab/infra/docker-compose.yml` |
| docker-compose profile `core` | postgres/redis/mailpit/jaeger/otel-collector/minio | Battlefield |
| `ollama` (systemd) | Ollama-connector live smoke | Battlefield port 11434 |

## One-shot installer (macOS)

```bash
#!/usr/bin/env bash
# team/qa/scripts/install-tools-macos.sh — first-time tool install for the framework
set -eu
echo "Installing BR-QAF tooling on macOS..."

# Core
brew install node@22 pnpm jq gh git docker

# Security
brew install gitleaks
cargo install ripsecrets --version 0.1.8 || echo "rust toolchain needed for ripsecrets"

# UAT
brew install asciinema

# npm-global
npm i -g pnpm@9 verdaccio@5.32.2 0x@5.7.0

# Verify
for tool in node pnpm jq gh git docker gitleaks ripsecrets asciinema verdaccio; do
  command -v "$tool" >/dev/null && echo "  ✓ $tool" || echo "  ✗ $tool MISSING"
done
```

## One-shot installer (Linux — Battlefield)

```bash
#!/usr/bin/env bash
# team/qa/scripts/install-tools-linux.sh — first-time tool install on Battlefield
set -eu
sudo apt update
sudo apt install -y nodejs jq gh git docker.io docker-compose-plugin tar
curl -fsSL https://get.pnpm.io/install.sh | sh -
curl -sSfL https://raw.githubusercontent.com/gitleaks/gitleaks/master/install.sh | sh -s -- -b /usr/local/bin v8.18.0
cargo install ripsecrets --version 0.1.8 || echo "rust needed"
pip install asciinema
npm i -g verdaccio@5.32.2
```

## Per-tool version pinning policy

- **Major version pinned.** Minor versions floating within major OK unless a tool has security history (gitleaks, jazzer.js pin minor too).
- **No `latest` tag.** Every install command above pins an exact or major-minor version.
- **Pin updates** require:
  - PR opened against `team/qa/framework/TOOLS.md`
  - Release engineer + security code reviewer sign-off
  - Re-run of `validate-framework.sh`

## Tool absence handling

If a contributor lacks a tool at gate execution:
1. `validate-framework.sh` warns at sprint entry
2. The specific gate refuses to PASS (gate criteria include "tool X present, version >= Y")
3. The contributor either installs OR escalates to release engineer for a deferred-install decision

## CI installation (GitHub Actions)

GitHub Actions `ci.yml` already installs pnpm + Node (verified 2026-05-25 against `.github/workflows/ci.yml`). For Gate 5 + Gate 9 in CI, additional install steps required:

```yaml
- name: Install security tooling
  run: |
    sudo apt update
    curl -sSfL https://raw.githubusercontent.com/gitleaks/gitleaks/master/install.sh | sudo sh -s -- -b /usr/local/bin v8.18.0
    npm i -g verdaccio@5.32.2
```

Per D-3 deferred decision: whether `publish.yml` runs the full Gate 5/9 toolchain depends on whether the release engineer chooses workflow-publish vs manual-publish path.

## Cross-references

- Day-1 runbook: `team/qa/1.0.0/RUNBOOK-DAY-1.md` (validates tooling at sprint entry)
- Framework self-test: `team/qa/scripts/validate-framework.sh` (validates tool presence)
- Entry criteria: `framework/policies/entry-exit-criteria.md` (item 11 — tool inventory verified)
