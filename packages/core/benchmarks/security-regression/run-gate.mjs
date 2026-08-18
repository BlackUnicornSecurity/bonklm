#!/usr/bin/env node
/**
 * Security-Regression Gate (content surface)
 * ===========================================
 *
 * Deterministic, offline replay of the COMMITTED, labelled corpora through
 * every content-surface detection component, enforcing NO-REGRESSION against
 * a committed per-component baseline (`baseline.json`).
 *
 * Why this gate exists: the heavyweight corpus-replay evidence (dojoLM
 * dual-accredited fixtures, Gate-5 recall floors) lives under the gitignored
 * `team/` tree with external corpus roots, so it cannot be a repo-default
 * gate. This runner uses only in-repo, committed, hash-pinned corpora:
 *
 *   - benchmarks/sandbox-attack-corpus/   (attack patterns verified by its
 *     own `corpus.hash`; the BENIGN corpus — the FPR denominator — is
 *     pinned by THIS gate's `corpus-integrity.hash`, because a benign
 *     entry deletion could otherwise mask an FPR regression)
 *   - benchmarks/multilingual-corpus/<lang>/  (true-positives +
 *     true-negatives per language; pinned by `corpus-integrity.hash`)
 *
 * Semantics — baseline regression, NOT absolute floors: each component's
 * per-corpus recall may only go UP and FPR may only go DOWN versus the
 * baseline (with a 1e-9 epsilon for float formatting). The baseline is the
 * measured behavior at gate-creation time; re-baselining requires
 * `--regen-baseline` + reviewer sign-off on the committed diff (mirroring
 * tarball-snapshot regen discipline). No invented thresholds — the Gate-5
 * ratified floors stay with the team/ evidence.
 *
 * PER-COMPONENT measurement (not union): a union baseline would mask a
 * single detector's regression whenever a sibling still catches the payload
 * — exactly the silent recall loss this gate exists to catch. Each component
 * is measured alone; any drop trips the gate.
 *
 * Determinism contract (mirrors run-graduation-gate.mjs): no wall-clock
 * values; sorted keys; fixed 4-dp float formatting. A no-op re-run is
 * byte-stable, so `--regen-baseline` output is diff-reviewable.
 *
 * Components: the six advertised content classes (PromptInjection,
 * Jailbreak, CodeInjection, Multilingual, Reformulation, Boundary) + the
 * shipped content-surface guards (Secret, PII, XSS, BashSafety) + the newer
 * detection layers (EncodedRescan, HarmIntent, SocialEngineering —
 * typeof-guarded so a core without the export still yields a comparable
 * run, mirroring the internal replay harness convention). Components are
 * constructed with a no-op logger: replay chatter is gate noise.
 *
 * Run:
 *   node packages/core/benchmarks/security-regression/run-gate.mjs
 *   node packages/core/benchmarks/security-regression/run-gate.mjs --regen-baseline
 *   node packages/core/benchmarks/security-regression/run-gate.mjs --regen-hash
 *     (corpus changed: re-pins corpus-integrity.hash; pair with
 *     --regen-baseline + reviewer sign-off on BOTH diffs)
 *
 * Requires the built core (pnpm --filter @blackunicorn/bonklm build) — the
 * quality gate's build step runs first.
 *
 * Exits: 0 = no regression (or baseline regenerated). 1 = regression or
 * integrity failure.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BENCH_ROOT = join(__dirname, '..');
const CORE_DIST = join(BENCH_ROOT, '..', 'dist', 'index.js');
const SANDBOX_DIR = join(BENCH_ROOT, 'sandbox-attack-corpus');
const MULTILINGUAL_DIR = join(BENCH_ROOT, 'multilingual-corpus');
const BASELINE_PATH = join(__dirname, 'baseline.json');
const HASH_PATH = join(__dirname, 'corpus-integrity.hash');

const EPSILON = 1e-9;
const REGEN = process.argv.includes('--regen-baseline');
const REGEN_HASH = process.argv.includes('--regen-hash');

/** No-op logger — replay must not spam the gate log per finding. */
const SILENT = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
};

// ---------------------------------------------------------------------------
// Integrity preconditions.
// ---------------------------------------------------------------------------

function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

function fail(msg) {
  console.error(`security-regression: ${msg}`);
  process.exit(1);
}

if (!existsSync(CORE_DIST)) {
  fail(`built core missing: ${CORE_DIST} — run pnpm --filter @blackunicorn/bonklm build first`);
}

// Verify the sandbox corpus's own hash pin (integrity precondition — its
// graduation gate maintains it; a mismatch is a corpus-tamper signal).
{
  const expected = readFileSync(join(SANDBOX_DIR, 'corpus.hash'), 'utf-8').trim();
  const actual = sha256(readFileSync(join(SANDBOX_DIR, 'patterns.json'), 'utf-8'));
  if (expected !== actual) {
    fail(`sandbox-attack-corpus hash-pin mismatch: expected ${expected}, measured ${actual}`);
  }
}

