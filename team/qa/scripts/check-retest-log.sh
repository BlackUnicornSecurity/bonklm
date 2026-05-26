#!/usr/bin/env bash
# check-retest-log.sh — pre-commit gate refusing fix commits without retest-log entry
# Usage: ./check-retest-log.sh <release-version> <defect-id>
# Exit: 0 if retest-log entry exists; 1 if missing
set -eu

repo_root="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$repo_root"

if [ $# -lt 2 ] || [ "$1" = "--help" ]; then
  cat <<EOF
Usage: $0 <release-version> <defect-id>

Check that team/qa/<release-version>/retest-log.md has an entry for <defect-id>
with Result: PASS. Used as pre-commit gate per framework/workflows/retest-workflow.md.

Example: $0 1.0.0 D-042
EOF
  exit 0
fi

version="$1"
defect_id="$2"
log="team/qa/$version/retest-log.md"

if [ ! -f "$log" ]; then
  echo "FAIL: retest log not found at $log" >&2
  exit 1
fi

# Look for the defect ID + a PASS marker within ~20 lines after it
if ! awk -v id="$defect_id" '
  $0 ~ id { found=1; matchwin=20 }
  found && matchwin>0 { print; matchwin-- }
' "$log" | grep -q 'Result:[[:space:]]*PASS'; then
  echo "FAIL: no PASS retest entry for $defect_id in $log" >&2
  echo "Required: append entry per framework/workflows/retest-workflow.md step 4" >&2
  exit 1
fi

echo "PASS: retest entry for $defect_id found in $log"
exit 0
