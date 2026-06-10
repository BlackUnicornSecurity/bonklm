import { gatherText, getCommand } from '../input.js';

/**
 * Supply-chain guard — blocks installs of known typosquat / suspicious package
 * names. Wired to the Skill matcher; it inspects any install-like command found
 * in the invocation. Allow-by-default; the denylist below is a small, synthetic
 * illustrative set of well-known typosquats (no incident specifics).
 *
 * Posture: HARD BLOCK on a denylisted package in an install command.
 */

const SUSPECT_PACKAGES = new Set([
  'crossenv', 'cross-env.js', 'babelcli', 'd3.js', 'fabric-js', 'ffmepg',
  'gruntcli', 'http-proxy.js', 'jquery.js', 'mariadb-js', 'mongose', 'mssql.js',
  'mssql-node', 'mysqljs', 'nodefabric', 'node-fabric', 'nodeffmpeg',
  'node-opensl', 'node-opencv', 'opencv.js', 'openssl.js', 'sqlite.js',
  'sqliter', 'sqlserver', 'shadcn-ui', 'discordjs.js',
]);

const INSTALL_RE = /\b(?:npm|pnpm|yarn|npx)\s+(?:install|add|i)\b([^\n;|&]*)/gi;

/**
 * @param {string} text
 * @returns {string|null} the suspect package name, or null.
 */
export function findSuspectInstall(text) {
  if (!text) return null;
  for (const match of text.matchAll(INSTALL_RE)) {
    const args = match[1] || '';
    for (const token of args.split(/\s+/)) {
      if (!token || token.startsWith('-')) continue;
      // Strip a trailing @version; keep scope (@scope/pkg) intact.
      const name = token.replace(/(?<=.)@[^/@]*$/, '').toLowerCase();
      if (SUSPECT_PACKAGES.has(name)) return name;
    }
  }
  return null;
}

/**
 * @param {object} input - parsed hook input
 * @returns {object|null}
 */
export function validateSupplyChain(input) {
  const text = getCommand(input) || gatherText(input);
  const suspect = findSuspectInstall(text);
  if (!suspect) return null;
  return {
    block: true,
    title: 'SUPPLY-CHAIN RISK BLOCKED',
    reason: `Install of a known typosquat / suspicious package ('${suspect}').`,
    target: suspect,
    recommendations: [
      'Verify the exact package name against the official registry.',
      'Typosquatting is a common supply-chain attack vector.',
    ],
  };
}
