/**
 * @blackunicorn/eslint-plugin-edge
 * ================================
 * ESLint plugin enforcing edge-runtime-safe code in BonkLM connectors.
 *
 * Rules:
 *   - `bonklm-edge/no-bare-process-env` — bans bare `process.env.*`
 *     reads in files where the rule is configured. Migration path
 *     is `GuardrailEngineConfig.envBindings` injection per
 *     `docs/user/migration/edge-string-handlers.md`.
 *
 * Consumer config (per-package `eslint.config.js`):
 *
 * ```js
 * import bonklmEdge from '@blackunicorn/eslint-plugin-edge';
 *
 * export default [
 *   {
 *     files: ['src/**\/*.ts'],
 *     plugins: { 'bonklm-edge': bonklmEdge },
 *     rules: {
 *       'bonklm-edge/no-bare-process-env': 'error',
 *     },
 *   },
 * ];
 * ```
 *
 * Sprint-13 close: the WARN-phase / `grandfather-allowlist.json`
 * mechanism (introduced Sprint 12 for the v0.5.0-rc.1 rollout) has
 * been DELETED. The plugin now ships with uniform `'error'` severity
 * via `configs.recommended`. The previously-exported `configs.warnPhase`
 * + `grandfatherAllowlist` symbols are removed — consumers pinned to
 * `@blackunicorn/eslint-plugin-edge@0.4.x` who depended on the
 * warn-phase MUST migrate to v0.5.0 with their existing
 * `process.env` reads either:
 *   1. Migrated to `GuardrailEngineConfig.envBindings` injection
 *      (Story 2.1b-edge-core surface) for edge-reachable files, OR
 *   2. Wrapped in `typeof process !== 'undefined' && process.env.X`
 *      guards for Node-only files that retain the bare-read path.
 *
 * @package @blackunicorn/eslint-plugin-edge
 */
import type { ESLint, Linter } from 'eslint';
import { noBareProcessEnvRule } from './no-bare-process-env.js';

/**
 * Plugin object — matches ESLint's flat-config plugin shape.
 */
const plugin: ESLint.Plugin = {
  meta: {
    name: '@blackunicorn/eslint-plugin-edge',
    version: '0.4.0'
  },
  rules: {
    'no-bare-process-env': noBareProcessEnvRule
  },
  configs: {
    /**
     * Recommended config — uniform `'error'` severity.
     * Wire as: `[bonklmEdge.configs.recommended]`.
     */
    recommended: {} as Linter.Config
  }
};

plugin.configs!.recommended = {
  plugins: { 'bonklm-edge': plugin },
  rules: {
    'bonklm-edge/no-bare-process-env': 'error'
  }
} as Linter.Config;

export default plugin;
export { noBareProcessEnvRule };
