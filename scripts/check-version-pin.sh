#!/usr/bin/env bash
# check-version-pin.sh — verify all workspace package.json files declare the same version
# Usage: ./check-version-pin.sh [--expected <version>]
# Exit: 0 if all match; 1 if drift detected; 2 on usage error
set -eu

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
expected=""
if [ $# -ge 1 ] && [ "$1" = "--help" ]; then
  echo "Usage: $0 [--expected <version>]"
  echo "  --expected <version>   Assert all packages match this version"
  exit 0
fi
if [ $# -eq 1 ] && [ "$1" = "--expected" ]; then
  echo "usage error: --expected requires a <version> argument" >&2
  exit 2
fi
if [ $# -ge 2 ] && [ "$1" = "--expected" ]; then
  expected="$2"
fi

cd "$repo_root"

# Extract "version": "..." line from every packages/*/package.json
versions=$(grep -E '"version"\s*:' packages/*/package.json 2>/dev/null | \
  sed 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/' | \
  sort -u)

# Fail loudly rather than silently passing when no versions are found — the
# grep|sed|sort pipeline masks grep's no-match exit and there is no pipefail,
# so an empty result must be treated as an error, not an implicit match.
if [ -z "$versions" ]; then
  echo "FAIL: no package versions found under packages/*/package.json (run from the repo root)" >&2
  exit 1
fi

count=$(printf '%s\n' "$versions" | wc -l | tr -d ' ')

if [ "$count" -ne 1 ]; then
  echo "FAIL: version drift detected — found $count distinct versions:" >&2
  printf '%s\n' "$versions" >&2
  exit 1
fi

actual=$(printf '%s' "$versions")
if [ -n "$expected" ] && [ "$actual" != "$expected" ]; then
  echo "FAIL: expected $expected, got $actual" >&2
  exit 1
fi

echo "PASS: all packages at $actual"
exit 0
