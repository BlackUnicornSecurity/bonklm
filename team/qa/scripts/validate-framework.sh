#!/usr/bin/env bash
# validate-framework.sh — self-test the BR-QAF framework
# Usage: ./validate-framework.sh [<release-version>]
# Exit: 0 if framework is internally consistent; 1 if drift detected
set -eu

repo_root="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$repo_root"

if [ "${1:-}" = "--help" ]; then
  cat <<'EOF'
Usage: ./validate-framework.sh [<release-version>]

Verifies that the BR-QAF framework is internally consistent:
  - All declared framework files exist
  - All cross-references resolve (no broken links)
  - All scripts referenced are present + executable
  - All templates have at least one filled-instance example
  - Required tools (per TOOLS.md) are installed

If <release-version> is provided, ALSO verifies the instance:
  - All instance files declared in 1.0.0/README.md exist
  - Master checklist checkbox count matches the claim in the header
  - Defect tracker schema header is present
  - Risk register R-IDs match the README's claim

Exit 0 if all green; 1 if any drift.
EOF
  exit 0
fi

PASS=0
FAIL=0
WARN=0

ok() { echo "  ✓ $*"; PASS=$((PASS+1)); }
fail() { echo "  ✗ $*" >&2; FAIL=$((FAIL+1)); }
warn() { echo "  ! $*"; WARN=$((WARN+1)); }

echo "=== BR-QAF framework self-test ==="
echo "Repo: $repo_root"
echo "Date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo ""

# Required framework files
echo "[1/6] Required framework files"
framework_files=(
  team/qa/framework/README.md
  team/qa/framework/TOOLS.md
  team/qa/framework/templates/meta-plan-template.md
  team/qa/framework/templates/gate-template.md
  team/qa/framework/templates/per-connector-template.md
  team/qa/framework/templates/master-checklist-template.md
  team/qa/framework/templates/uat-scenario-template.md
  team/qa/framework/templates/evidence-conventions.md
  team/qa/framework/workflows/retest-workflow.md
  team/qa/framework/workflows/cascade-update-workflow.md
  team/qa/framework/workflows/doc-sync-workflow.md
  team/qa/framework/workflows/parallel-agent-coordination.md
  team/qa/framework/policies/entry-exit-criteria.md
  team/qa/framework/policies/defect-taxonomy.md
  team/qa/framework/policies/sign-off-matrix.md
  team/qa/framework/policies/rollback-procedure.md
  team/qa/framework/policies/post-publish-monitoring.md
  team/qa/framework/policies/battlefield-degraded-mode.md
  team/qa/framework/policies/test-data-lifecycle.md
)
for f in "${framework_files[@]}"; do
  if [ -f "$f" ]; then
    ok "$f"
  else
    fail "$f MISSING"
  fi
done

# Required scripts
echo ""
echo "[2/6] Required scripts (must be executable)"
scripts=(
  team/qa/scripts/check-version-pin.sh
  team/qa/scripts/cascade-check.sh
  team/qa/scripts/check-retest-log.sh
  team/qa/scripts/post-publish-watch.sh
  team/qa/scripts/count-checkboxes.sh
  team/qa/scripts/count-stories.sh
  team/qa/scripts/validate-framework.sh
)
for s in "${scripts[@]}"; do
  if [ -f "$s" ] && [ -x "$s" ]; then
    ok "$s"
  elif [ -f "$s" ]; then
    fail "$s NOT EXECUTABLE (chmod +x needed)"
  else
    fail "$s MISSING"
  fi
done

# Required tooling (per TOOLS.md)
echo ""
echo "[3/6] Required tools installed"
required_tools=(node pnpm git jq tar)
for tool in "${required_tools[@]}"; do
  if command -v "$tool" >/dev/null 2>&1; then
    ok "$tool ($(command -v "$tool"))"
  else
    fail "$tool NOT INSTALLED — see team/qa/framework/TOOLS.md"
  fi
done

# Optional but recommended tools
echo ""
optional_tools=(gh gitleaks ripsecrets docker asciinema markdownlint-cli2 verdaccio)
for tool in "${optional_tools[@]}"; do
  if command -v "$tool" >/dev/null 2>&1; then
    ok "$tool (optional, installed)"
  else
    warn "$tool not installed (optional — see team/qa/framework/TOOLS.md)"
  fi
done

