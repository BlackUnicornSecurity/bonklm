// SPDX-License-Identifier: Apache-2.0
/**
 * OpenClaw Adapter - Main Entry Point
 * =====================================
 *
 * @deprecated **DEPRECATED at v0.4.0-rc1.** Package will be removed in
 * v0.6.0 (Sprint 16). Surface your use case at
 * https://github.com/BlackUnicornSecurity/bonklm/issues with label
 * `dep:openclaw` before 2026-07-01 OR migrate to a provider-specific
 * connector. See README for migration recipe.
 */

// Story 1.10 — emit a runtime deprecation warning once per process so
// consumers who silently rely on this package surface themselves.
// Node coalesces repeated emissions with the same code.
if (typeof process !== 'undefined' && typeof process.emitWarning === 'function') {
  process.emitWarning(
    '@blackunicorn/bonklm-openclaw is deprecated at v0.4.0-rc1 and will be removed in v0.6.0 (Sprint 16). See https://github.com/BlackUnicornSecurity/bonklm/issues (label: dep:openclaw) to surface your use case or migrate to a provider-specific connector before 2026-07-01.',
    {
      type: 'DeprecationWarning',
      code: 'BONKLM_OPENCLAW_DEPRECATED'
    }
  );
}

export * from './types.js';
export * from './middleware.js';
export { default } from './middleware.js';
