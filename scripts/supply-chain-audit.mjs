#!/usr/bin/env node
//
// BonkLM supply-chain advisory gate.
//
// Runs `pnpm audit --prod --json` and classifies every HIGH/CRITICAL advisory by
// the FIRST dependency edge on its path out of a *publishable* BonkLM package:
//
//   - dependencies / optionalDependencies  -> SHIPPED. The vulnerable package is
//     in a BonkLM tarball's production closure. This BLOCKS the gate.
//   - required peerDependencies             -> DEFAULT INSTALL SURFACE. npm 7+
//     installs these automatically, so HIGH/CRITICAL findings block the gate.
//   - optional peerDependencies             -> CONSUMER-SUPPLIED. The vulnerable
//     package rides in only when a consumer explicitly installs that SDK.
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
import { dirname, join, relative, resolve } from 'node:path';
import semver from 'semver';
import { loadManifest, selectPublishableRoots, shippedClosure } from './lib-shipped-closure.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEV_RANK = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
// eslint-disable-next-line no-control-regex -- explicit CI log-forgery boundary includes C0/C1 controls
const UNSAFE_LOG_TEXT = /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2069\ufeff]/u;

function safeAuditText(value, { allowEmpty = false, max = 4096 } = {}) {
  return (
    typeof value === 'string' && (allowEmpty || value.length > 0) && value.length <= max && !UNSAFE_LOG_TEXT.test(value)
  );
}

export function parseArgs(argv, { error = console.error, exit = process.exit } = {}) {
  const out = { input: null, json: null, level: 'high', roots: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--input') out.input = argv[++i];
    else if (a === '--json') out.json = argv[++i];
    else if (a === '--level') out.level = argv[++i];
    else if (a === '--root') out.roots.push(argv[++i]);
    else if (a === '-h' || a === '--help') out.help = true;
    else {
      error(`unknown argument: ${a} (try --help)`);
      exit(2);
      return null;
    }
  }
  if (!Object.hasOwn(SEV_RANK, out.level)) {
    error(`invalid severity level: ${out.level}`);
    exit(2);
    return null;
  }
  return out;
}

