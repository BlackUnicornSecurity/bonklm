/**
 * Story 2.9 — Trigger.dev v3/v4 middleware tests
 * ==============================================
 *
 * Acceptance criteria (per `team/plans/2026-05-21-v0.4-v0.7-roadmap-FINAL.md`):
 *   1. Peer `@trigger.dev/sdk ^4.0.0`. Engines `node >= 20`.
 *   2. `withBonkLM(opts)` returns `{ middleware, onFailure }` ready to
 *      spread into `task({ middleware, onFailure, run })`.
 *   3. Locals-based handle survives CRIU checkpoint/resume — modelled
 *      here as a wait.for() boundary that does NOT re-invoke middleware.
 *   4. Retry-survival via cachedValidate keyed by `ctx.run.id` — a new
 *      attempt (middleware re-run) with the SAME run.id returns the
 *      cached BLOCK decision without re-firing the validator.
 *   5. Uses `ctx.run.isReplay` to short-circuit the rebuild when
 *      Trigger.dev resumes the same attempt from a checkpoint.
 *
 * Mirrors the inngest-connector test harness: a hand-rolled mock that
 * captures locals state + middleware/onFailure invocation patterns so
 * we don't need the full @trigger.dev/sdk machinery at unit-test time.
 *
 * Integration-grade CRIU resume + wait.for(5_000) requires a live
 * Trigger.dev runner; this suite uses a structural mock that replays
 * the locals snapshot across boundaries (same V8 heap = same `Map`
 * keyed by the locals symbol).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
// Outside a Trigger.dev runner, the localsAPI defaults to a noop
// manager. Install a StandardLocalsManager so locals.set/get work.
import { localsAPI } from '@trigger.dev/core/v3';
import { StandardLocalsManager } from '@trigger.dev/core/v3/workers';
import { locals } from '@trigger.dev/sdk/v3';
const localsManager = new StandardLocalsManager();
localsAPI.setGlobalLocalsManager(localsManager);

import { Severity, RiskLevel } from '@blackunicorn/bonklm';
import type { GuardrailResult, Validator } from '@blackunicorn/bonklm';
import { InMemoryLRUCache, GuardrailEngine } from '@blackunicorn/bonklm';
import {
  withBonkLM,
  createBonklmTriggerHandle,
  getBonklmHandle,
  bonklmHandleLocalsKey,
} from '../src/with-bonklm.js';
import type {
  BonklmTriggerHandle,
  BonklmTriggerRunContext,
} from '../src/types.js';

beforeEach(() => {
  localsManager.reset();
});

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
 * Mock TaskRunContext. Trigger.dev's actual context has many more
 * fields (queue, environment, organization, machine, etc.) but the
 * BonkLM middleware only consumes `ctx.run.id` + `ctx.run.isReplay`.
 */
function makeCtx(runId: string, isReplay = false): BonklmTriggerRunContext {
  return { run: { id: runId, isReplay } };
}

/**
 * Mock Trigger.dev locals registry. Trigger.dev's runtime `locals`
 * singleton is a per-process map keyed by symbol IDs created via
 * `locals.create(id)`. CRIU resume = same V8 heap = same map.
 *
 * The mock wraps the production locals registry directly — both share
 * the same `bonklmHandleLocalsKey` so `getBonklmHandle()` works against
 * the mock without any module-monkey-patch tricks.
 */

