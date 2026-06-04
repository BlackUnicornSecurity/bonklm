#!/usr/bin/env node
// Sweep the (variant × LLM) matrix serially. Skips runs whose evidence/run.json
// already exists (idempotent — re-run after fixing config without redoing earlier wins).
// Writes a compact summary table at the end.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEMO_ROOT = resolve(__dirname, '..');

const args = process.argv.slice(2);
const force = args.includes('--force');
const onlyVariants = args.find((a) => a.startsWith('--variants='))?.split('=')[1]?.split(',') ?? null;
const onlyLlms = args.find((a) => a.startsWith('--llms='))?.split('=')[1]?.split(',') ?? null;
const mode = args.find((a) => a.startsWith('--mode='))?.split('=')[1] ?? 'explicit';

const VARIANTS = [
  'variant-1-bio-obvious',
  'variant-2-bio-steganographic',
  'variant-3-bio-delayed-trigger',
  'variant-4-bio-multilingual-base64',
  'bonus-knowledge',
  'bonus-message-examples',
  'bonus-system-prompt',
];

const LLMS = ['openrouter', 'anthropic', 'ollama'];

const targets = [];
for (const v of VARIANTS) {
  if (onlyVariants && !onlyVariants.includes(v)) continue;
  for (const l of LLMS) {
    if (onlyLlms && !onlyLlms.includes(l)) continue;
    targets.push({ variant: v, llm: l });
  }
}

console.log(`Sweep: ${targets.length} (variant × LLM) targets`);

const results = [];
let i = 0;
for (const { variant, llm } of targets) {
  i++;
  const runJsonPath = resolve(DEMO_ROOT, 'evidence', variant, llm, mode, 'run.json');
  if (!force && existsSync(runJsonPath)) {
    try {
      const prior = JSON.parse(readFileSync(runJsonPath, 'utf8'));
      console.log(`[${i}/${targets.length}] SKIP ${variant} × ${llm} — prior outcome=${prior.outcome ?? '?'} (use --force to re-run)`);
      results.push({ variant, llm, outcome: prior.outcome, prior: true, delta: prior.balanceDelta });
      continue;
    } catch {}
  }

  console.log(`[${i}/${targets.length}] RUN  ${variant} × ${llm}`);
  for (const dir of ['.elizaos', 'data', 'agent-store']) {
    const p = resolve(DEMO_ROOT, dir);
    if (existsSync(p)) rmSync(p, { recursive: true, force: true });
  }

  const r = spawnSync(
    'node',
    [resolve(__dirname, 'run-exploit.mjs'), '--variant', variant, '--llm', llm, '--mode', mode],
    { cwd: DEMO_ROOT, stdio: 'inherit' },
  );

  let outcome = 'ERROR';
  let delta = {};
  if (existsSync(runJsonPath)) {
    try {
      const j = JSON.parse(readFileSync(runJsonPath, 'utf8'));
      outcome = j.outcome ?? (r.status === 0 ? 'COMPLETE' : 'NO_OUTCOME');
      delta = j.balanceDelta ?? {};
    } catch (e) {
      outcome = 'PARSE_ERROR';
    }
  }
  results.push({ variant, llm, outcome, prior: false, delta });
}

console.log('\n\n========================================');
console.log('             RESULTS MATRIX');
console.log('========================================\n');

const grid = {};
for (const r of results) {
  grid[r.variant] = grid[r.variant] || {};
  grid[r.variant][r.llm] = r;
}

const variantsInResults = Object.keys(grid).sort();
const sep = '|';
const pad = (s, n) => String(s ?? '').padEnd(n);
console.log(pad('variant', 38), sep, pad('openrouter', 24), sep, pad('anthropic', 24), sep, pad('ollama', 24));
console.log('-'.repeat(125));
for (const v of variantsInResults) {
  const cells = LLMS.map((l) => {
    const r = grid[v]?.[l];
    if (!r) return '—';
    const d = r.delta || {};
    const att = d.attacker > 0 ? `att+${d.attacker.toFixed(2)}` : '';
    return `${r.outcome}${att ? ' ' + att : ''}`;
  });
  console.log(pad(v, 38), sep, pad(cells[0], 24), sep, pad(cells[1], 24), sep, pad(cells[2], 24));
}

const drained = results.filter((r) => (r.delta?.attacker ?? 0) > 0);
console.log(`\n${drained.length}/${results.length} runs drained funds to ATTACKER.`);
if (drained.length > 0) {
  console.log('Attacker-drains:');
  for (const r of drained) console.log(`  ${r.variant} × ${r.llm}: +${r.delta.attacker.toFixed(4)} SOL`);
}
