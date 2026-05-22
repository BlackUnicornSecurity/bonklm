/**
 * Story 2.8 — Inngest middleware tests
 * ====================================
 *
 * Acceptance criteria (per `team/plans/2026-05-21-v0.4-v0.7-roadmap-FINAL.md`):
 *   1. Peer `inngest ^4.4.0`. Engines `node >= 20`.
 *   2. `bonklmInngestMiddleware({ validators })` registers via `new InngestMiddleware`.
 *   3. `ctx.bonklm.validateInput/validateOutput/validateToolArgs` helpers
 *      wrap each in `step.run('bonklm-validate-*', ...)` so replays
 *      return cached decisions.
 *   4. Integration test: function replay does not re-fire validator;
 *      cached BLOCK decision returned.
 *
 * The middleware factory loads `inngest` lazily; tests focus on the
 * `createBonklmInngestContextSurface` direct constructor (with a
 * hand-rolled StepRunner) so we don't need the full Inngest SDK at
 * unit-test time.
 */
import { describe, it, expect, vi } from 'vitest';
import { Severity, RiskLevel } from '@blackunicorn/bonklm';
import type { GuardrailResult, Validator } from '@blackunicorn/bonklm';
import { InMemoryLRUCache } from '@blackunicorn/bonklm';
import {
  bonklmInngestMiddleware,
  createBonklmInngestContextSurface,
  type StepRunner,
} from '../src/bonklm-middleware.js';

const okResult = (note: string): GuardrailResult => ({
  allowed: true,
  blocked: false,
  reason: note,
  severity: Severity.INFO,
  risk_level: RiskLevel.LOW,
  risk_score: 0,
  findings: [],
  timestamp: Date.now(),
});

const blockResult = (note: string): GuardrailResult => ({
  allowed: false,
  blocked: true,
  reason: note,
  severity: Severity.BLOCKED,
  risk_level: RiskLevel.HIGH,
  risk_score: 0.95,
  findings: [],
  timestamp: Date.now(),
});

/**
 * Mock StepRunner that simulates Inngest's in-run replay semantics:
 *   - First call with a given stepId: handler runs; result stored.
 *   - Subsequent calls with the SAME stepId in the SAME run: handler
 *     does NOT run; cached result returned.
 *
 * `reset()` simulates a new run (handler will fire again unless an
 * external cache short-circuits).
 */
function makeReplayingStepRunner(): StepRunner & {
  callCounts: Map<string, number>;
  reset: () => void;
} {
  const memory = new Map<string, unknown>();
  const callCounts = new Map<string, number>();
  return {
    async run<T>(stepId: string, handler: () => T | Promise<T>): Promise<T> {
      if (memory.has(stepId)) {
        return memory.get(stepId) as T;
      }
      callCounts.set(stepId, (callCounts.get(stepId) ?? 0) + 1);
      const result = await handler();
      memory.set(stepId, result);
      return result;
    },
    callCounts,
    reset() {
      memory.clear();
    },
  };
}

