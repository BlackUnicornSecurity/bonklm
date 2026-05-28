#!/usr/bin/env node
/**
 * Pre-publish surface guard (D-010 defense-in-depth)
 * ==================================================
 * Verifies the BUILT core package (`@blackunicorn/bonklm`) actually exposes a
 * canary set of canonical public exports at its runtime entry
 * (`packages/core/dist/index.js`).
 *
 * Why: `dist/` is gitignored, so a stale or incomplete build can ship a
 * published surface missing exports present at HEAD source. D-010 shipped rc.4
 * tarballs whose published surface was missing the B.5 re-exports
 * (`createRateLimiter`, `CommonRateLimiters`), surfacing only after publish. The
 * rc-cut RUNBOOK + the publish CI job both run `pnpm -r build` first (which
 * fixes stale dist); this guard is the fail-loud assertion that the rebuild
 * actually produced the expected surface.
 *
 * Why runtime-only: the same `tsc` run emits both `index.js` and `index.d.ts`,
 * so a fresh runtime surface implies a fresh type surface — this catches the
 * D-010 stale-dist root cause without re-implementing type resolution. (A
 * literal `.d.ts` text scan is unreliable: `export * from` re-exports do not
 * list member names.) Exhaustive TYPE-surface checking is the tsd `test:types`
 * job's role; this is a small, fast runtime smoke for the publish path.
 *
 * Run AFTER `pnpm -r build`, BEFORE any `npm pack` / `changeset publish`.
 * Exit 1 if any canary export is missing.
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RUNTIME_ENTRY = resolve(REPO_ROOT, 'packages/core/dist/index.js');

/**
 * Canonical public exports of `@blackunicorn/bonklm`. Frozen v1.0-RC symbols;
 * includes the B.5 re-exports (`createRateLimiter`, `CommonRateLimiters`) whose
 * omission was D-010. Keep this list small and stable — a smoke canary, not an
 * exhaustive surface lock. If you intentionally rename or remove one of these
 * symbols, update this list in the same change — the gate blocks publish until
 * the list matches the built surface.
 */
const CANARY_EXPORTS = [
  'GuardrailEngine',
  'PromptInjectionValidator',
  'cachedValidate',
  'InMemoryLRUCache',
  'createRateLimiter',
  'CommonRateLimiters',
  'Severity',
  'RiskLevel'
];

let coreModule;
try {
  coreModule = await import(pathToFileURL(RUNTIME_ENTRY).href);
} catch (err) {
  console.error(`[verify-publish-surface] FAILED to import ${RUNTIME_ENTRY}`);
  console.error(`  ${err instanceof Error ? err.message : String(err)}`);
  console.error('  Did you run `pnpm -r build` first? (dist/ is gitignored.)');
  process.exit(1);
}

const missing = CANARY_EXPORTS.filter(name => !(name in coreModule));

if (missing.length > 0) {
  console.error('[verify-publish-surface] FAIL — published core surface is missing canonical exports:');
  console.error(`  ${missing.join(', ')}`);
  console.error('  Likely a stale build (run `pnpm -r build`) or a dropped re-export in packages/core/src/index.ts.');
  process.exit(1);
}

console.log(`[verify-publish-surface] OK — all ${CANARY_EXPORTS.length} canary exports present in ${RUNTIME_ENTRY}.`);
