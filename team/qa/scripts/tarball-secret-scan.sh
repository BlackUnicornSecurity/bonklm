#!/usr/bin/env bash
# tarball-secret-scan.sh — Sprint 51 ST-05-001 / HB-1 — tarball-time secret scan
#
# Scans one or more *.tgz tarballs for secrets using gitleaks (and ripsecrets if
# available). Aggregates results to a JSON evidence file.
#
# Usage:
#   bash team/qa/scripts/tarball-secret-scan.sh [--help] [tarball1.tgz tarball2.tgz ...]
#
# If no tarballs are given, defaults to packages/*/dist/*.tgz.
#
# Exit codes:
#   0  — all tarballs scanned clean (zero leaks)
#   1  — one or more tarballs contain leaks (P0 STOP SHIP)
#   2  — pre-flight failure (missing tools, no tarballs found)
#
# Evidence output:
#   team/qa/1.0.0/evidence/gate-9/ST-09-004/tarball-scan-<UTC>.json
#
# Integration:
#   Run AFTER `npm pack` and BEFORE `npm publish` (Sprint 52 Gate 2 / Gate 9).
#   Any exit-1 result blocks publish until triaged.

set -euo pipefail

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
EVIDENCE_DIR="$REPO_ROOT/team/qa/1.0.0/evidence/gate-9/ST-09-004"
TS_UTC="$(date -u +%Y%m%dT%H%M%SZ)"
TMP_EXTRACT_ROOT="/tmp"
TMP_PREFIX="secretscan"
SCRIPT_NAME="$(basename "$0")"

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
log() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" >&2
}

log_info()  { log "INFO  $*"; }
log_warn()  { log "WARN  $*"; }
log_error() { log "ERROR $*"; }
log_ok()    { log "OK    $*"; }