describe('Story 2.8 — Inngest middleware', () => {
  describe('AC #3: helpers wrap each call in step.run("bonklm-validate-*")', () => {
    it('validateInput uses step.run("bonklm-validate-input")', async () => {
      const step = makeReplayingStepRunner();
      const validators: Validator[] = [
        { name: 'V', validate: () => okResult('cold') },
      ];
      const surface = createBonklmInngestContextSurface(step, { validators });
      await surface.validateInput('hello');
      expect(step.callCounts.get('bonklm-validate-input')).toBe(1);
    });

    it('validateOutput uses step.run("bonklm-validate-output")', async () => {
      const step = makeReplayingStepRunner();
      const validators: Validator[] = [
        { name: 'V', validate: () => okResult('cold') },
      ];
      const surface = createBonklmInngestContextSurface(step, { validators });
      await surface.validateOutput('output text');
      expect(step.callCounts.get('bonklm-validate-output')).toBe(1);
    });

    it('validateToolArgs uses step.run("bonklm-validate-tool-args")', async () => {
      const step = makeReplayingStepRunner();
      const validators: Validator[] = [
        { name: 'V', validate: () => okResult('cold') },
      ];
      const surface = createBonklmInngestContextSurface(step, { validators });
      await surface.validateToolArgs('send_email', { to: 'a@b.com' });
      expect(step.callCounts.get('bonklm-validate-tool-args')).toBe(1);
    });

    it('respects custom stepNamePrefix', async () => {
      const step = makeReplayingStepRunner();
      const validators: Validator[] = [
        { name: 'V', validate: () => okResult('cold') },
      ];
      const surface = createBonklmInngestContextSurface(step, {
        validators,
        stepNamePrefix: 'guardrails',
      });
      await surface.validateInput('x');
      expect(step.callCounts.get('guardrails-input')).toBe(1);
      expect(step.callCounts.get('bonklm-validate-input')).toBeUndefined();
    });
  });

  describe('AC #4: integration — function replay does NOT re-fire validator', () => {
    it('in-run replay (same step.run instance) returns cached result without re-validating', async () => {
      const step = makeReplayingStepRunner();
      const validate = vi.fn().mockReturnValue(blockResult('prompt-injection'));
      const validators: Validator[] = [{ name: 'V', validate }];
      const surface = createBonklmInngestContextSurface(step, { validators });

      const r1 = await surface.validateInput('attack payload');
      const r2 = await surface.validateInput('attack payload');

      // step.run replay returns the SAME result without re-firing the validator.
      expect(validate).toHaveBeenCalledTimes(1);
      expect(r1.blocked).toBe(true);
      expect(r2.blocked).toBe(true);
      expect(r2.reason).toBe('prompt-injection');
    });

    it('cross-surface cache MISS by default — per-surface engine isolation', async () => {
      // Documents the security trade-off when constructing surfaces
      // directly (not via the middleware factory). Each direct
      // surface creates a fresh engine → fresh instanceId → fresh
      // salt → cache misses across surfaces. This is the SECURE
      // default (Story 2.7 BLOCK-CRIT: cross-instance isolation).
      //
      // The middleware factory `bonklmInngestMiddleware()` hoists
      // resolution to factory scope so all function-runs SHARE the
      // engine + salt — see the next test for the hit path.
      const cache = new InMemoryLRUCache({ maxEntries: 16 });
      const validate = vi.fn().mockReturnValue(blockResult('blocked-by-cache'));
      const validators: Validator[] = [{ name: 'V', validate }];

      const step1 = makeReplayingStepRunner();
      const s1 = createBonklmInngestContextSurface(step1, { validators, cache });
      const r1 = await s1.validateInput('hot input');

      const step2 = makeReplayingStepRunner();
      const s2 = createBonklmInngestContextSurface(step2, { validators, cache });
      const r2 = await s2.validateInput('hot input');

      expect(r1.blocked).toBe(true);
      expect(r2.blocked).toBe(true);
      // Validator fired TWICE — different engineInstanceId per surface.
      expect(validate).toHaveBeenCalledTimes(2);
    });

    it('cross-run dedupe WITH explicit shared engine returns cached BLOCK without re-firing', async () => {
      // The escape hatch: when a consumer wires the SAME engine to
      // multiple surfaces (e.g. one engine per Inngest client), the
      // salted keyFn resolves to the same prefix → cache hits cross-run.
      const cache = new InMemoryLRUCache({ maxEntries: 16 });
      const validate = vi.fn().mockReturnValue(blockResult('blocked-by-cache'));
      const validators: Validator[] = [{ name: 'V', validate }];

      // Construct ONE shared engine — its instanceId becomes the
      // salt for both surfaces.
      const { GuardrailEngine } = await import('@blackunicorn/bonklm');
      const sharedEngine = new GuardrailEngine({ validators });

      const step1 = makeReplayingStepRunner();
      const s1 = createBonklmInngestContextSurface(step1, {
        validators,
        engine: sharedEngine,
        cache,
      });
      await s1.validateInput('hot input');

      const step2 = makeReplayingStepRunner();
      const s2 = createBonklmInngestContextSurface(step2, {
        validators,
        engine: sharedEngine,
        cache,
      });
      const r2 = await s2.validateInput('hot input');

      // Run 2 hits the cache → validator fired ONCE total.
      expect(validate).toHaveBeenCalledTimes(1);
      expect(r2.blocked).toBe(true);
      expect(r2.results[0].fromCache).toBe(true);
    });
  });

  describe('Aggregate result shape', () => {
    it('returns blocked=true with reason from first blocking validator', async () => {
      const step = makeReplayingStepRunner();
      const validators: Validator[] = [
        { name: 'V1', validate: () => okResult('first ok') },
        { name: 'V2', validate: () => blockResult('second blocked') },
        { name: 'V3', validate: () => okResult('third ok') },
      ];
      const surface = createBonklmInngestContextSurface(step, { validators });
      const r = await surface.validateInput('x');
      expect(r.blocked).toBe(true);
      expect(r.allowed).toBe(false);
      expect(r.reason).toBe('second blocked');
      expect(r.results).toHaveLength(3);
    });

    it('returns blocked=false when all validators allow', async () => {
      const step = makeReplayingStepRunner();
      const validators: Validator[] = [
        { name: 'V1', validate: () => okResult('ok') },
        { name: 'V2', validate: () => okResult('ok') },
      ];
      const surface = createBonklmInngestContextSurface(step, { validators });
      const r = await surface.validateInput('x');
      expect(r.blocked).toBe(false);
      expect(r.allowed).toBe(true);
      expect(r.reason).toBeUndefined();
    });
  });

  describe('Configuration validation', () => {
    it('throws when validators array is empty', () => {
      expect(() =>
        createBonklmInngestContextSurface(makeReplayingStepRunner(), {
          validators: [],
        })
      ).toThrow(/non-empty array/);
    });

    it('throws when validators is missing', () => {
      expect(() =>
        createBonklmInngestContextSurface(makeReplayingStepRunner(), {
          // @ts-expect-error — invalid input under test.
          validators: undefined,
        })
      ).toThrow(/non-empty array/);
    });

    it('throws downstream when a cache is wired + validator lacks .name', async () => {
      const step = makeReplayingStepRunner();
      const anon: Validator = { validate: () => okResult('cold') };
      const surface = createBonklmInngestContextSurface(step, {
        validators: [anon],
        cache: new InMemoryLRUCache(),
      });
      await expect(surface.validateInput('x')).rejects.toThrow(/no `name` property/);
    });
  });

  describe('Tool args validation', () => {
    it('validateToolArgs passes a tool_call ValidatorInput to the pipeline', async () => {
      const step = makeReplayingStepRunner();
      const validate = vi.fn().mockReturnValue(okResult('cold'));
      const validators: Validator[] = [{ name: 'V', validate }];
      const surface = createBonklmInngestContextSurface(step, { validators });
      await surface.validateToolArgs('send_email', { to: 'a@b.com', body: 'hi' });
      expect(validate).toHaveBeenCalledWith({
        kind: 'tool_call',
        toolName: 'send_email',
        args: { to: 'a@b.com', body: 'hi' },
      });
    });
  });

  describe('Audit BLOCK closures', () => {
    describe('B1: bonklmInngestMiddleware hoists resolveOptions → cross-run cache hits', () => {
      it('factory-scope resolution stabilises the engineInstanceId salt across runs', async () => {
        // This exercises the FACTORY path (not direct surface) — the
        // factory closes over a single resolved bundle so all
        // function-runs share the salt + the cache hits.
        const cache = new InMemoryLRUCache({ maxEntries: 16 });
        const validate = vi.fn().mockReturnValue(blockResult('hot'));
        const validators: Validator[] = [{ name: 'V', validate }];

        // Construct the middleware class ONCE; instantiate to extract
        // its transform binding for two simulated function runs.
        const MiddlewareClass = bonklmInngestMiddleware({ validators, cache });
        // Build two surfaces from the same bundle (mimics what the
        // class's transformFunctionInput does) using two fresh step
        // runners (two function-runs).
        const step1 = makeReplayingStepRunner();
        const step2 = makeReplayingStepRunner();

        // Instantiate the middleware class structurally — we only
        // need the transformFunctionInput method.
        const inst = Object.create(MiddlewareClass.prototype) as {
          transformFunctionInput: (a: unknown) => unknown;
        };

        const r1 = (
          inst.transformFunctionInput({ ctx: { step: step1 }, fn: {}, steps: {} }) as {
            ctx: { bonklm: typeof inst & { validateInput: (s: string) => Promise<unknown> } };
          }
        ).ctx.bonklm;
        const r2 = (
          inst.transformFunctionInput({ ctx: { step: step2 }, fn: {}, steps: {} }) as {
            ctx: { bonklm: typeof inst & { validateInput: (s: string) => Promise<unknown> } };
          }
        ).ctx.bonklm;

        await (r1 as { validateInput: (s: string) => Promise<unknown> }).validateInput('hot');
        const second = (await (r2 as {
          validateInput: (s: string) => Promise<{ blocked: boolean; results: Array<{ fromCache: boolean }> }>;
        }).validateInput('hot'));

        expect(validate).toHaveBeenCalledTimes(1);
        expect(second.blocked).toBe(true);
        expect(second.results[0].fromCache).toBe(true);
      });
    });

    describe('B2-rev: toolName boundary validation', () => {
      it('returns BLOCK for empty toolName', async () => {
        const step = makeReplayingStepRunner();
        const surface = createBonklmInngestContextSurface(step, {
          validators: [{ name: 'V', validate: () => okResult('cold') }],
        });
        const r = await surface.validateToolArgs('', { x: 1 });
        expect(r.blocked).toBe(true);
        expect(r.reason).toMatch(/non-empty string/);
      });

      it('returns BLOCK for whitespace-only toolName', async () => {
        const step = makeReplayingStepRunner();
        const surface = createBonklmInngestContextSurface(step, {
          validators: [{ name: 'V', validate: () => okResult('cold') }],
        });
        const r = await surface.validateToolArgs('   ', { x: 1 });
        expect(r.blocked).toBe(true);
      });

      it('returns BLOCK for non-string toolName', async () => {
        const step = makeReplayingStepRunner();
        const surface = createBonklmInngestContextSurface(step, {
          validators: [{ name: 'V', validate: () => okResult('cold') }],
        });
        // @ts-expect-error — invalid input under test.
        const r = await surface.validateToolArgs(42, { x: 1 });
        expect(r.blocked).toBe(true);
      });
    });

    describe('B3-sec: non-serializable inputs BLOCK instead of throwing into step.run', () => {
      it('validateToolArgs with Map in args returns BLOCK (not throw)', async () => {
        const step = makeReplayingStepRunner();
        const surface = createBonklmInngestContextSurface(step, {
          validators: [{ name: 'V', validate: () => okResult('cold') }],
        });
        const r = await surface.validateToolArgs('send', { m: new Map() });
        expect(r.blocked).toBe(true);
        expect(r.reason).toMatch(/not serializable|unsupported object type/);
      });

      it('validateInput with non-plain-prototype object BLOCKs', async () => {
        const step = makeReplayingStepRunner();
        const surface = createBonklmInngestContextSurface(step, {
          validators: [{ name: 'V', validate: () => okResult('cold') }],
        });
        class Custom {
          x = 1;
        }
        // @ts-expect-error — invalid shape under test.
        const r = await surface.validateInput({
          kind: 'tool_call',
          toolName: 'x',
          args: new Custom(),
        });
        expect(r.blocked).toBe(true);
      });
    });

    describe('B4-sec: stepNamePrefix sanitization', () => {
      it('factory throws on empty stepNamePrefix', () => {
        expect(() =>
          bonklmInngestMiddleware({
            validators: [{ name: 'V', validate: () => okResult('cold') }],
            stepNamePrefix: '',
          })
        ).toThrow(/non-empty/);
      });

      it('factory throws on whitespace-only stepNamePrefix', () => {
        expect(() =>
          bonklmInngestMiddleware({
            validators: [{ name: 'V', validate: () => okResult('cold') }],
            stepNamePrefix: '   ',
          })
        ).toThrow(/non-empty/);
      });

      it('factory throws on stepNamePrefix with forbidden characters', () => {
        expect(() =>
          bonklmInngestMiddleware({
            validators: [{ name: 'V', validate: () => okResult('cold') }],
            stepNamePrefix: 'bad prefix with spaces',
          })
        ).toThrow(/match/);
      });

      it('factory throws on stepNamePrefix ending in our reserved suffixes', () => {
        expect(() =>
          bonklmInngestMiddleware({
            validators: [{ name: 'V', validate: () => okResult('cold') }],
            stepNamePrefix: 'my-prefix-input',
          })
        ).toThrow(/-input/);
      });
    });

    describe('B5-arch: ctx.step missing → descriptive throw', () => {
      it('throws when ctx.step is undefined', () => {
        const MiddlewareClass = bonklmInngestMiddleware({
          validators: [{ name: 'V', validate: () => okResult('cold') }],
        });
        const inst = Object.create(MiddlewareClass.prototype) as {
          transformFunctionInput: (a: unknown) => unknown;
        };
        expect(() =>
          inst.transformFunctionInput({ ctx: {}, fn: {}, steps: {} })
        ).toThrow(/ctx\.step is unavailable/);
      });

      it('throws when ctx.step.run is not a function', () => {
        const MiddlewareClass = bonklmInngestMiddleware({
          validators: [{ name: 'V', validate: () => okResult('cold') }],
        });
        const inst = Object.create(MiddlewareClass.prototype) as {
          transformFunctionInput: (a: unknown) => unknown;
        };
        expect(() =>
          inst.transformFunctionInput({
            ctx: { step: { run: 'not-a-function' } },
            fn: {},
            steps: {},
          })
        ).toThrow(/ctx\.step is unavailable/);
      });
    });
  });

  describe('ValidatorInput passthrough', () => {
    it('validateInput accepts a string and wraps it as { kind: "text" }', async () => {
      const step = makeReplayingStepRunner();
      const validate = vi.fn().mockReturnValue(okResult('cold'));
      const validators: Validator[] = [{ name: 'V', validate }];
      const surface = createBonklmInngestContextSurface(step, { validators });
      await surface.validateInput('hello');
      expect(validate).toHaveBeenCalledWith({ kind: 'text', content: 'hello' });
    });

    it('validateInput accepts a pre-built ValidatorInput as-is', async () => {
      const step = makeReplayingStepRunner();
      const validate = vi.fn().mockReturnValue(okResult('cold'));
      const validators: Validator[] = [{ name: 'V', validate }];
      const surface = createBonklmInngestContextSurface(step, { validators });
      await surface.validateInput({
        kind: 'retrieved_docs',
        docs: [{ content: 'doc one' }],
      });
      expect(validate).toHaveBeenCalledWith({
        kind: 'retrieved_docs',
        docs: [{ content: 'doc one' }],
      });
    });
  });
});
