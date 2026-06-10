import path from 'node:path';
import os from 'node:os';
import { realpathSync } from 'node:fs';

/**
 * Resolve a path to absolute/canonical form (~ expansion, cwd-relative, symlink).
 * Falls back to path.resolve when the path does not exist (e.g. a file about to be written).
 *
 * @param {string} inputPath
 * @param {string} cwd
 * @returns {string}
 */
export function resolvePath(inputPath, cwd) {
  if (!inputPath) return '';
  let p = inputPath;
  if (p.startsWith('~')) {
    p = path.join(os.homedir(), p.slice(1));
  }
  if (!path.isAbsolute(p)) {
    p = path.join(cwd || process.cwd(), p);
  }
  try {
    return realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

/**
 * Hardened containment: equality OR `startsWith(root + sep)` — never a bare prefix
 * match (so `<root>-evil` is not "within" `<root>`).
 * @param {string} candidate
 * @param {string} root
 * @returns {boolean}
 */
function within(candidate, root) {
  return candidate === root || candidate.startsWith(root + path.sep);
}

/**
 * Is `inputPath` inside the repository root? Checked against both the
 * symlink-resolved and the plain-resolved repo root so symlinked roots and
 * not-yet-existing paths still compare correctly. An empty path is "in repo"
 * (nothing to check → allow).
 *
 * @param {string} inputPath
 * @param {string} cwd - cwd for relative-path resolution.
 * @param {string} projectDir - repository root.
 * @returns {boolean}
 */
export function isPathInRepo(inputPath, cwd, projectDir) {
  if (!inputPath) return true;

  const resolved = resolvePath(inputPath, cwd);

  let repoResolved;
  try {
    repoResolved = realpathSync(projectDir);
  } catch {
    repoResolved = path.resolve(projectDir);
  }
  const repoPlain = path.resolve(projectDir);

  return within(resolved, repoResolved) || within(resolved, repoPlain);
}