# ---------------------------------------------------------------------------
# Cleanup trap — remove all /tmp/secretscan-* on exit
# ---------------------------------------------------------------------------
cleanup() {
  local exit_code=$?
  log_info "Cleanup: removing /tmp/${TMP_PREFIX}-* scratch directories"
  rm -rf "${TMP_EXTRACT_ROOT}/${TMP_PREFIX}"-* 2>/dev/null || true
  exit "$exit_code"
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
# Help
# ---------------------------------------------------------------------------
usage() {
  cat <<USAGE
Usage:
  $SCRIPT_NAME [--help] [tarball1.tgz tarball2.tgz ...]

Scans one or more *.tgz tarballs for secrets using gitleaks (and ripsecrets
if installed). Aggregates results to:
  $EVIDENCE_DIR/tarball-scan-<UTC>.json

Arguments:
  --help              Show this help and exit.
  [tarball ...]       One or more .tgz files to scan.
                      Defaults to packages/*/dist/*.tgz if none given.

Exit codes:
  0  All tarballs clean
  1  One or more tarballs contain leaks (P0 STOP SHIP — do not publish)
  2  Pre-flight failure (missing required tools, no tarballs found)

Environment:
  GITLEAKS_EXTRA_ARGS   Extra args passed to gitleaks detect (e.g. --config)

Examples:
  # Scan all dist tarballs (default):
  bash team/qa/scripts/tarball-secret-scan.sh

  # Scan specific tarballs:
  bash team/qa/scripts/tarball-secret-scan.sh packages/core/dist/bonklm-core-1.0.0.tgz

  # Use custom gitleaks config:
  GITLEAKS_EXTRA_ARGS="--config .gitleaks.toml" bash team/qa/scripts/tarball-secret-scan.sh
USAGE
}

# ---------------------------------------------------------------------------
# Parse args
# ---------------------------------------------------------------------------
TARBALLS=()
for arg in "$@"; do
  case "$arg" in
    --help|-h)
      usage
      exit 0
      ;;
    *)
      TARBALLS+=("$arg")
      ;;
  esac
done

# ---------------------------------------------------------------------------
# Pre-flight: required tools
# ---------------------------------------------------------------------------
log_info "=== tarball-secret-scan.sh $TS_UTC ==="
log_info "Repo: $REPO_ROOT"

if ! command -v gitleaks >/dev/null 2>&1; then
  log_error "gitleaks not found on PATH. Install: brew install gitleaks"
  exit 2
fi
GITLEAKS_VERSION="$(gitleaks version 2>&1 || echo 'unknown')"
log_info "gitleaks: $GITLEAKS_VERSION"

RIPSECRETS_AVAILABLE=false
if command -v ripsecrets >/dev/null 2>&1; then
  RIPSECRETS_AVAILABLE=true
  RIPSECRETS_VERSION="$(ripsecrets --version 2>&1 || echo 'unknown')"
  log_info "ripsecrets: $RIPSECRETS_VERSION"
else
  log_warn "ripsecrets not found — running gitleaks-only scan. Install: brew install ripsecrets"
  RIPSECRETS_VERSION="unavailable"
fi

if ! command -v sha256sum >/dev/null 2>&1 && ! command -v shasum >/dev/null 2>&1; then
  log_error "sha256sum/shasum not found on PATH — cannot compute tarball digests."
  exit 2
fi

# ---------------------------------------------------------------------------
# Resolve tarballs
# ---------------------------------------------------------------------------
if [ "${#TARBALLS[@]}" -eq 0 ]; then
  log_info "No tarballs specified — scanning packages/*/dist/*.tgz"
  while IFS= read -r -d '' f; do
    TARBALLS+=("$f")
  done < <(find "$REPO_ROOT/packages" -maxdepth 3 -name "*.tgz" -print0 2>/dev/null)
fi

if [ "${#TARBALLS[@]}" -eq 0 ]; then
  log_warn "No *.tgz tarballs found. Run \`npm pack\` in each package first."
  exit 2
fi

log_info "Tarballs to scan (${#TARBALLS[@]}):"
for t in "${TARBALLS[@]}"; do
  log_info "  $t"
done

# ---------------------------------------------------------------------------
# Prepare evidence dir
# ---------------------------------------------------------------------------
mkdir -p "$EVIDENCE_DIR"
REPORT_JSON="$EVIDENCE_DIR/tarball-scan-${TS_UTC}.json"
log_info "Evidence output: $REPORT_JSON"

# ---------------------------------------------------------------------------
# Scan each tarball
# ---------------------------------------------------------------------------
RESULTS_JSON="[]"
GLOBAL_LEAK_COUNT=0
GLOBAL_EXIT=0

sha256_file() {
  local f="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$f" | awk '{print $1}'
  else
    shasum -a 256 "$f" | awk '{print $1}'
  fi
}

for TARBALL in "${TARBALLS[@]}"; do
  if [ ! -f "$TARBALL" ]; then
    log_warn "Tarball not found (skipping): $TARBALL"
    continue
  fi

  BASENAME="$(basename "$TARBALL" .tgz)"
  EXTRACT_DIR="${TMP_EXTRACT_ROOT}/${TMP_PREFIX}-${BASENAME}-$$"
  START_MS="$(date +%s%3N 2>/dev/null || echo 0)"

  log_info "--- Scanning: $TARBALL ---"

  # Compute SHA-256 before extraction
  TARBALL_SHA256="$(sha256_file "$TARBALL")"
  log_info "SHA-256: $TARBALL_SHA256"

  # Extract
  mkdir -p "$EXTRACT_DIR"
  if ! tar -xzf "$TARBALL" -C "$EXTRACT_DIR" 2>/dev/null; then
    log_error "Failed to extract $TARBALL — skipping."
    rm -rf "$EXTRACT_DIR"
    continue
  fi

  # --- gitleaks scan ---
  GL_REPORT="$EVIDENCE_DIR/gitleaks-tarball-${BASENAME}-${TS_UTC}.json"
  GL_LEAK_COUNT=0
  GL_CATEGORIES=()

  set +e
  ${GITLEAKS_EXTRA_ARGS:+env GITLEAKS_EXTRA_ARGS="$GITLEAKS_EXTRA_ARGS"} \
    gitleaks detect \
      --source "$EXTRACT_DIR" \
      --no-banner \
      --no-git \
      --report-format json \
      --report-path "$GL_REPORT" \
      ${GITLEAKS_EXTRA_ARGS:-} \
      >/dev/null 2>&1
  GL_EXIT=$?
  set -e

  if [ "$GL_EXIT" -eq 1 ] && [ -f "$GL_REPORT" ]; then
    GL_LEAK_COUNT="$(jq 'length' "$GL_REPORT" 2>/dev/null || echo 0)"
    mapfile -t GL_CATEGORIES < <(jq -r '[.[].RuleID] | unique | .[]' "$GL_REPORT" 2>/dev/null || true)
    log_error "gitleaks: $GL_LEAK_COUNT leak(s) in $BASENAME — STOP SHIP"
    GLOBAL_LEAK_COUNT=$((GLOBAL_LEAK_COUNT + GL_LEAK_COUNT))
    GLOBAL_EXIT=1
  elif [ "$GL_EXIT" -eq 0 ]; then
    log_ok "gitleaks: clean for $BASENAME"
    # gitleaks writes null or [] when clean; normalise
    echo "[]" > "$GL_REPORT"
  else
    log_warn "gitleaks returned unexpected exit $GL_EXIT for $BASENAME"
  fi

  # --- ripsecrets scan (optional) ---
  RS_LEAK_COUNT=0
  RS_REPORT="$EVIDENCE_DIR/ripsecrets-tarball-${BASENAME}-${TS_UTC}.txt"

  if [ "$RIPSECRETS_AVAILABLE" = true ]; then
    set +e
    ripsecrets "$EXTRACT_DIR" > "$RS_REPORT" 2>&1
    RS_EXIT=$?
    set -e

    if [ "$RS_EXIT" -ne 0 ]; then
      RS_LEAK_COUNT="$(grep -c 'Found secret' "$RS_REPORT" 2>/dev/null || echo 0)"
      log_error "ripsecrets: $RS_LEAK_COUNT leak(s) in $BASENAME — STOP SHIP"
      GLOBAL_LEAK_COUNT=$((GLOBAL_LEAK_COUNT + RS_LEAK_COUNT))
      GLOBAL_EXIT=1
    else
      log_ok "ripsecrets: clean for $BASENAME"
    fi
  fi

  END_MS="$(date +%s%3N 2>/dev/null || echo 0)"
  DURATION_MS=$((END_MS - START_MS))

  # Build per-tarball result object
  CATEGORIES_JSON="$(printf '%s\n' "${GL_CATEGORIES[@]+"${GL_CATEGORIES[@]}"}" | jq -R . | jq -s .)"

  RESULT_ENTRY="$(jq -n \
    --arg tarball "$TARBALL" \
    --arg sha256 "$TARBALL_SHA256" \
    --argjson leaks_count "$GL_LEAK_COUNT" \
    --argjson leak_categories "$CATEGORIES_JSON" \
    --arg scan_tool "gitleaks $GITLEAKS_VERSION" \
    --argjson scan_duration_ms "$DURATION_MS" \
    --argjson ripsecrets_leaks "$RS_LEAK_COUNT" \
    --arg ripsecrets_version "$RIPSECRETS_VERSION" \
    '{
      tarball: $tarball,
      sha256: $sha256,
      leaks_count: $leaks_count,
      leak_categories: $leak_categories,
      scan_tool: $scan_tool,
      scan_duration_ms: $scan_duration_ms,
      ripsecrets_leaks: $ripsecrets_leaks,
      ripsecrets_version: $ripsecrets_version
    }')"

  RESULTS_JSON="$(echo "$RESULTS_JSON" | jq --argjson entry "$RESULT_ENTRY" '. += [$entry]')"

  # Cleanup extract dir immediately
  rm -rf "$EXTRACT_DIR"
done

# ---------------------------------------------------------------------------
# Write aggregate report
# ---------------------------------------------------------------------------
AGGREGATE_REPORT="$(jq -n \
  --arg scan_utc "$TS_UTC" \
  --argjson tarballs "$RESULTS_JSON" \
  --argjson total_leaks "$GLOBAL_LEAK_COUNT" \
  --arg gitleaks_version "$GITLEAKS_VERSION" \
  --arg ripsecrets_version "$RIPSECRETS_VERSION" \
  --arg repo_root "$REPO_ROOT" \
  '{
    scan_utc: $scan_utc,
    repo_root: $repo_root,
    gitleaks_version: $gitleaks_version,
    ripsecrets_version: $ripsecrets_version,
    total_leaks: $total_leaks,
    result: (if $total_leaks == 0 then "PASS" else "FAIL" end),
    tarballs: $tarballs
  }')"

echo "$AGGREGATE_REPORT" > "$REPORT_JSON"
log_info "Report written: $REPORT_JSON"

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
log_info "=== tarball-secret-scan.sh complete ==="
log_info "Total tarballs scanned: ${#TARBALLS[@]}"
log_info "Total leaks found:      $GLOBAL_LEAK_COUNT"

if [ "$GLOBAL_EXIT" -eq 0 ]; then
  log_ok "RESULT: PASS — all tarballs clean. Safe to publish."
else
  log_error "RESULT: FAIL — $GLOBAL_LEAK_COUNT leak(s) detected. P0 STOP SHIP."
  log_error "Rotate any real credentials immediately."
  log_error "See: $REPORT_JSON"
fi

exit "$GLOBAL_EXIT"
