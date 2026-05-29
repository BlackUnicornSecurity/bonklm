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
  log_both ">>> FAST MODE: skipping build, uat, benchmark, sandbox-gate, security-regression, audit."
  log_both ">>> This output is for the inner loop only and is NOT valid PR evidence."
fi

# ---- Static / type / style ----------------------------------------------
run_gate "typecheck" pnpm typecheck
run_gate "lint" pnpm lint
run_gate "format:check" pnpm format:check

# ---- Tests + coverage ----------------------------------------------------
# Coverage thresholds in vitest.config.ts are the ratchet floor (only moves up;
# policy target is 100% — see CONTRIBUTING "Test coverage"). A drop below the
# configured floor fails this gate.
run_gate "test+coverage" pnpm exec vitest run --coverage

if [ "$FAST" -eq 0 ]; then
  # ---- Build -------------------------------------------------------------
  run_gate "build" pnpm build

  # ---- Type-surface (tsd) ------------------------------------------------
  # Runs after build: each per-package suite resolves the package-under-test's
  # published `types` entry (dist/*.d.ts), so the workspace must be built first.
  run_gate "test:types" pnpm test:types

  # ---- Tarball-drift snapshots (ST-04-300..351) --------------------------
  # Runs after build: `npm pack` snapshots each package's built dist/, which is
  # gitignored and absent before the build step above.
  run_gate "test:pack" pnpm test:pack

  # ---- End-to-end + perf -------------------------------------------------
  run_gate "uat" pnpm uat
  run_gate "benchmark" pnpm benchmark

  # ---- Detection-quality + security regression ---------------------------
  SANDBOX_GATE="packages/core/benchmarks/sandbox-attack-corpus/run-graduation-gate.mjs"
  if [ -f "$SANDBOX_GATE" ]; then
    run_gate "sandbox-gate (R2-13)" node "$SANDBOX_GATE"
  else
    skip_gate "sandbox-gate (R2-13)" "runner not found at $SANDBOX_GATE"
  fi

  SEC_REGRESSION="team/scripts/security-regression.sh"
  if [ -f "$SEC_REGRESSION" ]; then
    run_gate "security-regression" bash "$SEC_REGRESSION"
  else
    skip_gate "security-regression" "script not present (gitignored team/ tree)"
  fi

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
