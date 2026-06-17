#!/usr/bin/env node
//
// BonkLM supply-chain advisory gate.
//
// Runs `pnpm audit --prod --json` and classifies every HIGH/CRITICAL advisory by
// the FIRST dependency edge on its path out of a *publishable* BonkLM package:
//
//   - dependencies / optionalDependencies  -> SHIPPED. The vulnerable package is
//     in a BonkLM tarball's production closure. This BLOCKS the gate.
//   - peerDependencies                      -> CONSUMER-SUPPLIED. The vulnerable
//     package rides in through a third-party SDK the *consumer* installs (BonkLM
//     connectors declare those SDKs as peers and never bundle them). Reported as
//     informational, with the patched version so consumers can pin it themselves.
//   - devDependencies / private-package root -> NOT SHIPPED. Never in a tarball.
//
// Rationale: a workspace-wide `pnpm audit` over a monorepo of ~50 connectors
// surfaces dozens of upstream advisories from peer SDKs (chromadb, agents,
// @google/genai, …) that are not part of anything BonkLM publishes and that our
// `pnpm.overrides` cannot fix for a consumer. The honest ship-blocking bar is
// "zero HIGH/CRITICAL in BonkLM's own shipped production closure" — this gate
// measures exactly that, and surfaces the peer-SDK set as consumer guidance.
// See docs/contributing/adr/0008-supply-chain-posture.md.
//
// Exit codes: 0 = no SHIPPED HIGH/CRITICAL. 1 = at least one (or an
// unclassifiable path — fail-safe). 2 = bad invocation / audit unavailable.
//
// Usage:
//   node scripts/supply-chain-audit.mjs                 # run pnpm audit live
//   node scripts/supply-chain-audit.mjs --input a.json  # read a saved audit JSON
//   node scripts/supply-chain-audit.mjs --json out.json # also write a report JSON
//   node scripts/supply-chain-audit.mjs --level critical # block only CRITICAL

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { shippedClosure } from './lib-shipped-closure.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEV_RANK = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };

function parseArgs(argv) {
  const out = { input: null, json: null, level: 'high' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--input') out.input = argv[++i];
    else if (a === '--json') out.json = argv[++i];
    else if (a === '--level') out.level = argv[++i];
    else if (a === '-h' || a === '--help') out.help = true;
    else {
      console.error(`unknown argument: ${a} (try --help)`);
      process.exit(2);
    }
  }
  return out;
}

// Map every workspace package to its dependency declarations, keyed by both its
// directory path ("packages/<dir>") and its npm name. The root project and any
// `private: true` package can never ship, so they are recorded as non-shipping.
function loadWorkspace() {
  const byKey = {};
  const record = (keyPath, keyName, p) => {
    const rec = {
      name: p.name,
      private: !!p.private,
      deps: p.dependencies || {},
      opt: p.optionalDependencies || {},
      peers: p.peerDependencies || {},
      devs: p.devDependencies || {}
    };
    if (keyPath) byKey[keyPath] = rec;
    if (keyName) byKey[keyName] = rec;
  };
  const root = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'));
  record('.', root.name, { ...root, private: true }); // root is never published
  const pkgsDir = join(REPO_ROOT, 'packages');
  for (const d of readdirSync(pkgsDir)) {
    const pj = join(pkgsDir, d, 'package.json');
    if (!existsSync(pj)) continue;
    // record() indexes by BOTH the path and the name, covering name-rooted audit paths.
    const p = JSON.parse(readFileSync(pj, 'utf8'));
    record(`packages/${d}`, p.name, p);
  }
  return byKey;
}

// Strip a trailing @version from a (possibly scoped) "name@range" token.
function depName(token) {
  const t = token.trim();
  const at = t.lastIndexOf('@');
  return at > 0 ? t.slice(0, at) : t;
}

// Classify an advisory path by the FIRST dependency edge out of a publishable
// BonkLM package: { kind, root, dep }, kind ∈ shipped|peer|dev|not-shipped|unknown.
//
// Why the first hop suffices: a BonkLM connector declares the SDK it wraps as a
// `peerDependencies` (consumer-installed) and its real runtime deps as
// `dependencies`, so the ship/consumer boundary lies EXACTLY at the first edge
// out of the connector. `pnpm audit` enumerates every path to a vulnerable
// instance, so a genuinely shipped vulnerable package always surfaces at least
// one dependencies-rooted path here. main() additionally cross-checks against the
// authoritative shipped closure as defense-in-depth.
function classifyPath(pathStr, ws) {
  const segs = pathStr
    .split('>')
    .map(s => s.trim())
    .filter(Boolean);
  const rootKey = segs[0];
  const rec = ws[rootKey];
  if (!rec) return { kind: 'unknown', root: rootKey, dep: segs[1] || '?' };
  if (rec.private) return { kind: 'not-shipped', root: rec.name, dep: segs[1] || '?' };
  const dep = depName(segs[1] || '');
  if (rec.deps[dep] || rec.opt[dep]) return { kind: 'shipped', root: rec.name, dep };
  if (rec.peers[dep]) return { kind: 'peer', root: rec.name, dep };
  if (rec.devs[dep]) return { kind: 'dev', root: rec.name, dep };
  // First hop is not a *direct* declaration of the publishable root. That only
  // happens for a deeper transitive than the audit chose to anchor; treat it as
  // unknown so it is surfaced rather than silently passed.
  return { kind: 'unknown', root: rec.name, dep };
}