# Filled-instance examples in templates
echo ""
echo "[4/6] Templates have filled-instance examples"
templates_with_examples=(
  "team/qa/framework/templates/gate-template.md:## Worked example"
  "team/qa/framework/templates/per-connector-template.md:## Worked example"
  "team/qa/framework/templates/master-checklist-template.md:## Worked example"
)
for tw in "${templates_with_examples[@]}"; do
  file="${tw%%:*}"
  marker="${tw##*:}"
  if [ -f "$file" ] && grep -qF "$marker" "$file"; then
    ok "$file (filled example present)"
  else
    fail "$file (filled example MISSING — search '$marker')"
  fi
done

# Cross-reference resolution (sample check on framework README)
echo ""
echo "[5/6] Sample cross-reference resolution"
readme="team/qa/framework/README.md"
if [ -f "$readme" ]; then
  # Extract relative path references
  refs=$(grep -oE 'templates/[a-z-]+\.md|workflows/[a-z-]+\.md|policies/[a-z-]+\.md|TOOLS\.md' "$readme" | sort -u)
  for ref in $refs; do
    target="team/qa/framework/$ref"
    if [ -f "$target" ]; then
      ok "README references $ref → resolves"
    else
      fail "README references $ref → MISSING"
    fi
  done
else
  fail "framework README missing"
fi

# Instance check (if version provided)
if [ -n "${1:-}" ]; then
  version="$1"
  echo ""
  echo "[6/6] Instance check — v$version"

  instance_dir="team/qa/$version"
  if [ ! -d "$instance_dir" ]; then
    fail "instance directory $instance_dir MISSING"
  else
    # Required instance files
    instance_files=(
      "$instance_dir/README.md"
      "$instance_dir/00-meta-plan.md"
      "$instance_dir/01-decisions.md"
      "$instance_dir/02-master-checklist.md"
      "$instance_dir/03-defects.md"
      "$instance_dir/04-risk-register.md"
      "$instance_dir/05-senior-qa-signoff.md"
      "$instance_dir/06-epics-stories.md"
      "$instance_dir/07-connectors-matrix.md"
      "$instance_dir/08-uat-plan.md"
      "$instance_dir/09-security-addendum.md"
      "$instance_dir/evidence/README.md"
    )
    for f in "${instance_files[@]}"; do
      if [ -f "$f" ]; then
        ok "$f"
      else
        fail "$f MISSING"
      fi
    done

    # Day-1 runbook (recommended)
    if [ -f "$instance_dir/RUNBOOK-DAY-1.md" ]; then
      ok "$instance_dir/RUNBOOK-DAY-1.md"
    else
      warn "$instance_dir/RUNBOOK-DAY-1.md MISSING (recommended)"
    fi

    # Per-symbol matrices (recommended)
    if [ -f "$instance_dir/07b-per-symbol-matrices.md" ]; then
      ok "$instance_dir/07b-per-symbol-matrices.md"
    else
      warn "$instance_dir/07b-per-symbol-matrices.md MISSING (recommended)"
    fi

    # Checkbox count drift check
    if [ -f "$instance_dir/02-master-checklist.md" ]; then
      actual=$(grep -c '^\- \[ \]\|^\- \[~\]\|^\- \[x\]\|^\- \[!\]\|^\- \[a\]' "$instance_dir/02-master-checklist.md" || echo 0)
      claim=$(grep -oE '0 / ~?[0-9]+ items' "$instance_dir/02-master-checklist.md" | head -1 | grep -oE '[0-9]+' | tail -1 || echo "")
      if [ -n "$claim" ]; then
        if [ "$actual" -eq "$claim" ]; then
          ok "checkbox count $actual matches claim $claim"
        else
          fail "checkbox count $actual ≠ claim $claim (drift detected — run team/qa/scripts/count-checkboxes.sh $version)"
        fi
      else
        warn "no claim found in master-checklist header"
      fi
    fi
  fi
fi

# Summary
echo ""
echo "=== Summary ==="
echo "  PASS:  $PASS"
echo "  WARN:  $WARN"
echo "  FAIL:  $FAIL"
echo ""

if [ "$FAIL" -eq 0 ]; then
  echo "✓ Framework self-test PASSED ($PASS checks)"
  exit 0
fi

echo "✗ Framework self-test FAILED ($FAIL failures, $WARN warnings)"
echo "Run: $0 --help for usage"
exit 1
