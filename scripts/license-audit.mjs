#!/usr/bin/env node
//
// BonkLM dependency license gate.
//
// Policy: BonkLM's SHIPPED production closure (see lib-shipped-closure.mjs) must
// contain only permissive licenses — no strong copyleft (GPL/AGPL), no weak
// copyleft (LGPL), no proprietary/custom, no Unknown. A dual `A OR B` license
// passes if ANY disjunct is permissive; an `A AND B` license passes only if EVERY
// conjunct is permissive.
//
// Peer-SDK transitives (chromadb, agents, @sap/xssec, sharp, …) are NOT part of
// any BonkLM tarball — they ride in through connector peerDependencies the
// consumer installs. Their licenses are reported as consumer-awareness, never as
// a BonkLM ship-blocker. See docs/contributing/adr/0008-supply-chain-posture.md.
//
// Exit codes: 0 = shipped closure clean. 1 = a flagged license in the shipped
// closure. 2 = bad invocation.
//
// Usage:
//   node scripts/license-audit.mjs                 # gate (shipped closure)
//   node scripts/license-audit.mjs --json out.json # also write a report
//   node scripts/license-audit.mjs --full          # also list peer-SDK flags

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { shippedClosure } from './lib-shipped-closure.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const PERMISSIVE = new Set([
  'MIT',
  'Apache-2.0',
  'Apache 2.0',
  'Apache',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'BSD',
  '0BSD',
  'Unlicense',
  'BlueOak-1.0.0',
  'CC0-1.0',
  'Python-2.0',
  'WTFPL',
  'Zlib',
  'AFL-2.1'
]);
// Deliberately NOT permissive: MPL-2.0 (file-level weak copyleft) and CC-BY-4.0
// (a content, not software, license) are flagged for explicit review if they
// ever enter the shipped closure.

function atomPermissive(a) {
  return PERMISSIVE.has(a.trim().replace(/[()]/g, '').trim());
}

// classify -> 'ok' | 'lgpl' | 'flagged'. Evaluates an SPDX-ish expression with
// the correct precedence: `A AND B` is permissive only if EVERY conjunct is;
// `A OR B` if ANY disjunct is; and AND binds tighter than OR (so `A OR B AND C`
// is `A OR (B AND C)`). A parenthesised expression mixing both operators needs a
// real precedence parser we don't ship here, so it is conservatively flagged for
// human review rather than risk mis-evaluating the grouping.
function classify(expr) {
  if (!expr || expr === 'Unknown') return 'flagged';
  const raw = String(expr).trim();
  // SPDX operators are whitespace-delimited; match ` OR `/` AND ` (not a bare
  // \bOR\b) so the "or"/"and" inside ids like `LGPL-3.0-or-later` is not split.
  const hasOr = /\sOR\s/i.test(raw);
  const hasAnd = /\sAND\s/i.test(raw);
  if (raw.includes('(') && hasOr && hasAnd) return 'flagged';
  const e = raw.replace(/[()]/g, '').trim();
  // OR is lowest precedence — split it first; each disjunct may itself be an AND.
  if (hasOr) {
    return e.split(/\s+OR\s+/i).some(p => classify(p.trim()) === 'ok') ? 'ok' : /LGPL/i.test(e) ? 'lgpl' : 'flagged';
  }
  if (hasAnd) {
    return e.split(/\s+AND\s+/i).every(p => classify(p.trim()) === 'ok') ? 'ok' : 'flagged';
  }
  if (atomPermissive(e)) return 'ok';
  if (/^LGPL/i.test(e)) return 'lgpl';
  return 'flagged';
}

function parseArgs(argv) {
  const out = { json: null, full: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = argv[++i];
    else if (a === '--full') out.full = true;
    else if (a === '-h' || a === '--help') out.help = true;
    else {
      console.error(`unknown argument: ${a}`);
      process.exit(2);
    }
  }
  return out;
}

// Best-effort map of the whole --prod tree's package@version -> license, for the
// consumer-awareness appendix. Tolerates pnpm output drift.
function fullProdLicenseMap() {
  const map = new Map();
  try {
    const raw = execFileSync('pnpm', ['licenses', 'list', '--prod', '--json'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 128 * 1024 * 1024
    });
    const o = JSON.parse(raw);
    for (const [lic, pkgs] of Object.entries(o)) {
      for (const p of pkgs) {
        const versions = p.versions || (p.version ? [p.version] : ['*']);
        for (const v of versions) map.set(`${p.name}@${v}`, lic);
      }
    }
  } catch {
    /* advisory appendix only — never blocks */
  }
  return map;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node scripts/license-audit.mjs [--json out.json] [--full]');
    process.exit(0);
  }

  const closure = shippedClosure({ repoRoot: REPO_ROOT });
  const byLicense = {};
  const flagged = [];
  for (const info of closure.values()) {
    if (info.viaWorkspace) continue; // first-party @blackunicorn/* — Apache-2.0/BUSL by policy
    const verdict = classify(info.license);
    (byLicense[info.license] ||= []).push(info.name);
    if (verdict !== 'ok') flagged.push({ ...info, verdict });
  }

  console.log('BonkLM license gate — SHIPPED production closure');
  console.log(`shipped third-party packages: ${[...closure.values()].filter(i => !i.viaWorkspace).length}`);
  console.log('license distribution:');
  for (const lic of Object.keys(byLicense).sort()) {
    console.log(`  ${String(byLicense[lic].length).padStart(3)}  ${lic}`);
  }
  console.log('');

  // consumer-awareness appendix: concerning licenses in the broader peer-SDK tree
  const shippedKeys = new Set([...closure.keys()]);
  const peerFlags = [];
  if (args.full || args.json) {
    for (const [key, lic] of fullProdLicenseMap()) {
      if (shippedKeys.has(key)) continue;
      if (classify(lic) !== 'ok') peerFlags.push({ key, license: lic });
    }
  }
  if (args.full && peerFlags.length) {
    console.log(
      `CONSUMER-AWARENESS — non-permissive licenses in peer-SDK transitives (NOT shipped by BonkLM): ${peerFlags.length}`
    );
    for (const f of peerFlags.sort((a, b) => a.key.localeCompare(b.key))) {
      console.log(`  • ${f.key} — ${f.license}`);
    }
    console.log('');
  }

  if (args.json) {
    writeFileSync(
      args.json,
      JSON.stringify(
        {
          shippedClosureSize: closure.size,
          shippedThirdParty: [...closure.values()]
            .filter(i => !i.viaWorkspace)
            .map(i => ({ name: i.name, version: i.version, license: i.license })),
          shippedByLicense: Object.fromEntries(Object.entries(byLicense).map(([k, v]) => [k, v.length])),
          flaggedInShipped: flagged,
          peerSuppliedFlags: peerFlags
        },
        null,
        2
      )
    );
    console.log(`report written: ${args.json}`);
  }

  if (flagged.length) {
    console.log(`RESULT: FAIL — ${flagged.length} non-permissive license(s) in BonkLM's shipped closure:`);
    for (const f of flagged) console.log(`  ✗ ${f.name}@${f.version} — ${f.license} (${f.verdict})`);
    process.exit(1);
  }
  console.log('RESULT: PASS — BonkLM ships only permissive-licensed dependencies.');
  process.exit(0);
}

main();
