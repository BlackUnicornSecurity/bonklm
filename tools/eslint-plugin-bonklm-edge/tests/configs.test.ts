/**
 * tools/eslint-plugin-bonklm-edge — exported configs tests.
 *
 * Verifies the post-audit BLOCK-A closure: the WARN-phase config
 * actually emits per-file overrides reading from the on-disk
 * grandfather-allowlist.json — not just documentation in the
 * barrel JSDoc.
 */
import { describe, it, expect } from 'vitest';
import plugin, { grandfatherAllowlist } from '../src/index.js';

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

  it('exposes a warnPhase config as a Linter.Config[] array', () => {
    const warnPhase = plugin.configs!.warnPhase as unknown as Array<{
      files?: string[];
      rules?: Record<string, string>;
    }>;
    expect(Array.isArray(warnPhase)).toBe(true);
    expect(warnPhase.length).toBeGreaterThanOrEqual(1);

    // Block 0: default error.
    expect(warnPhase[0].rules?.['bonklm-edge/no-bare-process-env']).toBe('error');
    expect(warnPhase[0].files).toBeUndefined();
  });

  it('warnPhase Block-1 (override) carries the allowlist files at `warn` severity', () => {
    const warnPhase = plugin.configs!.warnPhase as unknown as Array<{
      files?: string[];
      rules?: Record<string, string>;
    }>;
    if (grandfatherAllowlist.files.length === 0) {
      // Post-deletion state — only the default error block exists.
      expect(warnPhase.length).toBe(1);
      return;
    }
    expect(warnPhase.length).toBe(2);
    expect(warnPhase[1].rules?.['bonklm-edge/no-bare-process-env']).toBe('warn');
    expect(warnPhase[1].files).toEqual(grandfatherAllowlist.files);
  });

  it('grandfatherAllowlist export matches the on-disk JSON shape', () => {
    // Loader sanity — assert structure, NOT specific contents. Specific
    // entries churn as files migrate off process.env; pinning a known
    // entry created false failures during normal Sprint-13 cleanup.
    expect(Array.isArray(grandfatherAllowlist.files)).toBe(true);
    expect(grandfatherAllowlist.files.length).toBeGreaterThan(0);
    for (const f of grandfatherAllowlist.files) {
      expect(typeof f).toBe('string');
      expect(f.length).toBeGreaterThan(0);
    }
    expect(grandfatherAllowlist.sprint13DeadlineUtc).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