// Integrity fingerprint over every corpus input THIS gate measures that is
// not already pinned elsewhere: the sandbox benign corpus (FPR denominator)
// and the multilingual tp/tn files. Deterministic composition order.
function corpusFingerprint() {
  const parts = [
    `sandbox/benign-corpus.json:${sha256(readFileSync(join(SANDBOX_DIR, 'benign-corpus.json'), 'utf-8'))}`
  ];
  const langs = readdirSync(MULTILINGUAL_DIR)
    .filter(e => statSync(join(MULTILINGUAL_DIR, e)).isDirectory())
    .sort();
  for (const lang of langs) {
    for (const kind of ['true-negatives.json', 'true-positives.json']) {
      const p = join(MULTILINGUAL_DIR, lang, kind);
      if (!existsSync(p)) continue;
      parts.push(`multilingual/${lang}/${kind}:${sha256(readFileSync(p, 'utf-8'))}`);
    }
  }
  return sha256(parts.join('\n'));
}

// Hash-pin verification runs BEFORE --regen-baseline so regenerating can
// never paper over a corpus edit: --regen-baseline on a changed corpus
// without --regen-hash still fails here first. A MISSING pin may bootstrap
// via --regen-hash (first-time setup); a MISMATCH never auto-heals.
if (!existsSync(HASH_PATH)) {
  if (REGEN_HASH) {
    writeFileSync(HASH_PATH, corpusFingerprint() + '\n');
    console.log(`security-regression: corpus-integrity hash PINNED (${HASH_PATH}).`);
    process.exit(0);
  }
  fail(`corpus-integrity hash pin missing: ${HASH_PATH} — create it with --regen-hash and reviewer sign-off`);
}
{
  const expected = readFileSync(HASH_PATH, 'utf-8').trim();
  const actual = corpusFingerprint();
  if (expected !== actual) {
    if (REGEN_HASH) {
      writeFileSync(HASH_PATH, corpusFingerprint() + '\n');
      console.log(`security-regression: corpus-integrity hash RE-PINNED (${HASH_PATH}) —`);
      console.log('pair with --regen-baseline if metrics moved; commit both diffs with sign-off.');
      process.exit(0);
    }
    fail(
      `corpus-integrity hash-pin mismatch: expected ${expected}, measured ${actual} — ` +
        'a measured corpus input changed; re-pin with --regen-hash AND re-baseline, ' +
        'both with reviewer sign-off'
    );
  }
}

// ---------------------------------------------------------------------------
// Corpus loading.
// ---------------------------------------------------------------------------

/** @typedef {{ id: string, payload: string, expected_block: boolean }} Entry */

/** @type {Array<{ corpus: string, entries: Entry[] }>} */
const corpora = [];

{
  const attacks = JSON.parse(readFileSync(join(SANDBOX_DIR, 'patterns.json'), 'utf-8'));
  const benign = JSON.parse(readFileSync(join(SANDBOX_DIR, 'benign-corpus.json'), 'utf-8'));
  const rows = [
    ...Object.values(attacks).map(e => ({ id: e.id, payload: e.payload, expected_block: e.expected_block === true })),
    ...benign.map(e => ({ id: e.id, payload: e.payload, expected_block: false }))
  ];
  corpora.push({ corpus: 'sandbox-attack-corpus', entries: rows });
}

for (const lang of readdirSync(MULTILINGUAL_DIR)
  .filter(e => statSync(join(MULTILINGUAL_DIR, e)).isDirectory())
  .sort()) {
  const rows = [];
  for (const kind of ['true-positives.json', 'true-negatives.json']) {
    const p = join(MULTILINGUAL_DIR, lang, kind);
    if (!existsSync(p)) continue;
    for (const e of JSON.parse(readFileSync(p, 'utf-8'))) {
      rows.push({ id: e.id, payload: e.payload, expected_block: e.expected_block === true });
    }
  }
  corpora.push({ corpus: `multilingual:${lang}`, entries: rows });
}

// ---------------------------------------------------------------------------
// Component stack (per-component measurement).
// ---------------------------------------------------------------------------

const core = await import(CORE_DIST);

/** @type {Array<{ name: string, validate: (payload: string) => Promise<{blocked: boolean}> | {blocked: boolean}> }>} */
const components = [];
function register(name, Ctor) {
  if (typeof Ctor !== 'function') return; // typeof-guarded, dojolm convention
  components.push({ name, instance: new Ctor({ logger: SILENT }) });
}

