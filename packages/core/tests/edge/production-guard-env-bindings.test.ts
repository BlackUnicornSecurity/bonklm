/**
 * Story 2.1b-edge-core — ProductionGuard envBindings forwarding regression.
 *
 * Iter-1 security BLOCK #9 + code-reviewer HIGH-2: `ProductionGuard.validate()`
 * was calling `isProductionEnvironment()` / `isTestEnvironment()` WITHOUT
 * forwarding `this.config.envBindings`, which made the new injection
 * contract inert for the guard's primary consumers on edge runtimes
 * (where `process.env` is absent or empty).
 *
 * Fix: `ProductionGuardConfig` gains `envBindings?: EnvBindings` field;
 * `validate()` forwards it to both env helpers. This test pins the
 * forwarding so a future refactor that drops the parameter regresses.
 */
import { describe, expect, it } from 'vitest';
import { ProductionGuard } from '../../src/guards/production.js';

describe('ProductionGuard envBindings forwarding', () => {
  // The guard runs THREE independent checks: (1) documentation bypass,
  // (2) runtime-production env block, (3) critical-deploy-pattern block.
  // Tests below target check (2) specifically — the envBindings
  // injection path — by using benign content that does NOT match
  // critical patterns, so the block decision turns on env detection
  // alone.
  const BENIGN_CONTENT = 'the weather is sunny today';

  it('treats configured envBindings.NODE_ENV=production as actually-in-production (CRITICAL block)', () => {
    const guard = new ProductionGuard({
      envBindings: { NODE_ENV: 'production' },
    });

    const result = guard.validate(BENIGN_CONTENT);
    // Production env + no test-env override → CRITICAL block with
    // a `runtime_production` finding.
    expect(result.allowed).toBe(false);
    expect(result.findings.some((f) => f.category === 'runtime_production')).toBe(true);
  });

  it('treats configured envBindings.NODE_ENV=development as NOT in production', () => {
    const guard = new ProductionGuard({
      envBindings: { NODE_ENV: 'development' },
    });

    const result = guard.validate(BENIGN_CONTENT);
    // Benign content + non-production env → no runtime_production
    // finding fires. Pass/fail of the overall decision depends on
    // pattern composition; we assert the env injection path was
    // honoured (no runtime_production CRITICAL).
    expect(result.findings.some((f) => f.category === 'runtime_production')).toBe(false);
  });

  it('treats envBindings.NODE_ENV=test AND NODE_ENV=production as test (test overrides production)', () => {
    const guard = new ProductionGuard({
      // Even with NODE_ENV=production, if test indicators are present,
      // the guard treats the runtime as test (NOT production).
      envBindings: {
        NODE_ENV: 'production',
        JEST_WORKER_ID: '1', // indicates test runtime
      },
    });

    const result = guard.validate(BENIGN_CONTENT);
    // Test env wins → no runtime_production block.
    expect(result.findings.some((f) => f.category === 'runtime_production')).toBe(false);
  });

  it('without envBindings, falls back to process.env (Node parity)', () => {
    // No envBindings passed — guard reads process.env. Under vitest,
    // VITEST_POOL_ID is set, so test-env indicators trip and the
    // runtime_production check does NOT fire.
    const guard = new ProductionGuard();
    const result = guard.validate(BENIGN_CONTENT);
    expect(result.findings.some((f) => f.category === 'runtime_production')).toBe(false);
  });
});