// Map every workspace package to its dependency declarations, keyed by both its
// directory path ("packages/<dir>") and its npm name. The root project and any
// `private: true` package can never ship, so they are recorded as non-shipping.
export function loadWorkspace(roots, repoRoot = REPO_ROOT) {
  const byKey = {};
  const selectedDirectories = new Set(roots.map(root => resolve(root.dir)));
  const record = (keyPath, keyName, p) => {
    const rec = {
      name: p.name,
      private: !!p.private,
      selected: selectedDirectories.has(resolve(repoRoot, keyPath)),
      deps: p.dependencies || {},
      opt: p.optionalDependencies || {},
      peers: p.peerDependencies || {},
      peerMeta: p.peerDependenciesMeta || {},
      devs: p.devDependencies || {}
    };
    byKey[keyPath] = rec;
    byKey[keyName] = rec;
  };
  const rootManifest = loadManifest(repoRoot);
  record('.', rootManifest.name, { ...rootManifest, private: true });
  for (const area of ['packages', 'tools']) {
    const base = join(repoRoot, area);
    if (!existsSync(base)) continue;
    for (const directory of readdirSync(base)) {
      const path = join(base, directory);
      if (!existsSync(join(path, 'package.json'))) continue;
      const manifest = loadManifest(path);
      record(relative(repoRoot, path), manifest.name, manifest);
    }
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
// `peerDependencies`; optional peers are consumer-selected, while required peers
// are part of npm's default install surface. `pnpm audit` enumerates every path to
// a vulnerable instance, so a genuinely shipped or auto-installed package always
// surfaces at least one blocking path here.
export function classifyPath(pathStr, ws) {
  const segs = pathStr
    .split('>')
    .map(s => s.trim())
    .filter(Boolean);
  let knownUnselected;
  for (let index = 0; index < segs.length - 1; index += 1) {
    const rec = ws[segs[index]] ?? ws[depName(segs[index])];
    if (!rec) continue;
    if (rec.private || !rec.selected) {
      knownUnselected = rec;
      continue;
    }
    const dep = depName(segs[index + 1]);
    if (rec.deps[dep] || rec.opt[dep]) return { kind: 'shipped', root: rec.name, dep };
    if (rec.peers[dep]) {
      return { kind: rec.peerMeta[dep]?.optional === true ? 'peer' : 'install-surface', root: rec.name, dep };
    }
    if (rec.devs[dep]) return { kind: 'dev', root: rec.name, dep };
    return { kind: 'unknown', root: rec.name, dep };
  }
  return knownUnselected
    ? { kind: 'not-shipped', root: knownUnselected.name, dep: depName(segs.at(-1)) }
    : { kind: 'unknown', root: segs[0], dep: segs[1] || '?' };
}

function validAdvisory(advisory) {
  return (
    advisory &&
    safeAuditText(advisory.module_name, { max: 256 }) &&
    typeof advisory.severity === 'string' &&
    Object.hasOwn(SEV_RANK, advisory.severity) &&
    safeAuditText(advisory.patched_versions, { allowEmpty: true, max: 1024 }) &&
    safeAuditText(advisory.vulnerable_versions, { allowEmpty: true, max: 1024 }) &&
    (advisory.title === undefined || safeAuditText(advisory.title, { allowEmpty: true, max: 1024 })) &&
    semver.validRange(advisory.vulnerable_versions) !== null &&
    Array.isArray(advisory.findings) &&
    advisory.findings.length > 0 &&
    advisory.findings.every(
      finding =>
        semver.valid(finding?.version) !== null &&
        semver.satisfies(finding.version, advisory.vulnerable_versions, { includePrerelease: true }) &&
        Array.isArray(finding.paths) &&
        finding.paths.every(p => safeAuditText(p))
    )
  );
}

function validSeverityCounts(vulnerabilities, advisoryValues) {
  if (vulnerabilities === null || typeof vulnerabilities !== 'object' || Array.isArray(vulnerabilities)) return false;
  return Object.keys(SEV_RANK).every(severity => {
    const expected = advisoryValues
      .filter(advisory => advisory?.severity === severity)
      .reduce((count, advisory) => count + advisory.findings.length, 0);
    return (
      Number.isInteger(vulnerabilities[severity]) &&
      vulnerabilities[severity] >= 0 &&
      vulnerabilities[severity] === expected
    );
  });
}

export function parseAuditJson(raw) {
  let audit;
  try {
    audit = JSON.parse(raw);
  } catch {
    throw new Error('pnpm audit output is not valid JSON');
  }
  const advisories = audit?.advisories;
  const advisoryValues =
    advisories !== null && typeof advisories === 'object' && !Array.isArray(advisories)
      ? Object.values(advisories)
      : [];
  if (
    audit?.error !== undefined ||
    advisories === null ||
    typeof advisories !== 'object' ||
    Array.isArray(advisories) ||
    advisoryValues.some(advisory => !validAdvisory(advisory)) ||
    !validSeverityCounts(audit?.metadata?.vulnerabilities, advisoryValues)
  ) {
    throw new Error('pnpm audit JSON does not match the expected advisory schema');
  }
  return audit;
}

export function getAuditJson(
  input,
  {
    error: reportError = console.error,
    exit = process.exit,
    read = readFileSync,
    repoRoot = REPO_ROOT,
    run = execFileSync
  } = {}
) {
  if (input) return parseAuditJson(read(input, 'utf8'));
  let raw;
  try {
    raw = run('pnpm', ['audit', '--prod', '--json'], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 128 * 1024 * 1024
    });
  } catch (e) {
    // pnpm audit exits non-zero when advisories are found; the JSON is on stdout.
    if (e?.status !== 1 || e?.signal !== null) {
      reportError('fatal: `pnpm audit --prod --json` did not complete normally');
      exit(2);
      return null;
    }
    raw = e.stdout || '';
  }
  if (!raw.trim()) {
    reportError('fatal: `pnpm audit --prod --json` produced no output');
    exit(2);
    return null;
  }
  try {
    return parseAuditJson(raw);
  } catch (caught) {
    reportError(`fatal: ${caught.message} (registry/network error?)`);
    exit(2);
    return null;
  }
}

function classifyAdvisories({ advisories, closure, floor, workspace }) {
  const closureKeys = new Set(closure.keys());
  const result = { shipped: [], peerSupplied: [], notShipped: [] };
  for (const advisory of advisories) classifyAdvisory({ advisory, closureKeys, floor, result, workspace });
  return result;
}

function classifyAdvisory({ advisory, closureKeys, floor, result, workspace }) {
  if (SEV_RANK[advisory.severity] < floor) return;
  const paths = advisory.findings.flatMap(finding => finding.paths);
  const kinds = paths.map(path => classifyPath(path, workspace));
  const roots = kind => [...new Set(kinds.filter(item => item.kind === kind).map(item => `${item.root}→${item.dep}`))];
  const closureVersions = [
    ...new Set(
      advisory.findings
        .filter(finding => closureKeys.has(`${advisory.module_name}@${finding.version}`))
        .map(finding => finding.version)
    )
  ];
  const entry = {
    module: advisory.module_name,
    severity: advisory.severity,
    patched: advisory.patched_versions,
    vulnerable: advisory.vulnerable_versions,
    title: (advisory.title || '').slice(0, 80),
    shippedVia: roots('shipped'),
    installVia: roots('install-surface'),
    peerVia: roots('peer'),
    unknownVia: roots('unknown'),
    closureVersions
  };
  if (entry.shippedVia.length || entry.installVia.length || entry.unknownVia.length || closureVersions.length) {
    result.shipped.push(entry);
  } else if (entry.peerVia.length) result.peerSupplied.push(entry);
  else result.notShipped.push(entry);
}

function printPeerReport(peerSupplied, log) {
  if (!peerSupplied.length) return;
  log(`CONSUMER-SUPPLIED (optional peer-SDK upstream — NOT installed by default): ${peerSupplied.length}`);
  for (const entry of peerSupplied.sort((left, right) => left.module.localeCompare(right.module))) {
    log(`  • ${entry.module} [${entry.severity}] → pin ${entry.patched}`);
    log(`      via peers: ${entry.peerVia.join(', ')}`);
  }
  log('  (BonkLM declares these SDKs as optional peerDependencies; consumers audit their selected SDK.)');
  log('');
}

function printShippedReport(shipped, log) {
  if (!shipped.length) {
    log('SHIPPED HIGH/CRITICAL in BonkLM production closure: 0  ✓');
    log('');
    return;
  }
  log(`SHIPPED HIGH/CRITICAL in BonkLM production closure: ${shipped.length}  ✗ BLOCKING`);
  for (const entry of shipped) {
    log(`  ✗ ${entry.module} [${entry.severity}] patched=${entry.patched}`);
    if (entry.closureVersions.length) log(`      resolved install closure: ${entry.closureVersions.join(', ')}`);
    if (entry.shippedVia.length) log(`      shipped via: ${entry.shippedVia.join(', ')}`);
    if (entry.installVia.length) log(`      required peer via: ${entry.installVia.join(', ')}`);
    if (entry.unknownVia.length) log(`      UNCLASSIFIED path (fail-safe): ${entry.unknownVia.join(', ')}`);
  }
  log('');
}

function printReport({ args, audit, peerSupplied, shipped }, log) {
  const totals = audit.metadata?.vulnerabilities || {};
  log(`BonkLM supply-chain advisory gate (prod, blocking ≥ ${args.level})`);
  log(`pnpm audit --prod totals: ${JSON.stringify(totals)}`);
  log('');
  printPeerReport(peerSupplied, log);
  printShippedReport(shipped, log);
  return totals;
}

export function main(options) {
  const { argv, audit, auditLoader, closure, env, error, exit, log, repoRoot, roots, workspace, write } = Object.assign(
    {
      argv: process.argv.slice(2),
      auditLoader: getAuditJson,
      env: process.env,
      error: console.error,
      exit: process.exit,
      log: console.log,
      repoRoot: REPO_ROOT,
      write: writeFileSync
    },
    options
  );
  const args = parseArgs(argv, { error, exit });
  if (!args) return null;
  if (args.help) {
    log('Usage: node scripts/supply-chain-audit.mjs [--input f.json] [--json out.json] [--level high|critical]');
    exit(0);
    return null;
  }
  const floor = SEV_RANK[args.level];
  if (args.level !== 'high') {
    if (env.CI) {
      error(`refusing --level ${args.level} in CI: the supply-chain policy floor is HIGH`);
      exit(2);
      return null;
    }
    error(`WARNING: --level ${args.level} relaxes the HIGH policy floor (local triage only)`);
  }
  const selectedRoots = roots ?? selectPublishableRoots(repoRoot, args.roots);
  const selectedWorkspace = workspace ?? loadWorkspace(selectedRoots, repoRoot);
  const selectedAudit = audit ?? auditLoader(args.input, { error, exit, repoRoot });
  if (!selectedAudit) return null;
  const selectedClosure = closure ?? shippedClosure({ repoRoot, roots: selectedRoots });
  const result = classifyAdvisories({
    advisories: Object.values(selectedAudit.advisories),
    closure: selectedClosure,
    floor,
    workspace: selectedWorkspace
  });
  const totals = printReport({ args, audit: selectedAudit, ...result }, log);

  if (args.json) {
    write(args.json, JSON.stringify({ totals, ...result, level: args.level }, null, 2));
    log(`report written: ${args.json}`);
  }

  if (result.shipped.length) {
    log('RESULT: FAIL — BonkLM ships a HIGH/CRITICAL advisory (or an unclassifiable path). Fix or override.');
    exit(1);
    return result;
  }
  log('RESULT: PASS — zero HIGH/CRITICAL in BonkLM’s shipped production closure.');
  exit(0);
  return result;
}

export function runCli(options) {
  const { argv1, scriptPath, run } = Object.assign(
    { argv1: process.argv[1], scriptPath: fileURLToPath(import.meta.url), run: main },
    options
  );
  if (!argv1 || resolve(argv1) !== scriptPath) return false;
  run();
  return true;
}

runCli();
