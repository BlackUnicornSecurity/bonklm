import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Resolve the repository root for a hook invocation.
 *
 * Order of preference:
 *   1. $CLAUDE_PROJECT_DIR (set by Claude Code when it spawns the hook).
 *   2. Walk up from `cwdHint` (or process.cwd()) until a directory containing
 *      `.claude/settings.json` is found.
 *   3. Fall back to `cwdHint` / process.cwd().
 *
 * Pure except for env + fs reads; deterministic for a given filesystem.
 *
 * @param {string} [cwdHint] - Starting directory (e.g. the hook payload's `cwd`).
 * @returns {string} Absolute repository root (best effort).
 */
export function resolveProjectDir(cwdHint) {
  const fromEnv = process.env.CLAUDE_PROJECT_DIR;
  if (fromEnv) {
    return fromEnv;
  }

  let dir = cwdHint || process.cwd();
  for (let i = 0; i < 12; i += 1) {
    if (existsSync(path.join(dir, '.claude', 'settings.json'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return cwdHint || process.cwd();
}
