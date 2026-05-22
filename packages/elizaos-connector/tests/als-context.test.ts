/**
 * Story 2.1b-connectors — AsyncLocalStorage call-context migration tests.
 *
 * Iter-2 architect BLOCK-1 + adversarial #11: closes the
 * `runtime.bonklm.currentCallContext` hostile-direct-assignment
 * vector. Hostile plugins writing into that property must become
 * INERT — the wrap-memory closure now consults ALS, not the property.
 */
import { describe, expect, it } from 'vitest';
import {
  withCallContext,
  withCallContextSync,
  getCallContext,
  runWithoutCallContext,
  assertCallContextRuntime,
  type CallContext,
} from '../src/als-context.js';
import type { IAgentRuntimeLike } from '../src/types.js';

const fakeRuntime: IAgentRuntimeLike = {
  agentId: 'test-agent',
  createMemory: async () => undefined,
};

describe('als-context — withCallContext propagation', () => {
  it('getCallContext returns undefined OUTSIDE any withCallContext scope', () => {
    expect(getCallContext()).toBeUndefined();
  });

  it('getCallContext returns the supplied context INSIDE withCallContext', async () => {
    const ctx: CallContext = { sourceTrust: 'authenticated', pluginName: '@x/plugin-x' };
    await withCallContext(fakeRuntime, ctx, async () => {
      expect(getCallContext()).toBe(ctx);
    });
  });

  it('propagates context across an await boundary', async () => {
    const ctx: CallContext = { sourceTrust: 'authenticated' };
    await withCallContext(fakeRuntime, ctx, async () => {
      await new Promise((r) => setTimeout(r, 1));
      expect(getCallContext()).toBe(ctx);
    });
  });

  it('propagates context into setTimeout callbacks scheduled inside the scope', async () => {
    const ctx: CallContext = { sourceTrust: 'agent_internal' };
    await new Promise<void>((resolve) => {
      void withCallContext(fakeRuntime, ctx, async () => {
        setTimeout(() => {
          expect(getCallContext()).toBe(ctx);
          resolve();
        }, 1);
      });
    });
  });

  it('isolates concurrent withCallContext calls via Promise.all + setImmediate yield', async () => {
    // Per iter-2 senior-dev AAD-B: the Promise.all + yield pattern is
    // the only one that surfaces async-boundary leaks.
    const ctxA: CallContext = { sourceTrust: 'authenticated', pluginName: 'A' };
    const ctxB: CallContext = { sourceTrust: 'unauthenticated_http', pluginName: 'B' };
    const yieldOnce = () => new Promise((r) => setImmediate(r));

    const observed: Array<CallContext | undefined> = [];
    await Promise.all([
      withCallContext(fakeRuntime, ctxA, async () => {
        await yieldOnce();
        observed.push(getCallContext());
      }),
      withCallContext(fakeRuntime, ctxB, async () => {
        await yieldOnce();
        observed.push(getCallContext());
      }),
    ]);

    expect(observed).toContain(ctxA);
    expect(observed).toContain(ctxB);
    // Neither call observed the OTHER's context.
    expect(observed.filter((c) => c === ctxA).length).toBe(1);
    expect(observed.filter((c) => c === ctxB).length).toBe(1);
  });

  it('does NOT leak context to siblings after the scope returns', async () => {
    const ctx: CallContext = { sourceTrust: 'authenticated' };
    await withCallContext(fakeRuntime, ctx, async () => {
      // intentionally empty
    });
    // After withCallContext returns, the ambient context is again undefined.
    expect(getCallContext()).toBeUndefined();
  });

  it('hostile direct assignment to runtime.bonklm.currentCallContext is INERT', async () => {
    // The Phase-2 attack-resistance property: even if a hostile plugin
    // writes into the (no-longer-consulted) property, the closure path
    // is unaffected.
    const runtimeWithBonklm = {
      ...fakeRuntime,
      bonklm: { currentCallContext: { sourceTrust: 'authenticated' as const, pluginName: 'attacker' } },
    } as IAgentRuntimeLike & { bonklm: { currentCallContext: CallContext } };

    // Even with the hostile property set, getCallContext() returns
    // undefined OUTSIDE any withCallContext scope because the new
    // implementation consults ALS, not runtime.bonklm.
    expect(getCallContext()).toBeUndefined();

    // Inside a legitimate withCallContext scope, the legitimate ctx
    // wins — the hostile property is invisible to the closure.
    const legitimateCtx: CallContext = { sourceTrust: 'agent_internal', pluginName: 'legit' };
    await withCallContext(runtimeWithBonklm, legitimateCtx, async () => {
      expect(getCallContext()).toBe(legitimateCtx);
      expect(getCallContext()?.pluginName).toBe('legit');
    });
  });
});

describe('als-context — runWithoutCallContext (probe ALS-clear)', () => {
  it('clears ambient context inside the function body', async () => {
    const parentCtx: CallContext = { sourceTrust: 'agent_internal' };
    await withCallContext(fakeRuntime, parentCtx, async () => {
      expect(getCallContext()).toBe(parentCtx);
      await runWithoutCallContext(async () => {
        // Inside the probe-clear, the parent ctx is GONE.
        expect(getCallContext()).toBeUndefined();
      });
      // After the probe-clear returns, the parent ctx is restored.
      expect(getCallContext()).toBe(parentCtx);
    });
  });
});

describe('als-context — withCallContextSync', () => {
  it('runs sync fn inside the scope', () => {
    const ctx: CallContext = { sourceTrust: 'authenticated' };
    const result = withCallContextSync(fakeRuntime, ctx, () => {
      expect(getCallContext()).toBe(ctx);
      return 42;
    });
    expect(result).toBe(42);
  });
});

describe('als-context — assertCallContextRuntime', () => {
  it('does not throw on Node (real AsyncLocalStorage)', () => {
    expect(() => assertCallContextRuntime()).not.toThrow();
  });
});
