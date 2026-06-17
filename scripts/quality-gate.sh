#!/usr/bin/env bash
#
# BonkLM local quality gate — the mandatory pre-PR runner.
#
# Contract: CLAUDE.md "Mandatory Engineering Workflow" + CONTRIBUTING.md
# "Definition of Done". This bundles every mechanical gate the PR contract
# requires, runs them all (no fail-fast, so one run surfaces every failure),
# and writes a timestamped evidence log under the gitignored team/ tree —
# keeping scan output internal per the security-disclosure policy in CLAUDE.md.
#
# A green run here is NECESSARY but NOT SUFFICIENT to open a PR: the contract
# also requires the senior-persona audit-loop, docs/checklist updates, and a
# changeset. This script only covers the parts a machine can verify.
#
# Usage:
#   pnpm quality-gate            full gate — the only run that is PR-valid evidence
#   pnpm quality-gate --fast     inner-loop subset; evidence is stamped NOT-PR-VALID
#   pnpm quality-gate --help     this message
#
# Exit codes: 0 = all blocking gates passed. 1 = at least one blocking gate
# failed. 2 = bad invocation. Advisory gates (dependency audit) never fail the
# run; they print WARN and are recorded as such.

set -uo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT" || {
  echo "fatal: cannot cd to repo root ($REPO_ROOT)" >&2
  exit 2
}

FAST=0
case "${1:-}" in
  --fast) FAST=1 ;;
  -h | --help)
    awk 'NR==1 {next} /^#/ {sub(/^# ?/, ""); print; next} {exit}' "$0"
    exit 0
    ;;
  "") ;;
  *)
    echo "unknown argument: $1 (try --help)" >&2
    exit 2
    ;;
esac

# Canonical project version lives in packages/core/package.json (see CONTRIBUTING
# "Canonical project version"). The QA evidence tree is keyed by the BASE
# version (prerelease suffix stripped), matching team/qa/<base>/.
VERSION="$(node -p "require('./packages/core/package.json').version" 2>/dev/null || echo "unknown")"
BASE_VERSION="${VERSION%%-*}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
EVIDENCE_DIR="team/qa/${BASE_VERSION}/evidence"
mkdir -p "$EVIDENCE_DIR"
LOG="${EVIDENCE_DIR}/quality-gate-${STAMP}.log"

NAMES=()
STATUSES=()
OVERALL=0

log_both() { echo "$@" | tee -a "$LOG"; }

# run_gate <label> <cmd...> — blocking gate; a failure fails the whole run.
run_gate() {
  local name="$1"
  shift
  log_both ""
  log_both "==== GATE: ${name} ===="
  log_both "\$ $*"
  local start=$SECONDS
  if "$@" 2>&1 | tee -a "$LOG"; then
    log_both "---- ${name}: PASS ($((SECONDS - start))s) ----"
    NAMES+=("$name")
    STATUSES+=("PASS")
  else
    log_both "---- ${name}: FAIL ($((SECONDS - start))s) ----"
    NAMES+=("$name")
    STATUSES+=("FAIL")
    OVERALL=1
  fi
}

# run_advisory <label> <cmd...> — non-blocking; failure records WARN only.
# Mirrors the CI `audit` job, which is informational because connector
# peer-deps surface unfixable upstream advisories.
run_advisory() {
  local name="$1"
  shift
  log_both ""
  log_both "==== ADVISORY: ${name} ===="
  log_both "\$ $*"
  local start=$SECONDS
  if "$@" 2>&1 | tee -a "$LOG"; then
    log_both "---- ${name}: PASS ($((SECONDS - start))s) ----"
    NAMES+=("$name")
    STATUSES+=("PASS")
  else
    log_both "---- ${name}: WARN ($((SECONDS - start))s, advisory — review manually) ----"
    NAMES+=("$name")
    STATUSES+=("WARN")
  fi
}

skip_gate() {
  NAMES+=("$1")
  STATUSES+=("SKIP ($2)")
  log_both ""
  log_both "==== SKIP: $1 ($2) ===="
}

# check_grad_reports_clean — enforces the de-timestamp determinism contract.
# The sandbox-gate REGENERATES its two tracked reports on every run; for a fixed
# validator build they are a pure function of the hash-pinned corpus, so a gate
# run MUST leave them byte-identical to the committed copies. This is the
# authoritative, format-agnostic backstop for "a no-op gate run leaves git
# status clean": it catches ANY reintroduced non-determinism (a timestamp of any
# shape, an epoch int, a run-id, a key reorder) — not just the historical
# `generated_at` ISO string the unit-test denylist covers — and also fails
# loudly if a corpus/validator change shifted the metrics and the regenerated
# report was not re-committed.
check_grad_reports_clean() {
  local reports=(
    "packages/core/benchmarks/sandbox-attack-corpus/graduation-report.json"
    "packages/core/benchmarks/sandbox-attack-corpus/graduation-report.txt"
  )
  if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "not inside a git work tree — cannot verify graduation-report determinism"
    return 0
  fi
  if git diff --quiet HEAD -- "${reports[@]}"; then
    echo "graduation reports byte-identical to committed copies (deterministic)"
    return 0
  fi
  echo "sandbox-gate regenerated graduation report(s) that DIFFER from the committed copies."
  echo "Cause: non-determinism reintroduced into run-graduation-gate.mjs, OR a corpus/validator"
  echo "change shifted the metrics and the regenerated report was not re-committed."
  git --no-pager diff --stat HEAD -- "${reports[@]}"
  return 1
}

