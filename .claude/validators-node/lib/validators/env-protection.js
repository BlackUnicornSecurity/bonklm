import path from 'node:path';
import { getFilePath } from '../input.js';
import { isExampleFile } from '../example-content.js';

/**
 * Environment / credential file guard — blocks Write/Edit to sensitive files
 * (`.env`, private keys, `.npmrc`, ssh/aws/k8s/docker credential files, ...).
 *
 * Posture: HARD BLOCK by filename pattern (location-independent). `*.example`,
 * `*.template`, `*.sample` and the like are allowed so documentation/templates
 * are not blocked. Globs compile to anchored, linear regexes (no backtracking).
 */

const PROTECTED_PATTERNS = [
  '.env',
  '.env.*',
  '*.env',
  '.envrc',
  'credentials.*',
  'secrets.*',
  '*credentials*',
  '*secrets*',
  '*.pem',
  '*.key',
  '*.p12',
  '*.pfx',
  '*.jks',
  '*.keystore',
  'id_rsa',
  'id_rsa.*',
  'id_ed25519',
  'id_ed25519.*',
  'id_dsa',
  'id_ecdsa',
  'known_hosts',
  'authorized_keys',
  'ssh_config',
  'sshd_config',
  'aws_credentials',
  'kubeconfig',
  '*.gpg',
  '.htpasswd',
  '.netrc',
  '.pgpass',
  '.npmrc',
  '.pypirc',
];

const SENSITIVE_KEYWORDS = ['secret', 'cred', 'key', 'token', 'auth', 'pass', 'private'];

/**
 * Convert a simple glob (*, ?, **) to an anchored, case-insensitive RegExp.
 * @param {string} pattern
 * @returns {RegExp}
 */
function globToRegex(pattern) {
  const body = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '{{GLOBSTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/\{\{GLOBSTAR\}\}/g, '.*');
  return new RegExp(`^${body}$`, 'i');
}

// Compile each glob once at module load (these run on every Write/Edit hook).
const PROTECTED_REGEXES = PROTECTED_PATTERNS.map((pattern) => [pattern, globToRegex(pattern)]);

/**
 * @param {string} filePath
 * @returns {string|null} reason if protected, else null.
 */
export function protectedReason(filePath) {
  if (!filePath) return null;
  if (isExampleFile(filePath)) return null;

  const lower = filePath.toLowerCase();
  const base = path.basename(lower);

  for (const [pattern, regex] of PROTECTED_REGEXES) {
    if (regex.test(lower) || regex.test(base)) {
      return `matches protected pattern '${pattern}'`;
    }
  }

  if (base.startsWith('.')) {
    for (const keyword of SENSITIVE_KEYWORDS) {
      if (base.includes(keyword)) {
        return `hidden file containing sensitive keyword '${keyword}'`;
      }
    }
  }
  return null;
}

/**
 * @param {object} input - parsed hook input
 * @returns {object|null}
 */
export function validateEnvProtection(input) {
  const filePath = getFilePath(input);
  if (!filePath) return null;

  const reason = protectedReason(filePath);
  if (!reason) return null;

  return {
    block: true,
    title: 'PROTECTED CREDENTIAL FILE',
    reason: `Refusing to write a sensitive file (${reason}).`,
    target: filePath,
    recommendations: [
      'Document configuration in a *.example / *.template file instead.',
      'Keep real credentials out of the working tree (use a secret manager / env vars).',
    ],
  };
}
