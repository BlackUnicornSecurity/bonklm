import path from 'node:path';
import os from 'node:os';
import { getFilePath } from '../input.js';
import { resolvePath, isPathInRepo } from '../paths.js';

/**
 * Outside-repository write guard — blocks Write/Edit whose target resolves to a
 * sensitive location OUTSIDE the repository (SSH/AWS/GPG dirs, shell rc files,
 * /etc, package/registry config, ...). This is the location dimension that
 * complements env-protection (filename patterns) and bash-safety (commands).
 *
 * Posture: HARD BLOCK on a sensitive external write. Writes elsewhere outside the
 * repo (e.g. /tmp, a sibling worktree) are allowed — the developer legitimately
 * uses them. Read / Glob / Grep / Bash are not file modifications and pass through.
 */

const MODIFYING_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

const SENSITIVE_HOME_DIRS = ['.ssh', '.aws', '.gnupg', '.kube', '.docker'];
const SENSITIVE_HOME_NESTED = [['.config', 'gcloud'], ['.config', 'azure']];
const SENSITIVE_SYSTEM_DIRS = ['/etc', '/usr', '/bin', '/sbin', '/boot', '/sys', '/private/etc'];
const SENSITIVE_HOME_FILES = new Set([
  '.npmrc', '.gitconfig', '.bashrc', '.zshrc', '.bash_profile', '.profile',
  '.zprofile', '.netrc', '.pgpass', '.gnupg',
]);

function sensitivePrefixes() {
  const home = os.homedir();
  return [
    ...SENSITIVE_HOME_DIRS.map((d) => path.join(home, d)),
    ...SENSITIVE_HOME_NESTED.map((parts) => path.join(home, ...parts)),
    ...SENSITIVE_SYSTEM_DIRS,
  ];
}

/**
 * Case-fold a path on case-insensitive filesystems (macOS/Windows) so `/etc` and
 * `/ETC`, `~/.ssh` and `~/.SSH` compare equal — otherwise a case-variant path is a
 * trivial bypass. Identity on case-sensitive platforms.
 * @param {string} value
 * @param {string} [platform=process.platform]
 * @returns {string}
 */
export function caseFold(value, platform = process.platform) {
  return platform === 'darwin' || platform === 'win32' ? value.toLowerCase() : value;
}

/**
 * @param {string} filePath
 * @param {string} cwd
 * @param {string} projectDir
 * @returns {string|null} reason if a sensitive external write, else null.
 */
export function sensitiveExternalReason(filePath, cwd, projectDir) {
  if (!filePath) return null;
  if (isPathInRepo(filePath, cwd, projectDir)) return null;

  // filePath is non-empty here, so resolvePath always returns a non-empty path.
  const resolved = resolvePath(filePath, cwd);
  const foldedResolved = caseFold(resolved);

  for (const prefix of sensitivePrefixes()) {
    const foldedPrefix = caseFold(prefix);
    if (foldedResolved === foldedPrefix || foldedResolved.startsWith(foldedPrefix + path.sep)) {
      return `sensitive location (${prefix})`;
    }
  }

  if (
    caseFold(path.dirname(resolved)) === caseFold(os.homedir()) &&
    SENSITIVE_HOME_FILES.has(caseFold(path.basename(resolved)))
  ) {
    return `sensitive home file (${path.basename(resolved)})`;
  }
  return null;
}

/**
 * @param {object} input - parsed hook input
 * @param {{projectDir:string}} ctx
 * @returns {object|null}
 */
export function validateOutsideRepo(input, ctx) {
  if (input.toolName && !MODIFYING_TOOLS.has(input.toolName)) return null;

  const filePath = getFilePath(input);
  if (!filePath) return null;

  const cwd = input.cwd || ctx.projectDir;
  const reason = sensitiveExternalReason(filePath, cwd, ctx.projectDir);
  if (!reason) return null;

  return {
    block: true,
    title: 'WRITE OUTSIDE REPOSITORY BLOCKED',
    reason: `Refusing to modify a ${reason} outside the project.`,
    target: filePath,
    recommendations: [
      'Keep file modifications inside the repository (or a temp directory).',
      'Edit system / credential files yourself, not through the agent.',
    ],
  };
}
