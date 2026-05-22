/**
 * Story 2.1b-connectors — `updateMemory` seal + race-resistance.
 *
 * Iter-2 architect BLOCK-2: both `createMemory` and `updateMemory`
 * must be sealed in the SAME synchronous block. A hostile plugin
 * loading via `Promise.resolve().then(() => Object.defineProperty(...))`
 * cannot interleave between the two seal calls — both
 * `Object.defineProperty` invocations execute before any microtask
 * resumes.
 */
import { describe, expect, it, vi } from 'vitest';
import { installSealedWrapMemory } from '../src/wrap-memory.js';
import { withCallContext } from '../src/als-context.js';
import { ConnectorValidationError } from '@blackunicorn/bonklm/core/connector-utils';
import type { IAgentRuntimeLike, MemoryLike } from '../src/types.js';

function makeRuntime(): IAgentRuntimeLike & {
  updateMemory: (m: MemoryLike, ...r: unknown[]) => Promise<unknown>;
} {
  return {
    agentId: 'test-agent',
    createMemory: vi.fn(async () => 'created'),
    updateMemory: vi.fn(async () => 'updated'),
    actions: [],
  } as unknown as IAgentRuntimeLike & {
    updateMemory: (m: MemoryLike, ...r: unknown[]) => Promise<unknown>;
  };
}

describe('installSealedWrapMemory — updateMemory seal', () => {
  it('seals updateMemory alongside createMemory', () => {
    const runtime = makeRuntime();
    installSealedWrapMemory(runtime, {});

    const createDesc = Object.getOwnPropertyDescriptor(runtime, 'createMemory');
    const updateDesc = Object.getOwnPropertyDescriptor(runtime, 'updateMemory');
    expect(createDesc?.configurable).toBe(false);
    expect(createDesc?.writable).toBe(false);
    expect(updateDesc?.configurable).toBe(false);
    expect(updateDesc?.writable).toBe(false);
  });

  it('refuses install if updateMemory is already sealed', () => {
    const runtime = makeRuntime();
    Object.defineProperty(runtime, 'updateMemory', {
      value: () => {},
      writable: false,
      configurable: false,
      enumerable: true,
    });
    expect(() => installSealedWrapMemory(runtime, {})).toThrow(ConnectorValidationError);
  });

  it('does NOT install updateMemory seal when the runtime lacks updateMemory', () => {
    const runtime = {
      agentId: 'test-agent',
      createMemory: vi.fn(async () => 'created'),
    } as IAgentRuntimeLike;
    expect(() => installSealedWrapMemory(runtime, {})).not.toThrow();
    // updateMemory was never defined on the runtime, so it remains undefined.
    expect((runtime as { updateMemory?: unknown }).updateMemory).toBeUndefined();
  });

  it('updateMemory wrap applies the SAME refuse-write checks as createMemory', async () => {
    const runtime = makeRuntime();
    installSealedWrapMemory(runtime, {});

    // Provider-source messages write (no withCallContext scope → source
    // defaults to 'agent_internal') passes through. But a write with
    // an unauthenticated source should refuse — set up the ALS scope.
    await withCallContext(
      runtime,
      { sourceTrust: 'unauthenticated_http', pluginName: '@evil/plugin' },
      async () => {
        await expect(
          runtime.updateMemory(
            {
              tableName: 'messages',
              content: { text: 'test' },
            } as MemoryLike
          )
        ).rejects.toThrow(ConnectorValidationError);
      }
    );
  });

  it('race-resistance: attacker Promise.resolve().then() seal between createMemory + updateMemory does NOT win', async () => {
    // Simulate a hostile plugin that schedules a defineProperty on
    // updateMemory immediately. Because installSealedWrapMemory's two
    // defineProperty calls execute in the SAME synchronous block (no
    // await between), the attacker's microtask cannot interleave.
    const runtime = makeRuntime();

    let attackerWon = false;
    void Promise.resolve().then(() => {
      try {
        Object.defineProperty(runtime, 'updateMemory', {
          value: () => 'hostile',
          writable: true,
          configurable: true,
        });
        attackerWon = true;
      } catch {
        // Expected — the slot is non-configurable by now.
      }
    });

    installSealedWrapMemory(runtime, {});

    // Yield so the attacker's microtask runs (after install completes).
    await new Promise((r) => setImmediate(r));

    // The attacker's redefine should have FAILED because both slots
    // are non-configurable by the time the microtask resumes.
    expect(attackerWon).toBe(false);

    // Confirm the install's seal survived.
    const desc = Object.getOwnPropertyDescriptor(runtime, 'updateMemory');
    expect(desc?.configurable).toBe(false);
  });
});
