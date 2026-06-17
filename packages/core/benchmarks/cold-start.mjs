#!/usr/bin/env node
/**
 * Cold-start / import-cost benchmark — hardware-portable.
 *
 * Measures two things across fresh node processes:
 *   import_ms          — the cost of `import('@blackunicorn/bonklm')` itself
 *                        (module load + eval) inside a fresh process, timed with
 *                        hrtime around the dynamic import. This is what a
 *                        consumer's first import pays beyond node startup.
 *   full_cold_start_ms — wall-clock of the whole spawned process (node boot +
 *                        import), for end-to-end context.
 *
 * Each sample is a SEPARATE `node` process so the module graph is genuinely cold
 * (an in-process re-import is cached and would measure ~0). Run after `pnpm build`:
 *   node packages/core/benchmarks/cold-start.mjs
 *   COLD_START_SAMPLES=25 node packages/core/benchmarks/cold-start.mjs
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, '../dist/index.js');
if (!existsSync(entry)) {
  console.error(`cold-start: build first — missing ${entry}`);
  process.exit(1);
}

const SAMPLES = Number(process.env.COLD_START_SAMPLES ?? 15);
const WARMUP = 2;

// Child: time the dynamic import inside the fresh process; print the ms as text.
const child = `const t=process.hrtime.bigint();await import(${JSON.stringify(entry)});process.stdout.write(String(Number(process.hrtime.bigint()-t)/1e6));`;

const importMs = [];
const fullMs = [];
for (let i = 0; i < SAMPLES + WARMUP; i++) {
  const t0 = process.hrtime.bigint();
  // execFileSync (args array, no shell) — the injection-safe spawn form.
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', child], { encoding: 'utf8' });
  const full = Number(process.hrtime.bigint() - t0) / 1e6;
  const importDelta = Number(out);
  // Fail loud if a child ever emits non-numeric stdout (e.g. an import-time log)
  // rather than silently poisoning the stats with NaN.
  if (!Number.isFinite(importDelta)) {
    throw new Error(`cold-start: child emitted non-numeric stdout: ${JSON.stringify(out)}`);
  }
  if (i >= WARMUP) {
    importMs.push(importDelta);
    fullMs.push(full);
  }
}

const stats = arr => {
  const s = [...arr].sort((a, b) => a - b);
  const round = n => Math.round(n * 1000) / 1000;
  // Nearest-rank percentile: index ceil(p*n)-1, clamped. Avoids floor() collapsing
  // p95 onto the max at small n (e.g. floor(0.95*20)=19 = last element).
  const quantile = p => s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))];
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  return {
    min: round(s[0]),
    median: round(quantile(0.5)),
    mean: round(mean),
    p95: round(quantile(0.95)),
    max: round(s[s.length - 1])
  };
};

console.log(
  JSON.stringify(
    {
      entry: entry.replace(/^.*\/(packages\/.*)$/, '$1'),
      node: process.version,
      platform: `${process.platform} ${process.arch}`,
      samples: SAMPLES,
      import_ms: stats(importMs),
      full_cold_start_ms: stats(fullMs)
    },
    null,
    2
  )
);
