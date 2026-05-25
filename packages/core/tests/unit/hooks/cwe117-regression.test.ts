/**
 * Sprint 46 cross-subsystem CWE-117 sweep — hooks subsystem regression.
 *
 * Per Sprint 45 lesson #2: telemetry was a third sink class outside
 * the Sprint 38 connector-utils + Sprint 42 engine enumeration scopes.
 * Sprint 46 extends the sweep to the hooks subsystem, surfaced 5
 * sites in `packages/core/src/hooks/index.ts`:
 *   - line ~175 (`logger.info('Hook registered', { name: hook.name, ... })`)
 *   - line ~231 (`logger.warn('Hook blocked execution', { name: hook.name, ... })`)
 *   - line ~237 (`logger.error('Hook execution failed', { name, error: error.message })`)
 *   - line ~248 (`message: \`Hook ${hook.name} failed: ${error}\`` — HookResult.message)
 *   - line ~331 (`message: \`Hook ${hook.name} timed out\`` — HookResult.message)
 *
 * All five sites embed `hook.name` (caller-supplied) raw. Sites 4+5
 * also embed `error` in the HookResult.message field returned to
 * caller (matches the Sprint 44 GuardrailResult.reason raw-forwarding
 * lesson — sanitize at construction).
 *
 * Sprint 46 wraps each with `sanitizeMeta` + switches raw
 * `error.message` to canonical `serializeError`.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  HookManager,
  HookPhase,
  sanitizeLogString,
  sanitizeMeta,
  serializeError,
} from '@blackunicorn/bonklm';

describe('hooks subsystem — Sprint 46 CWE-117 sanitization contract', () => {
  function makeSpyLogger() {
    return {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
  }

  it('imports sanitizeMeta + serializeError + sanitizeLogString from the core barrel', () => {
    expect(typeof sanitizeMeta).toBe('function');
    expect(typeof serializeError).toBe('function');
    expect(typeof sanitizeLogString).toBe('function');
  });

  it('sanitizes hostile hook.name at registration log site', () => {
    const logger = makeSpyLogger();
    const manager = new HookManager({ logger });

    const hostileName = 'my-hook\nINJECTED:fake_registered=true';
    manager.registerHook({
      name: hostileName,
      phase: HookPhase.BEFORE_VALIDATION,
      surface: 'text_input',
      handler: () => ({ success: true, shouldBlock: false }),
    });

    const registrationCall = logger.info.mock.calls.find(
      (call) => call[0] === 'Hook registered'
    );
    expect(registrationCall).toBeDefined();
    const meta = registrationCall![1] as { name?: string };
    expect(meta.name).toBeDefined();
    expect(meta.name).not.toContain('\n');
    expect(meta.name).toContain('INJECTED');
  });

  it('sanitizes hostile hook.name + serializeError at execution-failed log site', async () => {
    const logger = makeSpyLogger();
    const manager = new HookManager({ logger });

    const hostileName = 'hostile-hook\nINJECTED:fake_audit=PASS';
    manager.registerHook({
      name: hostileName,
      phase: HookPhase.BEFORE_VALIDATION,
      surface: 'text_input',
      handler: () => {
        throw new Error('handler boom\nINJECTED:fake_error');
      },
    });

    const results = await manager.executeHooks(
      HookPhase.BEFORE_VALIDATION,
      {} as never
    );

    // The error log fired with sanitized fields.
    const errorCall = logger.error.mock.calls.find(
      (call) => call[0] === 'Hook execution failed'
    );
    expect(errorCall).toBeDefined();
    const meta = errorCall![1] as {
      name?: string;
      error?: { message?: string };
    };
    expect(meta.name).toBeDefined();
    expect(meta.name).not.toContain('\n');
    expect(meta.name).toContain('INJECTED');
    // serializeError + sanitizeLogString collapses `\n` to literal
    // `\\n` marker in error.message.
    expect(meta.error?.message).toBe('handler boom\\nINJECTED:fake_error');

    // The HookResult.message ALSO carries the sanitized form (Sprint
    // 44 lesson: variable-binding-site sanitization). Sprint 46
    // CR SHOULD-FIX: `serializeError(error).message` sanitizes
    // internally — no double-wrap needed at the construction site.
    const failureResult = results.find((r) => !r.success);
    expect(failureResult).toBeDefined();
    expect(failureResult!.message).toBeDefined();
    expect(failureResult!.message).not.toContain('\n');
    expect(failureResult!.message).toContain('INJECTED');
  });

  it('sanitizes hostile hook.name in the blocked-execution warn log (Sprint 46 architect MEDIUM #9 closure)', async () => {
    const logger = makeSpyLogger();
    const manager = new HookManager({ logger });

    const hostileName = 'blocked-hook\nINJECTED:fake_blocked';
    manager.registerHook({
      name: hostileName,
      phase: HookPhase.BEFORE_VALIDATION,
      surface: 'text_input',
      handler: () => ({ success: true, shouldBlock: true }),
    });

    await manager.executeHooks(HookPhase.BEFORE_VALIDATION, {} as never);

    const blockedCall = logger.warn.mock.calls.find(
      (call) => call[0] === 'Hook blocked execution'
    );
    expect(blockedCall).toBeDefined();
    const meta = blockedCall![1] as { name?: string };
    expect(meta.name).not.toContain('\n');
    expect(meta.name).toContain('INJECTED');
  });

  it('sanitizes hostile hook.name in the timeout HookResult.message (Sprint 46 architect MEDIUM #9 closure)', async () => {
    const logger = makeSpyLogger();
    const manager = new HookManager({ logger, defaultTimeout: 10 });

    const hostileName = 'slow-hook\nINJECTED:fake_timeout';
    manager.registerHook({
      name: hostileName,
      phase: HookPhase.BEFORE_VALIDATION,
      surface: 'text_input',
      timeout: 10,
      handler: () =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ success: true, shouldBlock: false }), 100)
        ),
    });

    const results = await manager.executeHooks(
      HookPhase.BEFORE_VALIDATION,
      {} as never
    );

    const timeoutResult = results.find(
      (r) => r.message?.includes('timed out')
    );
    expect(timeoutResult).toBeDefined();
    expect(timeoutResult!.message).not.toContain('\n');
    expect(timeoutResult!.message).toContain('INJECTED');
  });
});
