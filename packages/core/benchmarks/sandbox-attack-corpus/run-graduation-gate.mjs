#!/usr/bin/env node
/**
 * Story 4.5 — Sandbox Graduation Gate (Sprint 24)
 *
 * Runs `CodeInjectionValidator` against the R2-13 hash-pinned attack
 * corpus + a labelled benign corpus. Computes recall + FPR +
 * precision and emits a JSON decision report.
 *
 * Thresholds (Sprint 24 AC):
 *   - recall ≥ 95%
 *   - FPR ≤ 5%
 *   - precision ≥ 80%
 *
 * If ALL three pass → graduation candidate.
 * If ANY fail → keep `experimental: true`, document gap categories.
 *
 * AAD-E protocol per Sprint 23 Story 3.12 retirement decision tooling:
 *   - 24h cooldown between corpus-evidence selection and graduation
 *     review.
 *   - Self-review checklist at `team/audit-baselines/sandbox-graduation-checklist.md`.
 *   - PR attestation enumerates corpus-hash-pin commit SHA + CVE/OWASP
 *     identifiers.
 *
 * Run:
 *   node packages/core/benchmarks/sandbox-attack-corpus/run-graduation-gate.mjs
 *
 * Emits:
 *   packages/core/benchmarks/sandbox-attack-corpus/graduation-report.json
 *   packages/core/benchmarks/sandbox-attack-corpus/graduation-report.txt
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORPUS_PATH = join(__dirname, 'patterns.json');
const HASH_PATH = join(__dirname, 'corpus.hash');
const BENIGN_PATH = join(__dirname, 'benign-corpus.json');
const REPORT_JSON_PATH = join(__dirname, 'graduation-report.json');
const REPORT_TXT_PATH = join(__dirname, 'graduation-report.txt');

// Thresholds per Story 4.5 AC.
const RECALL_THRESHOLD = 0.95;
const FPR_THRESHOLD = 0.05;
const PRECISION_THRESHOLD = 0.8;

// =============================================================================
// Hash integrity check
// =============================================================================

if (!existsSync(CORPUS_PATH)) {
  throw new Error(`patterns.json missing: ${CORPUS_PATH}`);
}
if (!existsSync(HASH_PATH)) {
  throw new Error(`corpus.hash missing: ${HASH_PATH}`);
}
if (!existsSync(BENIGN_PATH)) {
  throw new Error(`benign-corpus.json missing: ${BENIGN_PATH}`);
}

const corpusJson = readFileSync(CORPUS_PATH, 'utf-8');
const expectedHash = readFileSync(HASH_PATH, 'utf-8').trim();
const actualHash = createHash('sha256').update(corpusJson).digest('hex');
if (actualHash !== expectedHash) {
  throw new Error(
    `Corpus hash mismatch — patterns.json has been mutated since corpus.hash was pinned.\n` +
      `Expected: ${expectedHash}\nActual:   ${actualHash}\n` +
      `If this mutation is intentional, regenerate via build-corpus.mjs ` +
      `and document the corpus-rev bump in a separate PR before re-running the gate.`
  );
}

const attackCorpus = JSON.parse(corpusJson);
const benignCorpus = JSON.parse(readFileSync(BENIGN_PATH, 'utf-8'));

// =============================================================================
// Evaluator
// =============================================================================

const { CodeInjectionValidator } = await import('../../dist/validators/code-injection.js');
const { PathTraversalValidator } = await import('../../dist/validators/path-traversal.js');

/**
 * Sandbox-utils integration shape: a payload is BLOCKED if EITHER
 * the code-injection validator OR the path-traversal validator
 * catches it. This mirrors the real wrap-sandbox dispatch (commands.run
 * → code; files.write path → path; files.write content → code).
 *
 * PATH_TRAVERSAL entries are routed to PathTraversalValidator
 * (with `cwd: '/srv/app'` matching the validator's required arg).
 * Other categories route to CodeInjectionValidator.
 */
const codeValidator = new CodeInjectionValidator();
const pathValidator = new PathTraversalValidator({ cwd: '/srv/app' });

function pickValidator(entry) {
  return entry.category === 'path_traversal' ? pathValidator : codeValidator;
}

async function evaluate(corpus, expectedBlock) {
  const results = [];
  for (const entry of corpus) {
    const v = pickValidator(entry);
    const r = await v.validate(entry.payload);
    results.push({
      id: entry.id,
      category: entry.category,
      subcategory: entry.subcategory,
      payload: entry.payload,
      expected_block: expectedBlock,
      actual_block: r.blocked,
      correct: r.blocked === expectedBlock,
      findings_count: r.findings.length,
      first_finding_category: r.findings[0]?.category
    });
  }
  return results;
}

console.log('Running CodeInjectionValidator against R2-13 corpus...');
const attackResults = await evaluate(attackCorpus, true);
console.log(`Attack corpus: ${attackResults.length} entries evaluated`);

