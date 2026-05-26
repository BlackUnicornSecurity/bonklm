#!/usr/bin/env bash
# count-stories.sh — audit unique story IDs across the release instance
# Usage: ./count-stories.sh <release-version>
set -eu

repo_root="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$repo_root"

if [ $# -lt 1 ] || [ "$1" = "--help" ]; then
  cat <<EOF
Usage: $0 <release-version>

Count unique ST-NN-NNN story IDs across team/qa/<release-version>/.
Also enumerates which IDs appear in epics-stories vs master-checklist (drift check).
EOF
  exit 0
fi

version="$1"
instance="team/qa/$version"

if [ ! -d "$instance" ]; then
  echo "FAIL: not found $instance" >&2
  exit 1
fi

# Extract all ST-NN-NNN tokens, unique, sorted
all=$(grep -rohE 'ST-[0-9]{2}-[0-9]{3}' "$instance" 2>/dev/null | sort -u)
total=$(printf '%s\n' "$all" | wc -l | tr -d ' ')

echo "Unique story IDs in $instance: $total"
echo ""

# Per-epic breakdown
echo "Per-epic breakdown:"
printf '%s\n' "$all" | awk -F- '{print "ST-" $2}' | sort | uniq -c | awk '{printf "  %-8s %d stories\n", $2, $1}'

# Drift: IDs in epics-stories vs master-checklist
epics="$instance/06-epics-stories.md"
checklist="$instance/02-master-checklist.md"
if [ -f "$epics" ] && [ -f "$checklist" ]; then
  e_ids=$(grep -ohE 'ST-[0-9]{2}-[0-9]{3}' "$epics" | sort -u)
  c_ids=$(grep -ohE 'ST-[0-9]{2}-[0-9]{3}' "$checklist" | sort -u)
  in_epics_not_checklist=$(comm -23 <(printf '%s\n' "$e_ids") <(printf '%s\n' "$c_ids"))
  in_checklist_not_epics=$(comm -13 <(printf '%s\n' "$e_ids") <(printf '%s\n' "$c_ids"))
  echo ""
  echo "In epics-stories but NOT in master-checklist:"
  printf '%s\n' "$in_epics_not_checklist" | sed 's/^/  /'
  echo ""
  echo "In master-checklist but NOT in epics-stories:"
  printf '%s\n' "$in_checklist_not_epics" | sed 's/^/  /'
fi

exit 0