register('prompt-injection', core.PromptInjectionValidator);
register('jailbreak', core.JailbreakValidator);
register('code-injection', core.CodeInjectionValidator);
register('multilingual', core.MultilingualDetector);
register('reformulation', core.ReformulationDetector);
register('boundary', core.BoundaryDetector);
register('encoded-rescan', core.EncodedRescanValidator);
register('harm-intent', core.HarmIntentValidator);
register('social-engineering', core.SocialEngineeringValidator);
register('secret', core.SecretGuard);
register('pii', core.PIIGuard);
register('xss', core.XSSGuard);
register('bash-safety', core.BashSafetyGuard);

if (components.length === 0) {
  fail('no detection components resolved from the built core');
}

// ---------------------------------------------------------------------------
// Replay + measurement.
// ---------------------------------------------------------------------------

/** Round to 4dp for stable serialization. */
const r4 = x => Math.round(x * 10000) / 10000;

async function measureComponent(component, { corpus, entries }) {
  let tp = 0;
  let fn = 0;
  let tn = 0;
  let fp = 0;
  const misses = [];
  const falseAlarms = [];
  for (const e of entries) {
    let blocked;
    try {
      blocked = (await component.instance.validate(e.payload)).blocked === true;
    } catch {
      blocked = e.expected_block ? false : true; // a thrown validator is a hard miss/alarm
    }
    if (e.expected_block) {
      if (blocked) tp += 1;
      else {
        fn += 1;
        misses.push(e.id);
      }
    } else if (blocked) {
      fp += 1;
      falseAlarms.push(e.id);
    } else {
      tn += 1;
    }
  }
  const positives = tp + fn;
  const negatives = fp + tn;
  return {
    component: component.name,
    corpus,
    tp,
    fn,
    fp,
    recall: positives === 0 ? 1 : r4(tp / positives),
    fpr: negatives === 0 ? 0 : r4(fp / negatives),
    misses,
    falseAlarms
  };
}

/** @type {Array<ReturnType<typeof measureComponent> extends Promise<infer T> ? T : never>} */
const results = [];
for (const component of components) {
  for (const c of corpora) {
    results.push(await measureComponent(component, c));
  }
}

// ---------------------------------------------------------------------------
// Baseline compare / regen.
// ---------------------------------------------------------------------------

function serializeBaseline(rs) {
  const out = {};
  for (const r of rs) {
    out[`${r.component}|${r.corpus}`] = { recall: r.recall, fpr: r.fpr, fn: r.fn, fp: r.fp };
  }
  return JSON.stringify(out, null, 2) + '\n';
}

if (REGEN) {
  writeFileSync(BASELINE_PATH, serializeBaseline(results));
  console.log(`security-regression: baseline REGENERATED (${results.length} component×corpus rows) —`);
  console.log('diff-review and commit with sign-off.');
  process.exit(0);
}

if (!existsSync(BASELINE_PATH)) {
  fail(`baseline missing: ${BASELINE_PATH} — create it with --regen-baseline and reviewer sign-off`);
}
const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf-8'));

const regressions = [];
for (const r of results) {
  const key = `${r.component}|${r.corpus}`;
  const b = baseline[key];
  if (!b) {
    regressions.push(`${key}: no baseline entry (component or corpus changed — re-baseline required)`);
    continue;
  }
  if (r.recall < b.recall - EPSILON) {
    regressions.push(
      `${key}: recall REGRESSED ${b.recall} -> ${r.recall} (misses: ${r.misses.slice(0, 5).join(', ')}${r.misses.length > 5 ? ' …' : ''})`
    );
  }
  if (r.fpr > b.fpr + EPSILON) {
    regressions.push(
      `${key}: FPR REGRESSED ${b.fpr} -> ${r.fpr} (new false alarms: ${r.falseAlarms.slice(0, 5).join(', ')}${r.falseAlarms.length > 5 ? ' …' : ''})`
    );
  }
}
// A baseline row with no live counterpart = a component/corpus was REMOVED —
// that is also a regression of coverage.
for (const key of Object.keys(baseline)) {
  if (!results.some(r => `${r.component}|${r.corpus}` === key)) {
    regressions.push(`${key}: baseline row has no live measurement (component or corpus removed)`);
  }
}

if (regressions.length > 0) {
  console.error(`security-regression: DETECTION REGRESSION vs committed baseline (${regressions.length} finding(s)):`);
  for (const line of regressions) console.error(`  - ${line}`);
  console.error('');
  console.error('A detection change made things worse on a labelled corpus. Fix the regression, or —');
  console.error('if the trade-off is intentional — re-baseline with --regen-baseline and reviewer');
  console.error('sign-off, committing the baseline diff for review (tarball-snapshot regen discipline).');
  process.exit(1);
}

console.log(
  `security-regression: no regression vs committed baseline (${results.length} component×corpus rows, ${components.length} components).`
);