describe('Story 2.9 — withBonkLM (Trigger.dev v3/v4 middleware)', () => {
  describe('AC #2: withBonkLM(opts) returns { middleware, onFailure }', () => {
    it('returns a bindings object with middleware + onFailure functions', () => {
      const bindings = withBonkLM({
        validators: [{ name: 'V', validate: () => okResult('cold') }],
      });
      expect(typeof bindings.middleware).toBe('function');
      expect(typeof bindings.onFailure).toBe('function');
    });

    it('middleware is async and returns a Promise', () => {
      const { middleware } = withBonkLM({
        validators: [{ name: 'V', validate: () => okResult('cold') }],
      });
      const result = middleware({
        ctx: makeCtx('run_test_1'),
        next: async () => {},
      });
      expect(result).toBeInstanceOf(Promise);
      return result;
    });

    it('onFailure is async and returns a Promise', () => {
      const { onFailure } = withBonkLM({
        validators: [{ name: 'V', validate: () => okResult('cold') }],
      });
      const result = onFailure({
        ctx: makeCtx('run_test_2'),
        error: new Error('boom'),
      });
      expect(result).toBeInstanceOf(Promise);
      return result;
    });
  });

  describe('AC #3: middleware stores a handle in locals before next()', () => {
    it('handle is present in locals AFTER middleware runs', async () => {
      const { middleware } = withBonkLM({
        validators: [{ name: 'V', validate: () => okResult('cold') }],
      });
      let handleSeenInsideRun: BonklmTriggerHandle | undefined;
      await middleware({
        ctx: makeCtx('run_handle_1'),
        next: async () => {
          handleSeenInsideRun = getBonklmHandle();
        },
      });
      expect(handleSeenInsideRun).toBeDefined();
      expect(typeof handleSeenInsideRun?.validateInput).toBe('function');
      expect(typeof handleSeenInsideRun?.validateOutput).toBe('function');
      expect(typeof handleSeenInsideRun?.validateToolArgs).toBe('function');
    });

    it('middleware calls next() exactly once', async () => {
      const next = vi.fn().mockResolvedValue(undefined);
      const { middleware } = withBonkLM({
        validators: [{ name: 'V', validate: () => okResult('cold') }],
      });
      await middleware({ ctx: makeCtx('run_next_1'), next });
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('handle is accessible after an in-process async boundary inside next() (in-process parity, NOT a real CRIU test)', async () => {
      // rev R6 (Story 2.9 audit) closure: renamed to clarify scope.
      // Approximates: middleware → handle stored → next() → handler
      // awaits a non-CRIU microtask boundary → handler continues with
      // the SAME locals. A real CRIU resume requires a live
      // Trigger.dev runner; this test only verifies that locals.get
      // works correctly after the event loop yields.
      const { middleware } = withBonkLM({
        validators: [{ name: 'V', validate: () => okResult('cold') }],
      });
      let handleAfterAwait: BonklmTriggerHandle | undefined;
      await middleware({
        ctx: makeCtx('run_await_1'),
        next: async () => {
          const handleBeforeAwait = getBonklmHandle();
          expect(handleBeforeAwait).toBeDefined();
          // Simulated wait.for() boundary — heap is checkpointed here.
          await new Promise((resolve) => setTimeout(resolve, 5));
          handleAfterAwait = getBonklmHandle();
        },
      });
      expect(handleAfterAwait).toBeDefined();
      expect(typeof handleAfterAwait?.validateInput).toBe('function');
    });
  });

  describe('AC #4: retry-survival via cachedValidate keyed by ctx.run.id', () => {
    it('attempt #2 of the same run (same run.id) returns the cached BLOCK without re-firing the validator', async () => {
      const cache = new InMemoryLRUCache({ maxEntries: 16 });
      const validate = vi.fn().mockReturnValue(blockResult('prompt-injection'));
      const validators: Validator[] = [{ name: 'V', validate }];
      const sharedEngine = new GuardrailEngine({ validators });

      const { middleware } = withBonkLM({
        validators,
        engine: sharedEngine,
        cache,
      });

      // Attempt 1 — middleware runs, handle built, validator fires cold.
      let r1: { blocked: boolean } | undefined;
      await middleware({
        ctx: makeCtx('run_retry_1'),
        next: async () => {
          r1 = await getBonklmHandle().validateInput('attack payload');
        },
      });

      // Attempt 2 — Trigger.dev retries the SAME run (same run.id).
      // Middleware fires again at attempt start; the cache hit means
      // the validator does NOT fire a second time.
      let r2: { blocked: boolean; results: Array<{ fromCache: boolean }> } | undefined;
      await middleware({
        ctx: makeCtx('run_retry_1'),
        next: async () => {
          r2 = (await getBonklmHandle().validateInput('attack payload')) as {
            blocked: boolean;
            results: Array<{ fromCache: boolean }>;
          };
        },
      });

      expect(r1?.blocked).toBe(true);
      expect(r2?.blocked).toBe(true);
      expect(validate).toHaveBeenCalledTimes(1);
      expect(r2?.results[0].fromCache).toBe(true);
      // rev R5 (Story 2.9 audit) closure: assert the cold path on r1
      // so the test cannot accidentally pass when cachedValidate is
      // failing to write entries (validator called once but BOTH calls
      // returning fromCache=false would otherwise slip through).
      expect(
        (r1 as unknown as { results: Array<{ fromCache: boolean }> }).results[0]
          .fromCache
      ).toBe(false);
    });

    it('different run.id => cache miss (no cross-run cache poisoning)', async () => {
      const cache = new InMemoryLRUCache({ maxEntries: 16 });
      const validate = vi.fn().mockReturnValue(blockResult('blocked'));
      const validators: Validator[] = [{ name: 'V', validate }];
      const sharedEngine = new GuardrailEngine({ validators });

      const { middleware } = withBonkLM({
        validators,
        engine: sharedEngine,
        cache,
      });

      await middleware({
        ctx: makeCtx('run_A'),
        next: async () => {
          await getBonklmHandle().validateInput('payload');
        },
      });
      await middleware({
        ctx: makeCtx('run_B'),
        next: async () => {
          await getBonklmHandle().validateInput('payload');
        },
      });

      // Two distinct run.ids → two distinct cacheNamespaces → validator
      // fired TWICE despite identical input.
      expect(validate).toHaveBeenCalledTimes(2);
    });
  });

  describe('AC #5: ctx.run.isReplay handling', () => {
    it('isReplay=true still produces a usable handle (locals are restored from CRIU)', async () => {
      const { middleware } = withBonkLM({
        validators: [{ name: 'V', validate: () => okResult('cold') }],
      });
      let handle: BonklmTriggerHandle | undefined;
      await middleware({
        ctx: makeCtx('run_replay_1', true),
        next: async () => {
          handle = getBonklmHandle();
        },
      });
      expect(handle).toBeDefined();
      const r = await handle!.validateInput('hello');
      expect(r.allowed).toBe(true);
    });
  });

  describe('Handle surface — validateInput / validateOutput / validateToolArgs', () => {
    it('validateInput accepts a string and wraps it as { kind: "text" }', async () => {
      const validate = vi.fn().mockReturnValue(okResult('cold'));
      const handle = createBonklmTriggerHandle({
        validators: [{ name: 'V', validate }],
        runId: 'run_input_1',
      });
      await handle.validateInput('hello');
      expect(validate).toHaveBeenCalledWith({ kind: 'text', content: 'hello' });
    });

    it('validateInput accepts a pre-built ValidatorInput as-is', async () => {
      const validate = vi.fn().mockReturnValue(okResult('cold'));
      const handle = createBonklmTriggerHandle({
        validators: [{ name: 'V', validate }],
        runId: 'run_input_2',
      });
      await handle.validateInput({
        kind: 'retrieved_docs',
        docs: [{ content: 'doc one' }],
      });
      expect(validate).toHaveBeenCalledWith({
        kind: 'retrieved_docs',
        docs: [{ content: 'doc one' }],
      });
    });

    it('validateOutput wraps a string as ValidatorInput.text', async () => {
      const validate = vi.fn().mockReturnValue(okResult('cold'));
      const handle = createBonklmTriggerHandle({
        validators: [{ name: 'V', validate }],
        runId: 'run_output_1',
      });
      await handle.validateOutput('generated text');
      expect(validate).toHaveBeenCalledWith({
        kind: 'text',
        content: 'generated text',
      });
    });

    it('validateToolArgs passes a tool_call ValidatorInput', async () => {
      const validate = vi.fn().mockReturnValue(okResult('cold'));
      const handle = createBonklmTriggerHandle({
        validators: [{ name: 'V', validate }],
        runId: 'run_tool_1',
      });
      await handle.validateToolArgs('send_email', { to: 'a@b.com' });
      expect(validate).toHaveBeenCalledWith({
        kind: 'tool_call',
        toolName: 'send_email',
        args: { to: 'a@b.com' },
      });
    });

    it('returns blocked=true with reason from first blocking validator', async () => {
      const handle = createBonklmTriggerHandle({
        validators: [
          { name: 'V1', validate: () => okResult('first ok') },
          { name: 'V2', validate: () => blockResult('second blocked') },
          { name: 'V3', validate: () => okResult('third ok') },
        ],
        runId: 'run_agg_1',
      });
      const r = await handle.validateInput('x');
      expect(r.blocked).toBe(true);
      expect(r.allowed).toBe(false);
      expect(r.reason).toBe('second blocked');
      expect(r.results).toHaveLength(3);
    });

    it('returns blocked=false when all validators allow', async () => {
      const handle = createBonklmTriggerHandle({
        validators: [
          { name: 'V1', validate: () => okResult('ok') },
          { name: 'V2', validate: () => okResult('ok') },
        ],
        runId: 'run_agg_2',
      });
      const r = await handle.validateInput('x');
      expect(r.blocked).toBe(false);
      expect(r.allowed).toBe(true);
      expect(r.reason).toBeUndefined();
    });
  });

  describe('getBonklmHandle() defensive accessor', () => {
    it('throws a descriptive error when middleware did not run', () => {
      // beforeEach reset wipes locals — slot is empty → throws.
      expect(() => getBonklmHandle()).toThrow(/withBonkLM/);
    });
  });

  describe('Configuration validation', () => {
    it('throws when validators array is empty', () => {
      expect(() => withBonkLM({ validators: [] })).toThrow(/non-empty array/);
    });

    it('throws when validators is missing', () => {
      expect(() =>
        // @ts-expect-error — invalid input under test.
        withBonkLM({ validators: undefined })
      ).toThrow(/non-empty array/);
    });

    it('throws downstream when a cache is wired + validator lacks .name', async () => {
      const anon: Validator = { validate: () => okResult('cold') };
      const { middleware } = withBonkLM({
        validators: [anon],
        cache: new InMemoryLRUCache(),
      });
      await expect(
        middleware({
          ctx: makeCtx('run_noname_1'),
          next: async () => {
            await getBonklmHandle().validateInput('x');
          },
        })
      ).rejects.toThrow(/no `name` property/);
    });
  });

  describe('Boundary validation — toolName + non-serializable inputs', () => {
    it('validateToolArgs returns BLOCK for empty toolName', async () => {
      const handle = createBonklmTriggerHandle({
        validators: [{ name: 'V', validate: () => okResult('cold') }],
        runId: 'run_bound_1',
      });
      const r = await handle.validateToolArgs('', { x: 1 });
      expect(r.blocked).toBe(true);
      expect(r.reason).toMatch(/non-empty string/);
    });

    it('validateToolArgs returns BLOCK for whitespace-only toolName', async () => {
      const handle = createBonklmTriggerHandle({
        validators: [{ name: 'V', validate: () => okResult('cold') }],
        runId: 'run_bound_2',
      });
      const r = await handle.validateToolArgs('   ', { x: 1 });
      expect(r.blocked).toBe(true);
    });

    it('validateToolArgs returns BLOCK for non-string toolName', async () => {
      const handle = createBonklmTriggerHandle({
        validators: [{ name: 'V', validate: () => okResult('cold') }],
        runId: 'run_bound_3',
      });
      // @ts-expect-error — invalid input under test.
      const r = await handle.validateToolArgs(42, { x: 1 });
      expect(r.blocked).toBe(true);
    });

    it('validateToolArgs with Map in args returns BLOCK (not throw)', async () => {
      const handle = createBonklmTriggerHandle({
        validators: [{ name: 'V', validate: () => okResult('cold') }],
        runId: 'run_bound_4',
      });
      const r = await handle.validateToolArgs('send', { m: new Map() });
      expect(r.blocked).toBe(true);
      expect(r.reason).toMatch(/not serializable|unsupported object type/);
    });

    it('validateInput with non-plain-prototype object BLOCKs', async () => {
      const handle = createBonklmTriggerHandle({
        validators: [{ name: 'V', validate: () => okResult('cold') }],
        runId: 'run_bound_5',
      });
      class Custom {
        x = 1;
      }
      // @ts-expect-error — invalid shape under test.
      const r = await handle.validateInput({
        kind: 'tool_call',
        toolName: 'x',
        args: new Custom(),
      });
      expect(r.blocked).toBe(true);
    });

    it('validateInput rejects wrong-shape objects', async () => {
      const handle = createBonklmTriggerHandle({
        validators: [{ name: 'V', validate: () => okResult('cold') }],
        runId: 'run_bound_6',
      });
      // @ts-expect-error — invalid shape under test.
      const r = await handle.validateInput(42);
      expect(r.blocked).toBe(true);
    });
  });

  describe('onFailure hook — observability shim', () => {
    it('invokes the configured logger with the run id + error message', async () => {
      const warn = vi.fn();
      const { onFailure } = withBonkLM({
        validators: [{ name: 'V', validate: () => okResult('cold') }],
        logger: { warn },
      });
      await onFailure({
        ctx: makeCtx('run_fail_1'),
        error: new Error('upstream blew up'),
      });
      expect(warn).toHaveBeenCalled();
      const [msg, meta] = warn.mock.calls[0];
      expect(typeof msg).toBe('string');
      expect(meta).toMatchObject({ runId: 'run_fail_1' });
    });

    it('does not throw when no logger is configured', async () => {
      const { onFailure } = withBonkLM({
        validators: [{ name: 'V', validate: () => okResult('cold') }],
      });
      await expect(
        onFailure({ ctx: makeCtx('run_fail_2'), error: new Error('x') })
      ).resolves.not.toThrow();
    });

    it('sanitizes attacker-controlled error reason text before logging', async () => {
      // Mirror Sprint 13 cumulative-audit sec CS3 closure (Inngest):
      // attacker-controlled validator output / error messages must
      // pass through sanitizeReasonText before hitting downstream
      // observability sinks.
      const warn = vi.fn();
      const { onFailure } = withBonkLM({
        validators: [{ name: 'V', validate: () => okResult('cold') }],
        logger: { warn },
      });
      const ctlChars = '[31mEVIL[0m';
      await onFailure({
        ctx: makeCtx('run_fail_3'),
        error: new Error(ctlChars),
      });
      expect(warn).toHaveBeenCalled();
      const meta = warn.mock.calls[0][1] as { error?: string };
      expect(meta.error ?? '').not.toMatch(/\[/);
    });
  });

  describe('B4-sec parity: cacheNamespace sanitization', () => {
    it('throws on cacheNamespace containing "::" (would collide with run-id separator)', () => {
      expect(() =>
        withBonkLM({
          validators: [{ name: 'V', validate: () => okResult('cold') }],
          cacheNamespace: 'bad::ns',
          cache: new InMemoryLRUCache(),
        })
      ).toThrow(/cacheNamespace/);
    });
  });

  // ── Story 2.9 audit-closure regressions ─────────────────────────────

  describe('Audit BLOCK closures (Story 2.9 3-lane review)', () => {
    describe('sec S2 / rev R1 — locals-slot squatting + null-handle bypass', () => {
      it('getBonklmHandle() throws when a squatting peer wrote a non-conformant object into the slot', () => {
        // Simulate a supply-chain peer dep writing a backdoor that
        // returns blocked=false for everything but lacks the
        // required methods.
        locals.set(bonklmHandleLocalsKey, {
          backdoor: true,
        } as unknown as BonklmTriggerHandle);
        expect(() => getBonklmHandle()).toThrow(/not a valid BonklmTriggerHandle/);
      });

      it('getBonklmHandle() throws when the slot is null (R1 — old `=== undefined` check would have passed)', () => {
        locals.set(
          bonklmHandleLocalsKey,
          null as unknown as BonklmTriggerHandle
        );
        expect(() => getBonklmHandle()).toThrow(/no BonkLM handle/);
      });

      it('getBonklmHandle() throws when the slot value is missing validateOutput', () => {
        locals.set(bonklmHandleLocalsKey, {
          validateInput: async () => ({
            blocked: false,
            allowed: true,
            results: [],
          }),
          validateToolArgs: async () => ({
            blocked: false,
            allowed: true,
            results: [],
          }),
        } as unknown as BonklmTriggerHandle);
        expect(() => getBonklmHandle()).toThrow(/not a valid BonklmTriggerHandle/);
      });
    });

    describe('arch X5 — cross-task locals bleed detection via run-id tag', () => {
      it('getBonklmHandle(ctx) throws when the handle was minted for a different run.id', async () => {
        const { middleware } = withBonkLM({
          validators: [{ name: 'V', validate: () => okResult('cold') }],
        });
        // Run A populates the locals slot.
        await middleware({
          ctx: makeCtx('run_A_xtask'),
          next: async () => {},
        });
        // Worker forgot to reset locals between runs. Run B's handler
        // tries to retrieve the handle with ITS ctx — mismatch detected.
        expect(() => getBonklmHandle(makeCtx('run_B_xtask'))).toThrow(
          /cross-task locals bleed/
        );
      });

      it('getBonklmHandle(ctx) succeeds when the handle was minted for the SAME run.id', async () => {
        const { middleware } = withBonkLM({
          validators: [{ name: 'V', validate: () => okResult('cold') }],
        });
        await middleware({
          ctx: makeCtx('run_same'),
          next: async () => {
            const h = getBonklmHandle(makeCtx('run_same'));
            expect(typeof h.validateInput).toBe('function');
          },
        });
      });
    });

    describe('rev R3 — discriminant-required field check for kind=text', () => {
      it('validateInput returns BLOCK when kind=text and content is numeric', async () => {
        const handle = createBonklmTriggerHandle({
          validators: [{ name: 'V', validate: () => okResult('cold') }],
          runId: 'run_text_numeric',
        });
        // @ts-expect-error — invalid shape under test.
        const r = await handle.validateInput({ kind: 'text', content: 42 });
        expect(r.blocked).toBe(true);
        expect(r.reason).toMatch(/kind=text requires `content` to be a string/);
      });

      it('validateInput returns BLOCK when kind=text and content is undefined', async () => {
        const handle = createBonklmTriggerHandle({
          validators: [{ name: 'V', validate: () => okResult('cold') }],
          runId: 'run_text_undef',
        });
        // @ts-expect-error — invalid shape under test.
        const r = await handle.validateInput({ kind: 'text' });
        expect(r.blocked).toBe(true);
      });
    });

    describe('sec S7 — validators array frozen at factory time', () => {
      it('post-factory mutation of the original validators array does NOT change the pipeline', async () => {
        const validate = vi.fn().mockReturnValue(okResult('cold'));
        const validators: Validator[] = [{ name: 'V', validate }];
        const { middleware } = withBonkLM({ validators });
        // Mutate the array AFTER the factory call — this MUST NOT leak
        // into subsequent middleware invocations.
        const evilValidate = vi.fn().mockReturnValue(blockResult('evil'));
        validators.push({ name: 'evil', validate: evilValidate });

        await middleware({
          ctx: makeCtx('run_frozen'),
          next: async () => {
            const r = await getBonklmHandle().validateInput('hello');
            expect(r.blocked).toBe(false);
            expect(evilValidate).not.toHaveBeenCalled();
          },
        });
      });
    });

    describe('arch X10a — in-attempt dedupe within one next() body', () => {
      it('two identical validateInput calls inside one next() body hit the cache on the second', async () => {
        const cache = new InMemoryLRUCache({ maxEntries: 16 });
        const validate = vi.fn().mockReturnValue(okResult('cold'));
        const validators: Validator[] = [{ name: 'V', validate }];
        const { middleware } = withBonkLM({ validators, cache });

        await middleware({
          ctx: makeCtx('run_inattempt'),
          next: async () => {
            const h = getBonklmHandle();
            const a = await h.validateInput('payload');
            const b = await h.validateInput('payload');
            expect(validate).toHaveBeenCalledTimes(1);
            expect(a.results[0].fromCache).toBe(false);
            expect(b.results[0].fromCache).toBe(true);
          },
        });
      });
    });

    describe('arch X10b / sec S9 — cross-factory engine cache pollution', () => {
      it('two distinct withBonkLM factories sharing one engine WOULD collapse caches (documented behavior)', async () => {
        // This test documents the EXPECTED behavior of sharing an
        // engine across factories: cache namespaces collapse to the
        // same salt prefix + same cacheNamespace base. Run IDs differ,
        // so the per-run suffix isolates them — but two factories
        // wired to the SAME runId (e.g. one task triggering a sub-task
        // with the same runId via idempotency) WOULD share cache.
        //
        // We assert the cache prefix shape rather than the cross-task
        // hit because Trigger.dev's runId is platform-assigned-unique.
        // The `@security` warning on `BonklmTriggerOptions.engine`
        // documents the trade-off.
        const cache = new InMemoryLRUCache({ maxEntries: 16 });
        const validate = vi.fn().mockReturnValue(okResult('cold'));
        const validators: Validator[] = [{ name: 'V', validate }];
        const sharedEngine = new GuardrailEngine({ validators });

        const factory1 = withBonkLM({ validators, engine: sharedEngine, cache });
        const factory2 = withBonkLM({ validators, engine: sharedEngine, cache });

        // Same run.id passed to both factories' middleware (simulating
        // an idempotency-key replay across two task definitions).
        // Cache hit means the salt is genuinely shared.
        await factory1.middleware({
          ctx: makeCtx('run_shared_engine'),
          next: async () => {
            await getBonklmHandle().validateInput('payload');
          },
        });
        await factory2.middleware({
          ctx: makeCtx('run_shared_engine'),
          next: async () => {
            await getBonklmHandle().validateInput('payload');
          },
        });
        expect(validate).toHaveBeenCalledTimes(1);
      });
    });
  });
});