console.log('Running CodeInjectionValidator against benign corpus...');
const benignResults = await evaluate(benignCorpus, false);
console.log(`Benign corpus: ${benignResults.length} entries evaluated`);

// =============================================================================
// Metrics
// =============================================================================

const truePositives = attackResults.filter(r => r.actual_block).length;
const falseNegatives = attackResults.filter(r => !r.actual_block).length;
const trueNegatives = benignResults.filter(r => !r.actual_block).length;
const falsePositives = benignResults.filter(r => r.actual_block).length;

const recall = truePositives / (truePositives + falseNegatives);
const fpr = falsePositives / (falsePositives + trueNegatives);
const precision = truePositives / (truePositives + falsePositives);

const recallPass = recall >= RECALL_THRESHOLD;
const fprPass = fpr <= FPR_THRESHOLD;
const precisionPass = precision >= PRECISION_THRESHOLD;
const allPass = recallPass && fprPass && precisionPass;

// =============================================================================
// Gap categories (per Story 4.5 AC — "document specific gap categories")
// =============================================================================

const falseNegativesByCategory = {};
for (const r of attackResults.filter(r => !r.actual_block)) {
  const k = `${r.category}:${r.subcategory}`;
  falseNegativesByCategory[k] = (falseNegativesByCategory[k] || 0) + 1;
}

const falsePositivesByPayload = benignResults
  .filter(r => r.actual_block)
  .map(r => ({
    id: r.id,
    payload: r.payload.slice(0, 80),
    first_finding_category: r.first_finding_category
  }));

// =============================================================================
// Report
// =============================================================================

const report = {
  generated_at: new Date().toISOString(),
  corpus_hash: expectedHash,
  corpus_size: {
    attack: attackResults.length,
    benign: benignResults.length
  },
  confusion_matrix: {
    true_positives: truePositives,
    false_negatives: falseNegatives,
    true_negatives: trueNegatives,
    false_positives: falsePositives
  },
  metrics: {
    recall,
    fpr,
    precision
  },
  thresholds: {
    recall: RECALL_THRESHOLD,
    fpr: FPR_THRESHOLD,
    precision: PRECISION_THRESHOLD
  },
  gate_results: {
    recall_pass: recallPass,
    fpr_pass: fprPass,
    precision_pass: precisionPass,
    all_pass: allPass,
    decision: allPass ? 'GRADUATE' : 'KEEP_EXPERIMENTAL'
  },
  gap_categories: {
    false_negatives_by_subcategory: falseNegativesByCategory,
    false_positive_payloads: falsePositivesByPayload
  }
};

writeFileSync(REPORT_JSON_PATH, JSON.stringify(report, null, 2) + '\n', 'utf-8');

const txt = `# Sandbox Graduation Gate Report — Sprint 24 / Story 4.5

Generated: ${report.generated_at}
Corpus hash (R2-13): ${expectedHash}
Corpus size: ${attackResults.length} attack + ${benignResults.length} benign

## Confusion matrix
  TP=${truePositives}  FN=${falseNegatives}  TN=${trueNegatives}  FP=${falsePositives}

## Metrics
  Recall:    ${(recall * 100).toFixed(2)}%  (threshold ≥${RECALL_THRESHOLD * 100}%)    ${recallPass ? 'PASS' : 'FAIL'}
  FPR:       ${(fpr * 100).toFixed(2)}%  (threshold ≤${FPR_THRESHOLD * 100}%)     ${fprPass ? 'PASS' : 'FAIL'}
  Precision: ${(precision * 100).toFixed(2)}%  (threshold ≥${PRECISION_THRESHOLD * 100}%)    ${precisionPass ? 'PASS' : 'FAIL'}

## Decision
  ${allPass ? '✅ GRADUATE — remove `experimental: true` flag from sandbox-utils + e2b-adapter + daytona-adapter.' : '❌ KEEP_EXPERIMENTAL — defer to v0.8 with gap categories below.'}

## Gap categories
${
  Object.entries(falseNegativesByCategory).length === 0
    ? '  (no false negatives)'
    : '  False-negatives by subcategory:\n' +
      Object.entries(falseNegativesByCategory)
        .map(([k, v]) => `    ${k}: ${v}`)
        .join('\n')
}

${falsePositivesByPayload.length === 0 ? '  (no false positives)' : '  False-positive payloads:\n' + falsePositivesByPayload.map(p => `    ${p.id} [${p.first_finding_category}]: ${p.payload}`).join('\n')}
`;

writeFileSync(REPORT_TXT_PATH, txt, 'utf-8');

console.log('\n' + txt);
console.log(`\nReport: ${REPORT_JSON_PATH}`);
console.log(`Decision: ${report.gate_results.decision}`);

// Exit code: 0 = pass, 1 = fail (so CI can gate on it).
process.exit(allPass ? 0 : 1);
