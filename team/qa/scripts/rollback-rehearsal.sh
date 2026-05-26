#!/usr/bin/env bash
# rollback-rehearsal.sh — RUNBOOK § A.6 / EC-13 — Sprint 51 rollback rehearsal
#
# Publishes a sacrificial @blackunicorn/bonklm-rollback-rehearsal-<UTC-timestamp>
# package to npm, then immediately unpublishes it. Captures full evidence to
# team/qa/1.0.0/evidence/baseline/rollback-rehearsal.log.
#
# Required before any rc.4 publish — see framework/policies/entry-exit-criteria.md
# EC-13 + 05-senior-qa-signoff.md item 13.
#
# USER ACTION: this script publishes a real (sacrificial) package to npm. The
# release-QA coordinator (Claude) cannot run this autonomously per the explicit-
# permission policy on external publish actions. Run as the release engineer.
#
# Usage:
#   bash team/qa/scripts/rollback-rehearsal.sh
#
# Exit codes:
#   0  — full publish + unpublish round-trip succeeded; evidence captured
#   1  — pre-flight failed (npm auth, network, missing tools)
#   2  — publish failed
#   3  — unpublish failed (CRITICAL — sacrificial pkg still live; manual cleanup needed)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
EVIDENCE_DIR="$REPO_ROOT/team/qa/1.0.0/evidence/baseline"
LOG_FILE="$EVIDENCE_DIR/rollback-rehearsal.log"
SCRATCH_DIR="$(mktemp -d -t bonklm-rollback-XXXXXX)"
TS_UTC="$(date -u +%Y%m%dT%H%M%SZ)"
PKG_NAME="@blackunicorn/bonklm-rollback-rehearsal-$TS_UTC"
PKG_VERSION="0.0.1"

mkdir -p "$EVIDENCE_DIR"

log() {
  local msg="[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"
  echo "$msg" | tee -a "$LOG_FILE"
}

cleanup() {
  local exit_code=$?
  log "Cleanup: removing scratch dir $SCRATCH_DIR"
  rm -rf "$SCRATCH_DIR"
  if [ "$exit_code" -eq 3 ]; then
    log "CRITICAL: package $PKG_NAME may still be live on npm. Run: npm unpublish $PKG_NAME@$PKG_VERSION --force"
  fi
  exit "$exit_code"
}
trap cleanup EXIT

log "=== rollback-rehearsal.sh start ==="
log "Repo: $REPO_ROOT"
log "Scratch: $SCRATCH_DIR"
log "Sacrificial package: $PKG_NAME@$PKG_VERSION"

# Pre-flight
log "--- Pre-flight checks ---"
if ! command -v npm >/dev/null 2>&1; then
  log "FAIL: npm not on PATH"
  exit 1
fi
NPM_USER="$(npm whoami 2>&1 || echo 'NOT-AUTHENTICATED')"
log "npm whoami: $NPM_USER"
if [ "$NPM_USER" = "NOT-AUTHENTICATED" ]; then
  log "FAIL: npm not authenticated. Run: npm login --scope=@blackunicorn"
  exit 1
fi

# Confirm scope authorization (best effort — npm CLI may not expose org details)
log "npm config get registry: $(npm config get registry)"

# Build sacrificial package
log "--- Build sacrificial package ---"
cd "$SCRATCH_DIR"
cat > package.json <<EOF
{
  "name": "$PKG_NAME",
  "version": "$PKG_VERSION",
  "description": "BonkLM rollback-rehearsal sacrificial package — DO NOT INSTALL. Used to verify the publish + unpublish round-trip per BR-QAF v1.0 EC-13.",
  "main": "index.js",
  "license": "MIT",
  "publishConfig": {
    "access": "public"
  },
  "engines": {
    "node": ">=20.4.0"
  }
}
EOF
cat > index.js <<'EOF'
throw new Error('BonkLM rollback-rehearsal sacrificial package — DO NOT INSTALL.');
EOF
cat > README.md <<EOF
# $PKG_NAME

DO NOT INSTALL. This package is published transiently as part of the BonkLM
v1.0.0 release-QA rollback rehearsal per BR-QAF v1.0 EC-13.

Unpublished immediately after publish. If you are seeing this on npm,
either the unpublish step failed (run \`npm unpublish $PKG_NAME@$PKG_VERSION --force\`)
or you are reading the cached registry tarball.
EOF
log "Manifest:"
cat package.json | tee -a "$LOG_FILE"

# Publish
log "--- Publish to npm ---"
if ! npm publish 2>&1 | tee -a "$LOG_FILE"; then
  log "FAIL: npm publish failed for $PKG_NAME@$PKG_VERSION"
  exit 2
fi
log "Publish OK"

# Sleep briefly to let registry settle (some users report immediate unpublish hits a 404 race)
log "--- Sleep 5s for registry propagation ---"
sleep 5

# Verify published
log "--- Verify published ---"
if npm view "$PKG_NAME@$PKG_VERSION" 2>&1 | tee -a "$LOG_FILE"; then
  log "View OK — package visible on registry"
else
  log "WARN: npm view returned non-zero — package may not yet be globally indexed. Proceeding with unpublish."
fi

# Unpublish
log "--- Unpublish ---"
if ! npm unpublish "$PKG_NAME@$PKG_VERSION" --force 2>&1 | tee -a "$LOG_FILE"; then
  log "FAIL: npm unpublish failed for $PKG_NAME@$PKG_VERSION"
  log "CRITICAL: package may still be live on npm. Manual cleanup required."
  exit 3
fi
log "Unpublish OK"

# Verify gone
log "--- Verify unpublished ---"
if npm view "$PKG_NAME@$PKG_VERSION" 2>&1 | grep -q 'is not in this registry\|E404'; then
  log "View confirms package absent — rehearsal complete"
else
  log "WARN: npm view returned data for an unpublished package. May indicate registry cache lag. Verify manually in 1-24h."
fi

# Summary
log "=== rollback-rehearsal.sh complete ==="
log "Package: $PKG_NAME@$PKG_VERSION"
log "Publish: OK"
log "Unpublish: OK"
log "Evidence: $LOG_FILE"
log "Operator: $NPM_USER"
log ""
log "Next: update team/qa/1.0.0/05-senior-qa-signoff.md item 13 + 02-master-checklist.md EC-13 row to [x] with evidence link."

exit 0
