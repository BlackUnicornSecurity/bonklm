/**
 * Story 1.1 — HookSurface backward-compat + deprecation
 * =====================================================
 * R2-D3 + R2-9 + R2-10:
 *  - `surface` defaults to `'text_input'` when omitted from `registerHook`.
 *  - Emits a one-shot `@deprecated` warning on the first omitted-surface
 *    registration per-manager (will THROW in 0.5).
 *  - Vocabulary is locked to the 7 strings — no synonyms (`'prompt'`,
 *    `'output'`, `'tool_args'` etc. must NOT type-check).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { HookManager, HookPhase, type HookContext } from '../../../src/hooks/index.js';
import type { HookSurface } from '../../../src/engine/GuardrailEngine.types.js';
import { LogLevel, type Logger } from '../../../src/base/GenericLogger.js';

function captureLogger(): Logger & { warns: string[] } {
  const warns: string[] = [];
  return {
    level: LogLevel.DEBUG,
    debug: () => {},
    info: () => {},
    warn: (msg: string) => {
      warns.push(msg);
    },
    error: () => {},
    warns,
  } as Logger & { warns: string[] };
}

describe('HookSurface backward-compat (Story 1.1 / R2-D3)', () => {
  let logger: ReturnType<typeof captureLogger>;
  let manager: HookManager<HookContext>;

  beforeEach(() => {
    logger = captureLogger();
    manager = new HookManager({ logger });
  });

  it('defaults `surface` to "text_input" when omitted from registerHook', () => {
    const id = manager.registerHook({
      name: 'compat-hook',
      phase: HookPhase.BEFORE_VALIDATION,
      handler: async () => ({ success: true }),
    });
    const hooks = manager.getHooks().get(HookPhase.BEFORE_VALIDATION) ?? [];
    const target = hooks.find((h) => h.id === id);
    expect(target?.surface).toBe('text_input');
  });

  it('emits a deprecation warning the first time surface is omitted', () => {
    manager.registerHook({
      name: 'no-surface-1',
      phase: HookPhase.BEFORE_VALIDATION,
      handler: async () => ({ success: true }),
    });
    expect(logger.warns.some((w) => /deprecat/i.test(w) && /surface/i.test(w))).toBe(true);
  });

  it('does not re-emit the deprecation warning on the second omitted registration', () => {
    manager.registerHook({
      name: 'no-surface-1',
      phase: HookPhase.BEFORE_VALIDATION,
      handler: async () => ({ success: true }),
    });
    const warnsAfterFirst = logger.warns.filter((w) => /deprecat/i.test(w)).length;

    manager.registerHook({
      name: 'no-surface-2',
      phase: HookPhase.AFTER_VALIDATION,
      handler: async () => ({ success: true }),
    });
    const warnsAfterSecond = logger.warns.filter((w) => /deprecat/i.test(w)).length;

    expect(warnsAfterFirst).toBe(1);
    expect(warnsAfterSecond).toBe(1);
  });

  it('accepts an explicit surface without emitting a deprecation warning', () => {
    manager.registerHook({
      name: 'explicit-surface',
      phase: HookPhase.BEFORE_VALIDATION,
      surface: 'tool_call',
      handler: async () => ({ success: true }),
    });
    expect(logger.warns.filter((w) => /deprecat/i.test(w))).toHaveLength(0);
  });

  it('preserves explicit surface verbatim across all 7 canonical strings', () => {
    const canonical: HookSurface[] = [
      'text_input',
      'text_output',
      'tool_call',
      'retrieved_doc',
      'memory_write',
      'audio_partial',
      'composed_context',
    ];
    for (const surface of canonical) {
      const id = manager.registerHook({
        name: `surface-${surface}`,
        phase: HookPhase.BEFORE_VALIDATION,
        surface,
        handler: async () => ({ success: true }),
      });
      const hooks = manager.getHooks().get(HookPhase.BEFORE_VALIDATION) ?? [];
      const target = hooks.find((h) => h.id === id);
      expect(target?.surface).toBe(surface);
    }
  });
});
