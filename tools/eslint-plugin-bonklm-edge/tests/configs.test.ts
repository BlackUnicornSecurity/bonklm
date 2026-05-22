/**
 * tools/eslint-plugin-bonklm-edge — exported configs tests.
 *
 * Sprint 13 close: `configs.warnPhase` + `grandfatherAllowlist` were
 * REMOVED. The plugin now ships with `configs.recommended` only —
 * uniform `'error'` severity.
 */
import { describe, it, expect } from 'vitest';
import plugin from '../src/index.js';

describe('plugin exports', () => {
  it('exposes the no-bare-process-env rule', () => {
    expect(plugin.rules).toBeDefined();
    expect(plugin.rules!['no-bare-process-env']).toBeDefined();
    expect(plugin.rules!['no-bare-process-env'].meta?.docs?.description).toMatch(
      /process\.env/
    );
  });

  it('exposes a recommended config with uniform error severity', () => {
    const recommended = plugin.configs!.recommended as {
      plugins?: Record<string, unknown>;
      rules?: Record<string, string>;
    };
    expect(recommended).toBeDefined();
    expect(recommended.plugins?.['bonklm-edge']).toBe(plugin);
    expect(recommended.rules?.['bonklm-edge/no-bare-process-env']).toBe('error');
  });

  it('does NOT expose a warnPhase config (Sprint 13 rotation complete)', () => {
    const configs = plugin.configs as Record<string, unknown>;
    expect(configs.warnPhase).toBeUndefined();
  });
});
