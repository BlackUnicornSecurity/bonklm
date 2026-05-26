#!/usr/bin/env bash
# cascade-check.sh — enumerate dependents of a modified symbol across the repo
# Usage: ./cascade-check.sh <symbol>
# Exit: 0 always; output sectioned by dependent category
set -eu

repo_root="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$repo_root"

if [ $# -lt 1 ] || [ "$1" = "--help" ]; then
  cat <<EOF
Usage: $0 <symbol>

Enumerate every file in the repo that references <symbol>. Output sectioned by:
  - Code dependents (packages/**/*.ts|tsx|js|mjs|cjs)
  - Doc dependents (docs/, packages/*/README.md, CHANGELOG.md)
  - Test dependents (packages/**/tests/, *.test.ts)
  - ADR dependents (docs/contributing/adr/)
  - Lessons dependents (team/lessonslearned.md)

After running, the contributor MUST review each dependent and either update
or explicitly justify as no-op per framework/workflows/cascade-update-workflow.md.
EOF
  exit 0
fi

symbol="$1"

echo "=== Code dependents ==="
git grep -l "$symbol" -- 'packages/**/*.ts' 'packages/**/*.tsx' 'packages/**/*.js' 'packages/**/*.mjs' 'packages/**/*.cjs' 2>/dev/null || echo "(none)"

echo ""
echo "=== Doc dependents ==="
git grep -l "$symbol" -- 'docs/' 'packages/*/README.md' 'CHANGELOG.md' 'README.md' 2>/dev/null || echo "(none)"

echo ""
echo "=== Test dependents ==="
git grep -l "$symbol" -- 'packages/**/tests/' 'packages/**/*.test.ts' 'packages/**/*.test.tsx' 2>/dev/null || echo "(none)"

echo ""
echo "=== ADR dependents ==="
git grep -l "$symbol" -- 'docs/contributing/adr/' 2>/dev/null || echo "(none)"

echo ""
echo "=== Lessons dependents ==="
git grep -l "$symbol" -- 'team/lessonslearned.md' 2>/dev/null || echo "(none)"

echo ""
echo "=== QA-instance dependents ==="
git grep -l "$symbol" -- 'team/qa/' 2>/dev/null || echo "(none)"

exit 0
