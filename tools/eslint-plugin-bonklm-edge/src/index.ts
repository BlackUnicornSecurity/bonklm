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
 * Iter-2/3 rollout (BonkLM internal):
 *   - **v0.5.0-rc.1 / Sprint 12**: severity = `'warn'` for files in the
 *     `tools/eslint-plugin-bonklm-edge/grandfather-allowlist.json`
 *     allowlist; `'error'` for all other files. Allowlist documents
 *     legacy violations existing at Sprint 12 day 1.
 *   - **v0.5.0 final / Sprint 13**: allowlist file DELETED; severity
 *     uniformly `'error'`. Any surviving violation BLOCKs CI.
 *
 * Configs exported:
 *   - `recommended` — uniform `'error'`. Use for new code / external
 *     consumers / post-Sprint-13.
 *   - `warnPhase` — split severity: `'warn'` for grandfathered legacy
 *     files (loaded from `grandfather-allowlist.json`), `'error'`
 *     everywhere else. Use for the Sprint-12 → Sprint-13 rotation.
 *
 * External consumers: pin to `@blackunicorn/bonklm@^0.5.0-rc.1` to
 * opt into the WARN-phase tracking (lets you migrate before the
 * ERROR escalation in v0.5.0 final).
 *
 * @package @blackunicorn/eslint-plugin-edge
 */
import type { ESLint, Linter } from 'eslint';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';
import { noBareProcessEnvRule } from './no-bare-process-env.js';

/**
 * Load the grandfather-allowlist JSON at plugin construction.
 * The allowlist lives at the package root (one level above dist/src).
 * Missing file = post-Sprint-13 state → empty allowlist (uniform error).
 *
 * Reads at construction time (synchronous) so the `configs.warnPhase`
 * array is fully populated for ESLint's flat-config resolver.
 */
function loadGrandfatherAllowlist(): {
  files: string[];
  sprint13DeadlineUtc: string | null;
} {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // dist/index.js → ../grandfather-allowlist.json (package root).
    const allowlistPath = resolvePath(here, '..', 'grandfather-allowlist.json');
    if (!existsSync(allowlistPath)) {
      return { files: [], sprint13DeadlineUtc: null };
    }
    const raw = readFileSync(allowlistPath, 'utf-8');
    const parsed = JSON.parse(raw) as {
      files?: unknown;
      sprint13DeadlineUtc?: unknown;
    };
    const files = Array.isArray(parsed.files)
      ? parsed.files.filter((f): f is string => typeof f === 'string')
      : [];
    const sprint13DeadlineUtc =
      typeof parsed.sprint13DeadlineUtc === 'string' ? parsed.sprint13DeadlineUtc : null;
    return { files, sprint13DeadlineUtc };
  } catch {
    // Defensive: malformed JSON or fs error → empty allowlist
    // (fail closed to uniform 'error', NEVER fail open).
    return { files: [], sprint13DeadlineUtc: null };
  }
}

const { files: grandfatherFiles, sprint13DeadlineUtc } = loadGrandfatherAllowlist();

/**
 * Emit a one-shot warning if the Sprint-13 deletion deadline has
 * passed but the allowlist file still exists. Self-attestation
 * collapses under deadline pressure; this turns it into a console
 * signal at plugin-load time so it's seen on every CI run.
 */
if (sprint13DeadlineUtc !== null && grandfatherFiles.length > 0) {
  const deadline = new Date(sprint13DeadlineUtc);
  if (!Number.isNaN(deadline.getTime()) && new Date() > deadline) {
    // eslint-disable-next-line no-console
    console.warn(
      `[@blackunicorn/eslint-plugin-edge] grandfather-allowlist.json deletion ` +
        `deadline ${sprint13DeadlineUtc} has passed but ${grandfatherFiles.length} ` +
        `entries remain. Delete tools/eslint-plugin-bonklm-edge/grandfather-allowlist.json ` +
        `and flip warnPhase consumers to recommended.`
    );
  }
}

/**
 * Plugin object — matches ESLint's flat-config plugin shape.
 */
const plugin: ESLint.Plugin = {
  meta: {
    name: '@blackunicorn/eslint-plugin-edge',
    version: '0.4.0',
  },
  rules: {
    'no-bare-process-env': noBareProcessEnvRule,
  },
  configs: {
    /**
     * Recommended config — uniform `'error'`. Use for new code, for
     * external consumers, and for the post-Sprint-13 final state.
     */
    recommended: {} as Linter.Config,
    /**
     * WARN-phase config — split severity. Grandfathered legacy files
     * get `'warn'`; everything else `'error'`. Returned as a flat-config
     * array (`Linter.Config[]`) so ESLint resolves the per-file override
     * cleanly. Sprint 13 deletes the allowlist → this config collapses
     * to uniform error automatically.
     */
    warnPhase: [] as unknown as Linter.Config,
  },
};

// Populate configs now that `plugin` is constructed (avoids the
// chicken-and-egg of self-referencing inside the literal).
plugin.configs!.recommended = {
  plugins: { 'bonklm-edge': plugin },
  rules: {
    'bonklm-edge/no-bare-process-env': 'error',
  },
} as Linter.Config;

// warnPhase is an array of config blocks. Block order matters:
// later blocks override earlier ones in flat-config semantics.
// 1) Default: every file → error.
// 2) Override: allowlisted files → warn.
const warnPhaseBlocks: Linter.Config[] = [
  {
    plugins: { 'bonklm-edge': plugin },
    rules: {
      'bonklm-edge/no-bare-process-env': 'error',
    },
  },
];
if (grandfatherFiles.length > 0) {
  warnPhaseBlocks.push({
    plugins: { 'bonklm-edge': plugin },
    files: grandfatherFiles,
    rules: {
      'bonklm-edge/no-bare-process-env': 'warn',
    },
  });
}
plugin.configs!.warnPhase = warnPhaseBlocks as unknown as Linter.Config;

export default plugin;
export { noBareProcessEnvRule };
/**
 * Exposed for tests + tooling that need to introspect the live
 * allowlist (e.g. CI deadline-enforcement scripts).
 */
export const grandfatherAllowlist = {
  files: grandfatherFiles,
  sprint13DeadlineUtc,
};