{
  echo "BonkLM quality gate"
  echo "version:   ${VERSION} (base ${BASE_VERSION})"
  echo "timestamp: ${STAMP}"
  echo "mode:      $([ "$FAST" -eq 1 ] && echo 'FAST — NOT PR-VALID EVIDENCE' || echo 'FULL')"
  echo "commit:    $(git rev-parse --short HEAD 2>/dev/null || echo n/a)"
  echo "branch:    $(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo n/a)"
} | tee "$LOG"

if [ "$FAST" -eq 1 ]; then
  log_both ""
  log_both ">>> FAST MODE: skipping build, test:types, test:pack, uat, benchmark, sandbox-gate, sandbox-report-determinism, security-regression, audit."
  log_both ">>> This output is for the inner loop only and is NOT valid PR evidence."
fi

if [ "$FAST" -eq 0 ]; then
  # ---- Build (runs FIRST in full mode) ------------------------------------
  # Cross-package imports resolve workspace siblings through their built
  # dist/ (tests via node_modules workspace links, typecheck project refs,
  # tsd, pack). Building FIRST guarantees every downstream gate evaluates
  # THIS tree's artifacts: a stale dist/ left by an earlier build can fail a
  # gate on already-fixed source (false RED) or, worse, let a fresh source
  # regression ride on healthy stale artifacts (false GREEN). Fast mode still
  # skips the build and assumes a pre-built workspace — inner loop only,
  # never PR evidence.
  run_gate "build" pnpm build
  if [ "${STATUSES[${#STATUSES[@]} - 1]}" = "FAIL" ]; then
    # No-fail-fast is preserved (independent gates like format:check still
    # carry signal), but dist-dependent gates below now evaluate a stale or
    # partial dist — call that out so derivative failures read as noise, not
    # as N independent root causes.
    log_both ""
    log_both ">>> build FAILED — downstream gates still run (no fail-fast) but evaluate a stale or"
    log_both ">>> partial dist/; treat their failures as derivative until the build is green."
  fi
fi

# ---- Static / type / style ----------------------------------------------
run_gate "typecheck" pnpm typecheck
run_gate "lint" pnpm lint
run_gate "format:check" pnpm format:check

# ---- Release-surface structural gate -------------------------------------
# Assert the changesets `linked` group equals the publishable packages/* set
# (private !== true). Dependency-free + instant, so it runs in fast mode too,
# mirroring the CI `changeset-linked` job.
run_gate "changeset-linked" node tools/check-changeset-linked.js

# ---- tools/* tiering policy gate -----------------------------------------
# Assert every tools/<name>/package.json is a valid Tier A (private) or Tier B
# (publishable opt-in) package and that no Tier A tool leaks into a packages/*
# consumer's runtime deps. Dependency-free + instant (reads package.json only),
# so it runs in fast mode too, mirroring the CI `workspace-policy` job.
run_gate "workspace-policy" node tools/check-workspace-policy.js

# ---- OSS↔EE license-boundary gate ----------------------------------------
# Classify every packages/* package OSS (Apache-2.0) vs EE (BUSL-1.1) and fail if
# an OSS package imports an EE package (static or dynamic), enforcing that the
# Apache core builds/tests with packages/bonklm-ee/* absent. Dependency-free +
# instant (reads package.json + source text), so it runs in fast mode too,
# mirroring the CI `ee-boundary` job. At v1.0 (zero ee packages) it passes
# trivially — a tripwire for the first v1.1 ee package.
run_gate "ee-boundary" node tools/check-ee-boundary.js

# ---- Tests + coverage ----------------------------------------------------
# Coverage thresholds in vitest.config.ts are the ratchet floor (only moves up;
# policy target is 100% — see CONTRIBUTING "Test coverage"). A drop below the
# configured floor fails this gate.
run_gate "test+coverage" pnpm exec vitest run --coverage

