/**
 * Story 2.1b-edge-core — EdgeHookManager
 *
 * EdgeHookManager is the function-only variant of HookSandbox that ships
 * via `@blackunicorn/bonklm/edge`. Workerd has no `node:vm` and cannot
 * execute string-handler hooks; EdgeHookManager refuses string handlers
 * at the execute boundary with a clear `ConnectorValidationError`.
 *
 * The Node-only `HookSandbox` (vm-based) remains importable from the root
 * package; it is NOT re-exported from `/edge`.
 */
import { describe, expect, it } from 'vitest';
import { EdgeHookManager } from '../../src/hooks/EdgeHookManager.js';
import { ConnectorValidationError } from '../../src/connector-utils/errors.js';

describe('EdgeHookManager', () => {
  describe('string-handler rejection', () => {
    it('throws ConnectorValidationError when executeHook is called with a string', async () => {
      const manager = new EdgeHookManager();
      await manager.initialize();

      await expect(
        manager.executeHook('return 1 + 1' as unknown as () => unknown, {})
      ).rejects.toThrowError(ConnectorValidationError);
    });

    it('throws with `configuration_error` category for diagnostic clarity', async () => {
      const manager = new EdgeHookManager();
      await manager.initialize();

      try {
        await manager.executeHook('return 1 + 1' as unknown as () => unknown, {});
        expect.unreachable('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(ConnectorValidationError);
        expect((e as ConnectorValidationError).category).toBe('configuration_error');
      }
    });

    it('the error message names EdgeHookManager so the diagnostic is unambiguous', async () => {
      const manager = new EdgeHookManager();
      await manager.initialize();

      try {
        await manager.executeHook('return 1 + 1' as unknown as () => unknown, {});
      } catch (e) {
        expect((e as Error).message).toMatch(/EdgeHookManager/);
        expect((e as Error).message).toMatch(/string-handler/i);
      }
    });
  });

  describe('function-handler execution', () => {
    it('executes a function handler and returns the result', async () => {
      const manager = new EdgeHookManager();
      await manager.initialize();

      const result = await manager.executeHook(
        (ctx) => ({ doubled: (ctx.value as number) * 2 }),
        { value: 21 }
      );

      expect(result.success).toBe(true);
      expect(result.result).toEqual({ doubled: 42 });
      expect(result.sandboxed).toBe(false); // edge does not VM-sandbox
    });

    it('catches synchronous handler throws and reports EXECUTION_ERROR', async () => {
      const manager = new EdgeHookManager();
      await manager.initialize();

      const result = await manager.executeHook(() => {
        throw new Error('handler-blew-up');
      }, {});

      expect(result.success).toBe(false);
      expect(result.error).toBe('EXECUTION_ERROR');
      expect(result.message).toBe('handler-blew-up');
    });

    it('awaits async function handlers and returns their resolved value', async () => {
      const manager = new EdgeHookManager();
      await manager.initialize();

      const result = await manager.executeHook(
        async (ctx) => {
          await new Promise((r) => setTimeout(r, 1));
          return `processed:${ctx.id as string}`;
        },
        { id: 'edge-1' }
      );

      expect(result.success).toBe(true);
      expect(result.result).toBe('processed:edge-1');
    });
  });

  describe('require initialize() before executeHook', () => {
    it('throws if executeHook is called before initialize()', async () => {
      const manager = new EdgeHookManager();
      // intentionally NOT calling initialize()

      await expect(manager.executeHook(() => 1, {})).rejects.toThrowError(
        /not initialized/i
      );
    });
  });

  describe('execution log + statistics', () => {
    it('logs successful executions and exposes via getStatistics()', async () => {
      const manager = new EdgeHookManager();
      await manager.initialize();

      await manager.executeHook(() => 1, {});
      await manager.executeHook(() => 2, {});

      const stats = manager.getStatistics();
      expect(stats.totalExecutions).toBe(2);
      expect(stats.blockedAttempts).toBe(0);
    });

    it('logs string-handler rejection as a blockedAttempt', async () => {
      const manager = new EdgeHookManager();
      await manager.initialize();

      try {
        await manager.executeHook(
          'return 1 + 1' as unknown as () => unknown,
          {}
        );
      } catch {
        /* expected */
      }

      const stats = manager.getStatistics();
      expect(stats.blockedAttempts).toBe(1);
    });
  });
});
