/**
 * Sprint 17 buffer — CodeInjection + PathTraversal perf tripwire
 * ================================================================
 *
 * Sprint 16 cumulative-audit code-reviewer CONCERN-4 closure: the
 * audio-stream validator already enforces <100ms / 1KB on its partial
 * hot path. Story 3.2 validators (CodeInjection + PathTraversal) had
 * no analogous throughput ceiling. A 1MB code blob through
 * CodeInjection runs ~55 regex patterns linearly with no early
 * termination.
 *
 * Tripwire: validate < 50ms (avg over 20 iter) on a 10KB input.
 * Loose enough for CI runners; tight enough to catch O(n²) or
 * catastrophic-backtracking regressions.
 */
import { describe, it, expect } from 'vitest';
import { performance } from 'node:perf_hooks';
import { CodeInjectionValidator } from '../../src/validators/code-injection.js';
import { PathTraversalValidator } from '../../src/validators/path-traversal.js';

const TEN_KB_BENIGN_CODE = `
import pandas as pd
import numpy as np

def compute_metrics(df):
    return df.groupby('category').agg({
        'value': ['mean', 'std', 'count'],
        'amount': 'sum',
    })

class DataPipeline:
    def __init__(self, config):
        self.config = config

    def run(self, input_path):
        df = pd.read_csv(input_path)
        result = compute_metrics(df)
        return result.to_dict()

`.repeat(40); // ~10KB

describe('Sprint 17 perf tripwire — CodeInjection (audit CONCERN-4)', () => {
  it('validates a 10KB benign code blob in < 50ms (avg over 20 iter)', async () => {
    const v = new CodeInjectionValidator();

    // Warmup.
    for (let i = 0; i < 5; i++) {
      await v.validate(TEN_KB_BENIGN_CODE);
    }

    const start = performance.now();
    for (let i = 0; i < 20; i++) {
      await v.validate(TEN_KB_BENIGN_CODE);
    }
    const elapsed = performance.now() - start;
    expect(elapsed / 20).toBeLessThan(50);
  });

  it('validates a 10KB attack-laden blob in < 50ms (avg over 20 iter)', async () => {
    const v = new CodeInjectionValidator();
    const ATTACK_BLOB = (TEN_KB_BENIGN_CODE + 'subprocess.run("rm -rf /tmp/x")\n').repeat(1);

    for (let i = 0; i < 5; i++) {
      await v.validate(ATTACK_BLOB);
    }

    const start = performance.now();
    for (let i = 0; i < 20; i++) {
      await v.validate(ATTACK_BLOB);
    }
    const elapsed = performance.now() - start;
    expect(elapsed / 20).toBeLessThan(50);
  });
});

describe('Sprint 17 perf tripwire — PathTraversal (audit CONCERN-4)', () => {
  it('validates a 10KB path string in < 50ms (avg over 20 iter)', async () => {
    const v = new PathTraversalValidator({ cwd: '/srv/app' });
    // PathTraversal is typically called with short paths but a hostile
    // caller could feed a long concatenation hoping for ReDoS.
    const LONG_PATH = 'data/' + 'subdir/'.repeat(1000) + 'file.csv';

    for (let i = 0; i < 5; i++) {
      await v.validate(LONG_PATH);
    }

    const start = performance.now();
    for (let i = 0; i < 20; i++) {
      await v.validate(LONG_PATH);
    }
    const elapsed = performance.now() - start;
    expect(elapsed / 20).toBeLessThan(50);
  });

  it('rejects a 10KB attack path in < 50ms (`..` repeated)', async () => {
    const v = new PathTraversalValidator({ cwd: '/srv/app' });
    const ATTACK_PATH = '../'.repeat(2000) + 'etc/passwd';

    for (let i = 0; i < 5; i++) {
      await v.validate(ATTACK_PATH);
    }

    const start = performance.now();
    for (let i = 0; i < 20; i++) {
      await v.validate(ATTACK_PATH);
    }
    const elapsed = performance.now() - start;
    expect(elapsed / 20).toBeLessThan(50);
  });
});