if [ "$FAST" -eq 0 ]; then
  # ---- Type-surface (tsd) ------------------------------------------------
  # Needs the build gate (first in full mode): each per-package suite resolves
  # the package-under-test's published `types` entry (dist/*.d.ts), so the
  # workspace must be built first.
  run_gate "test:types" pnpm test:types

  # ---- Tarball-drift snapshots (ST-04-300..351) --------------------------
  # Needs the build gate (first in full mode): `npm pack` snapshots each
  # package's built dist/, which is gitignored and absent before the build.
  run_gate "test:pack" pnpm test:pack

  # ---- End-to-end + perf -------------------------------------------------
  run_gate "uat" pnpm uat
  run_gate "benchmark" pnpm benchmark

  # ---- Detection-quality + security regression ---------------------------
  SANDBOX_GATE="packages/core/benchmarks/sandbox-attack-corpus/run-graduation-gate.mjs"
  if [ -f "$SANDBOX_GATE" ]; then
    run_gate "sandbox-gate (R2-13)" node "$SANDBOX_GATE"
    # Enforce the de-timestamp determinism contract: the gate just regenerated
    # its two tracked reports, which MUST be byte-identical to the committed
    # copies (see check_grad_reports_clean). Format-agnostic backstop for the
    # "no-op gate run leaves git status clean" guarantee.
    run_gate "sandbox-report-determinism" check_grad_reports_clean
  else
    skip_gate "sandbox-gate (R2-13)" "runner not found at $SANDBOX_GATE"
  fi

  SEC_REGRESSION="team/scripts/security-regression.sh"
  if [ -f "$SEC_REGRESSION" ]; then
    run_gate "security-regression" bash "$SEC_REGRESSION"
  else
    skip_gate "security-regression" "script not present (gitignored team/ tree)"
  fi

  # ---- Tarball secret-scan (blocking) -----------------------------------
  # Packs every publishable package and gitleaks-scans the extracted tarball
  # bytes — the exact files a consumer downloads — so no secret can ship even if
  # one slips past the workspace-level scan. Requires gitleaks on PATH; skipped
  # (not failed) when absent so the gate stays runnable on a bare box. Findings
  # are redacted; route evidence to a local, gitignored path.
  if command -v gitleaks >/dev/null 2>&1; then
    run_gate "tarball-secret-scan" bash scripts/scan-tarballs.sh
  else
    skip_gate "tarball-secret-scan" "gitleaks not on PATH"
  fi

  # ---- Supply-chain gates (blocking) -------------------------------------
  # Shipped-closure scope: BonkLM ships connectors that declare third-party SDKs
  # as peerDependencies, so a workspace-wide audit surfaces dozens of upstream
  # peer-SDK advisories that are NOT in any BonkLM tarball. These two gates
  # measure only what BonkLM actually ships (the `dependencies` closure, peers
  # excluded) and block on a HIGH/CRITICAL advisory or a non-permissive license
  # there. The peer-SDK set is surfaced as consumer guidance, not a ship-blocker.
  # See docs/contributing/adr/0008-supply-chain-posture.md.
  run_gate "supply-chain (shipped advisories)" node scripts/supply-chain-audit.mjs
  run_gate "licenses (shipped closure)" node scripts/license-audit.mjs

  # ---- Dependency advisory surface (non-blocking, mirrors CI) ------------
  run_advisory "dep-audit" pnpm audit --audit-level=high
fi

# ---- Coverage gap readout (supports the 100% ratchet) --------------------
COV_SUMMARY="coverage/coverage-summary.json"
if [ -f "$COV_SUMMARY" ]; then
  log_both ""
  log_both "==== COVERAGE (policy target 100%; floor enforced by vitest.config.ts) ===="
  node -e '
    const s = require("./coverage/coverage-summary.json").total;
    for (const k of ["lines","statements","functions","branches"]) {
      const m = s[k]; if (!m) continue;
      console.log(`  ${k.padEnd(11)} ${String(m.pct).padStart(6)}%  (${m.covered}/${m.total})`);
    }
  ' 2>/dev/null | tee -a "$LOG" || log_both "  (could not parse $COV_SUMMARY)"
fi

# ---- Summary -------------------------------------------------------------
log_both ""
log_both "============ QUALITY GATE SUMMARY ============"
for i in "${!NAMES[@]}"; do
  printf '  %-26s %s\n' "${NAMES[$i]}" "${STATUSES[$i]}" | tee -a "$LOG"
done
log_both "----------------------------------------------"
log_both "evidence: ${LOG}"

if [ "$FAST" -eq 1 ]; then
  log_both "mode: FAST — re-run \`pnpm quality-gate\` (full) for PR-valid evidence."
fi

if [ "$OVERALL" -eq 0 ]; then
  log_both "RESULT: PASS (blocking gates green)"
  log_both ""
  log_both "Reminder: gates green != PR-ready. The contract still requires the"
  log_both "senior-persona audit-loop, docs/checklist updates, and a changeset."
else
  log_both "RESULT: FAIL — fix the gates marked FAIL above, then re-run."
fi

exit "$OVERALL"
