#!/usr/bin/env bash
# count-checkboxes.sh — audit master-checklist checkbox totals
# Usage: ./count-checkboxes.sh <release-version>
# Exit: 0; prints totals + diff vs claimed count
set -eu

repo_root="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$repo_root"

if [ $# -lt 1 ] || [ "$1" = "--help" ]; then
  cat <<EOF
Usage: $0 <release-version>

Count checkboxes in team/qa/<release-version>/02-master-checklist.md.
Reports: open ([ ]), in-progress ([~]), complete ([x]), blocked ([!]), accepted ([a]).
EOF
  exit 0
fi

version="$1"
checklist="team/qa/$version/02-master-checklist.md"

if [ ! -f "$checklist" ]; then
  echo "FAIL: not found $checklist" >&2
  exit 1
fi

open=$(grep -c '^\- \[ \]' "$checklist" || true)
inprog=$(grep -c '^\- \[\~\]' "$checklist" || true)
complete=$(grep -c '^\- \[x\]' "$checklist" || true)
blocked=$(grep -c '^\- \[!\]' "$checklist" || true)
accepted=$(grep -c '^\- \[a\]' "$checklist" || true)
total=$((open + inprog + complete + blocked + accepted))

echo "Checklist: $checklist"
echo "  open:        $open"
echo "  in-progress: $inprog"
echo "  complete:    $complete"
echo "  blocked:     $blocked"
echo "  accepted:    $accepted"
echo "  TOTAL:       $total"

# Try to extract the claimed total from the file
claim=$(grep -oE '0 / ~?[0-9]+ items' "$checklist" | head -1 | grep -oE '[0-9]+' | tail -1 || echo "")
if [ -n "$claim" ]; then
  echo ""
  echo "Claimed total in file: $claim"
  diff=$((total > claim ? total - claim : claim - total))
  echo "Drift: $diff"
fi

exit 0
