import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Global kill-switch for the local-harness validators.
 *
 * Returns true (validators should no-op / fail open) when EITHER:
 *   - the env var BONKLM_VALIDATORS_DISABLED is set to a truthy value
 *     (anything except unset / "" / "0" / "false"), OR
 *   - the sentinel file `<projectDir>/.claude/validators-node/state/DISABLED`
 *     exists. `state/` is gitignored, so the sentinel never ships.
 *
 * This is the documented lockout escape hatch: if an active validator ever
 * blocks legitimate work, create the sentinel (or export the env var and restart
 * the session) to disable every hook at once.
 *
 * @param {string} projectDir - Repository root (from resolveProjectDir()).
 * @returns {boolean}
 */
export function isDisabled(projectDir) {
  const flag = process.env.BONKLM_VALIDATORS_DISABLED;
  if (flag && flag !== '0' && flag.toLowerCase() !== 'false') {
    return true;
  }
  try {
    return existsSync(path.join(projectDir, '.claude', 'validators-node', 'state', 'DISABLED'));
  } catch {
    return false;
  }
}
