#!/usr/bin/env bash
#
# BonkLM published-tarball secret-scan.
#
# Packs every publishable package, or consumes the exact release bundle from
# `BONKLM_TARBALL_DIR`, and runs gitleaks over the EXTRACTED tarball contents:
# the actual bytes a consumer downloads from npm. Zero secrets must ship. Findings are
# redacted (no secret value is ever printed or written), keeping output safe to
# surface per the CLAUDE.md disclosure policy; route the report to a local,
# gitignored path when capturing evidence.
#
# Requires gitleaks on PATH (exit 3 if absent, so callers can treat it as SKIP).
#
# Usage:
#   scripts/scan-tarballs.sh                 # scan; report to a temp file
#   scripts/scan-tarballs.sh path/report.json # scan; write report to path
#
# Exit: 0 = clean. 1 = secret(s) found. 2 = pack/setup error. 3 = gitleaks absent.

set -uo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT" || {
  echo "scan-tarballs: cannot cd to repo root" >&2
  exit 2
}

if ! command -v gitleaks >/dev/null 2>&1; then
  echo "scan-tarballs: gitleaks not found on PATH — install gitleaks to run this scan"
  exit 3
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
PACKED="${BONKLM_TARBALL_DIR:-$TMP/tgz}"
EXTRACT="$TMP/extracted"
mkdir -p "$EXTRACT"

# Public packages plus explicitly publishable Tier-B tools. This is the same
# candidate discovery used by the exact release-tarball surface gate.
DIRS="$(node --input-type=module -e '
import { relative } from "node:path";
import { publishableDirectories } from "./scripts/check-release-tarballs.js";
for (const directory of publishableDirectories(process.cwd())) {
  process.stdout.write(relative(process.cwd(), directory) + "\n");
}')"

packed=0
if [ -n "${BONKLM_TARBALL_DIR:-}" ]; then
  if [ ! -d "$PACKED" ]; then
    echo "scan-tarballs: supplied tarball directory does not exist" >&2
    exit 2
  fi
  packed="$(find "$PACKED" -maxdepth 1 -type f -name '*.tgz' | wc -l | tr -d ' ')"
else
  mkdir -p "$PACKED"
  fail=0
  for d in $DIRS; do
    if npm pack "./$d" --pack-destination "$PACKED" --ignore-scripts >/dev/null 2>&1; then
      packed=$((packed + 1))
    else
      echo "scan-tarballs: PACK FAILED — $d"
      fail=$((fail + 1))
    fi
  done
  if [ "$fail" -ne 0 ]; then
    echo "scan-tarballs: $fail package(s) failed to pack — aborting"
    exit 2
  fi
fi
if [ "$packed" -eq 0 ]; then
  echo "scan-tarballs: supplied or generated tarball set is empty" >&2
  exit 2
fi

for t in "$PACKED"/*.tgz; do
  sub="$EXTRACT/$(basename "$t" .tgz)"
  mkdir -p "$sub"
  tar -xzf "$t" -C "$sub" 2>/dev/null
done
files="$(find "$EXTRACT" -type f | wc -l | tr -d ' ')"
if [ "$files" -eq 0 ]; then
  echo "scan-tarballs: extracted 0 files from ${packed} tarballs — nothing scanned (build the workspace first?)"
  exit 2
fi

# Default the report path OUTSIDE the temp dir so a FAIL can still be inspected
# after the EXIT trap removes $TMP.
REPORT="${1:-${TMPDIR:-/tmp}/bonklm-tarball-gitleaks-report.json}"
gitleaks detect \
  --source "$EXTRACT" \
  --no-git \
  --redact \
  --config "$REPO_ROOT/.gitleaks.toml" \
  --report-format json \
  --report-path "$REPORT" >"$TMP/gitleaks.log" 2>&1
gl=$?

if [ "$gl" -eq 0 ]; then
  echo "scan-tarballs: PASS — 0 gitleaks-detectable secrets across ${packed} tarballs (${files} files scanned)"
  exit 0
fi
# Count findings with a guarded read (not require(), which resolves relative to
# the script and swallows errors silently).
n="$(node -e 'try { const a = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")); console.log(Array.isArray(a) ? a.length : 0) } catch { console.log("?") }' "$REPORT" 2>/dev/null)"
echo "scan-tarballs: FAIL — ${n:-?} finding(s) across ${packed} tarballs; inspect the redacted report:"
echo "  ${REPORT}"
# A non-parseable report means gitleaks errored (config/tool) rather than found a
# secret; surface its log before the EXIT trap removes $TMP, so it is diagnosable.
if [ "${n:-?}" = "?" ]; then
  echo "  (gitleaks produced no parseable report — log tail:)"
  tail -5 "$TMP/gitleaks.log" 2>/dev/null | sed 's/^/    /'
fi
exit 1