function getAuditJson(input) {
  if (input) return JSON.parse(readFileSync(input, 'utf8'));
  let raw;
  try {
    raw = execFileSync('pnpm', ['audit', '--prod', '--json'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 128 * 1024 * 1024
    });
  } catch (e) {
    // pnpm audit exits non-zero when advisories are found; the JSON is on stdout.
    raw = e.stdout || '';
  }
  if (!raw.trim()) {
    console.error('fatal: `pnpm audit --prod --json` produced no output');
    process.exit(2);
  }
  try {
    return JSON.parse(raw);
  } catch {
    console.error('fatal: `pnpm audit --prod` did not return JSON (registry/network error?)');
    process.exit(2);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(
      'Usage: node scripts/supply-chain-audit.mjs [--input f.json] [--json out.json] [--level high|critical]'
    );
    process.exit(0);
  }
  const floor = SEV_RANK[args.level] ?? SEV_RANK.high;
  if (args.level !== 'high') {
    if (process.env.CI) {
      console.error(`refusing --level ${args.level} in CI: the supply-chain policy floor is HIGH`);
      process.exit(2);
    }
    console.error(`WARNING: --level ${args.level} relaxes the HIGH policy floor (local triage only)`);
  }
  const ws = loadWorkspace();
  const audit = getAuditJson(args.input);
  const advisories = Object.values(audit.advisories || {});

  // Authoritative shipped-closure name set — the SAME walk the license gate and
  // SBOM use, and an independent cross-check on the per-path classification below.
  const shippedNames = new Set([...shippedClosure({ repoRoot: REPO_ROOT }).values()].map(i => i.name));

  const shipped = [];
  const peerSupplied = [];
  const notShipped = []; // dev/internal-only (only reachable via a non-prod --input)

  for (const a of advisories) {
    if ((SEV_RANK[a.severity] ?? 0) < floor) continue;
    const paths = [];
    for (const f of a.findings || []) for (const p of f.paths || []) paths.push(p);
    const kinds = paths.map(p => classifyPath(p, ws));
    const roots = kind => [...new Set(kinds.filter(k => k.kind === kind).map(k => `${k.root}→${k.dep}`))];

    const entry = {
      module: a.module_name,
      severity: a.severity,
      patched: a.patched_versions,
      vulnerable: a.vulnerable_versions,
      title: (a.title || '').slice(0, 80),
      shippedVia: roots('shipped'),
      peerVia: roots('peer'),
      unknownVia: roots('unknown')
    };

    if (entry.shippedVia.length || entry.unknownVia.length) {
      // A dependencies-edge path (or a path we could not classify — fail-safe)
      // means the vulnerable package is in a BonkLM tarball's production closure.
      shipped.push(entry);
    } else if (entry.peerVia.length) {
      // Consumer-supplied via a peer SDK. Defense-in-depth: if the same module is
      // ALSO in the authoritative shipped closure, the two independent views
      // disagree — surface it for review (not auto-blocked, since a patched
      // shipped version can legitimately coexist with a vulnerable peer copy).
      if (shippedNames.has(entry.module)) entry.reviewShippedOverlap = true;
      peerSupplied.push(entry);
    } else {
      notShipped.push(entry);
    }
  }

  // ---- report -------------------------------------------------------------
  const m = (audit.metadata && audit.metadata.vulnerabilities) || {};
  console.log(`BonkLM supply-chain advisory gate (prod, blocking ≥ ${args.level})`);
  console.log(`pnpm audit --prod totals: ${JSON.stringify(m)}`);
  console.log('');

  if (peerSupplied.length) {
    console.log(`CONSUMER-SUPPLIED (peer-SDK upstream — NOT in any BonkLM tarball): ${peerSupplied.length}`);
    for (const e of peerSupplied.sort((x, y) => x.module.localeCompare(y.module))) {
      const review = e.reviewShippedOverlap
        ? ' ⚠ REVIEW: also in shipped closure — verify shipped version is patched'
        : '';
      console.log(`  • ${e.module} [${e.severity}] → pin ${e.patched}${review}`);
      console.log(`      via peers: ${e.peerVia.join(', ')}`);
    }
    console.log('  (BonkLM declares these SDKs as peerDependencies; consumers pin patched versions. See ADR-0008.)');
    console.log('');
  }

  if (shipped.length) {
    console.log(`SHIPPED HIGH/CRITICAL in BonkLM production closure: ${shipped.length}  ✗ BLOCKING`);
    for (const e of shipped) {
      console.log(`  ✗ ${e.module} [${e.severity}] patched=${e.patched}`);
      if (e.shippedVia.length) console.log(`      shipped via: ${e.shippedVia.join(', ')}`);
      if (e.unknownVia.length) console.log(`      UNCLASSIFIED path (fail-safe): ${e.unknownVia.join(', ')}`);
    }
    console.log('');
  } else {
    console.log('SHIPPED HIGH/CRITICAL in BonkLM production closure: 0  ✓');
    console.log('');
  }

  if (args.json) {
    writeFileSync(
      args.json,
      JSON.stringify({ totals: m, shipped, peerSupplied, notShipped, level: args.level }, null, 2)
    );
    console.log(`report written: ${args.json}`);
  }

  if (shipped.length) {
    console.log('RESULT: FAIL — BonkLM ships a HIGH/CRITICAL advisory (or an unclassifiable path). Fix or override.');
    process.exit(1);
  }
  console.log('RESULT: PASS — zero HIGH/CRITICAL in BonkLM’s shipped production closure.');
  process.exit(0);
}

main();
