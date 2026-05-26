#!/usr/bin/env bash
# post-publish-watch.sh — capture post-publish monitoring snapshots
# Usage: ./post-publish-watch.sh <release-version>
# Exit: 0 if snapshot captured; 1 on tooling error
set -eu

repo_root="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$repo_root"

if [ $# -lt 1 ] || [ "$1" = "--help" ]; then
  cat <<EOF
Usage: $0 <release-version>

Capture npm-view, GH-issue, and npm-audit snapshots for post-publish monitoring.
Output goes under team/qa/<release-version>/evidence/post-publish/<UTC-timestamp>/.

Required tools: npm, gh, jq.

Per framework/policies/post-publish-monitoring.md windows:
  - First 24h: run every 4h
  - First 7d: run daily
  - First 30d: run weekly
EOF
  exit 0
fi

version="$1"
ts="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
out_dir="team/qa/$version/evidence/post-publish/$ts"
mkdir -p "$out_dir"

echo "Capturing snapshot to $out_dir/ ..."

# Required tools
for tool in npm gh jq; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "FAIL: required tool '$tool' not installed" >&2
    exit 1
  fi
done

# 1. npm view for the core package
npm view "@blackunicorn/bonklm@$version" --json > "$out_dir/npm-view.json" 2>&1 || true

# 2. GH issues created in the last 24h
since=$(date -u -v-24H +%Y-%m-%d 2>/dev/null || date -u -d '24 hours ago' +%Y-%m-%d)
gh issue list --repo blackunicorn/bonklm --search "created:>$since" --json number,title,labels,createdAt > "$out_dir/issues.json" 2>&1 || true

# 3. npm audit of a fresh consumer install
audit_dir="$out_dir/install-test"
mkdir -p "$audit_dir"
(
  cd "$audit_dir"
  npm init -y >/dev/null 2>&1
  npm install "@blackunicorn/bonklm@$version" --no-save --no-audit >/dev/null 2>&1 || true
  npm audit --audit-level=high --json > "../audit.json" 2>&1 || true
)

# 4. Cold-import smoke
node -e "import('@blackunicorn/bonklm').then(m => process.stdout.write(JSON.stringify({symbol_count: Object.keys(m).length, has_default: 'default' in m}, null, 2)))" \
  > "$out_dir/cold-import.json" 2>&1 || echo '{"error": "cold-import failed"}' > "$out_dir/cold-import.json"

# 5. Metadata
cat > "$out_dir/_meta.json" <<EOF
{
  "release": "$version",
  "captured_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "host": "$(hostname)",
  "script": "team/qa/scripts/post-publish-watch.sh",
  "git_sha": "$(git rev-parse HEAD 2>/dev/null || echo unknown)"
}
EOF

echo "PASS: snapshot captured to $out_dir/"
exit 0
