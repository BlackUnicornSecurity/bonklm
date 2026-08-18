#!/usr/bin/env bash
# check-version-pin.sh — verify root metadata and all publishable packages share one version
# Usage: ./check-version-pin.sh [--expected <version>]
# Exit: 0 if all match; 1 if drift detected; 2 on usage error
set -eu

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
expected=""
expected_set=0
if [ $# -eq 1 ] && [ "$1" = "--help" ]; then
  echo "Usage: $0 [--expected <version>]"
  echo "  --expected <version>   Assert all packages match this version"
  exit 0
fi
if [ $# -eq 2 ] && [ "$1" = "--expected" ]; then
  expected="$2"
  expected_set=1
elif [ $# -ne 0 ]; then
  echo "usage error: Usage: $0 [--expected <version>]" >&2
  exit 2
fi

cd "$repo_root"

# Changesets intentionally excludes private package manifests, so the enforced
# release family is the private root metadata plus publishable packages/* only.
versions=$(node --input-type=module -e '
  import { existsSync, readFileSync, readdirSync } from "node:fs";
  import { join } from "node:path";
  import { isValidSemver } from "./tools/semver.js";
  const read = path => JSON.parse(readFileSync(path, "utf8"));
  const root = read("package.json");
  const manifests = readdirSync("packages", { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => join("packages", entry.name, "package.json"))
    .filter(existsSync)
    .map(read)
    .filter(manifest => manifest.private !== true);
  const versions = [root, ...manifests].map(manifest => manifest.version);
  if (versions.some(version => !isValidSemver(version))) {
    throw new Error("root or publishable package manifest has an invalid SemVer version");
  }
  process.stdout.write([...new Set(versions)].sort().join("\n"));
')

# Fail loudly rather than silently passing when no versions are found.
# An empty result must be treated as an error, not an implicit match.
if [ -z "$versions" ]; then
  echo "FAIL: no versions found in root/publishable package manifests (run from the repo root)" >&2
  exit 1
fi

count=$(printf '%s\n' "$versions" | wc -l | tr -d ' ')

if [ "$count" -ne 1 ]; then
  echo "FAIL: version drift detected — found $count distinct versions:" >&2
  printf '%s\n' "$versions" >&2
  exit 1
fi

actual=$(printf '%s' "$versions")
if [ "$expected_set" -eq 1 ] && ! EXPECTED="$expected" node --input-type=module -e '
  import { isValidSemver } from "./tools/semver.js";
  if (!isValidSemver(process.env.EXPECTED)) process.exit(1);
'; then
  echo "FAIL: expected version is not valid SemVer: $expected" >&2
  exit 1
fi
if [ "$expected_set" -eq 1 ] && [ "$actual" != "$expected" ]; then
  echo "FAIL: expected $expected, got $actual" >&2
  exit 1
fi

VERSION="$actual" node --input-type=module -e '
  import { readFileSync } from "node:fs";
  const version = process.env.VERSION;
  const required = [
    ["RELEASE-NOTES.md", `Latest in-tree family version:** \`${version}\``],
    ["docs/user/package-matrix.md", `v${version} package surface`],
    ["docs/architecture.md", `Project version: \`${version}\``],
    ["docs/user/public-api-surface.md", `(v${version} freeze)`],
    ["docs/user/known-limitations.md", `(v${version})`],
    ["docs/user/threat-surfaces.md", `current release v${version}`],
    ["CHANGELOG.md", `## [${version}]`]
  ];
  const stale = required.filter(([file, marker]) => !readFileSync(file, "utf8").includes(marker));
  if (stale.length) {
    for (const [file] of stale) console.error(`FAIL: current-version marker is stale in ${file}`);
    process.exit(1);
  }
'

echo "PASS: root metadata and publishable packages at $actual"
exit 0
