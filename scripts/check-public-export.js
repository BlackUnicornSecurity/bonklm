#!/usr/bin/env node
// Public-safe exact-tree gate used by the exported GitHub Release workflow.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  decodedTextValues,
  hasArchiveMagic,
  hasUnsafePathCharacter,
  isNestedArchivePath,
  parseRestrictedTerms,
  scanPublicTextValue,
  scanRestrictedTermValue
} from './check-release-tarballs.js';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(SCRIPT_PATH), '..');
const PUBLIC_ROOTS = new Set([
  '.babelrc',
  '.changeset',
  '.dockerignore',
  '.edition-boundary.yaml',
  '.gitattributes',
  '.github',
  '.gitignore',
  '.gitleaks.toml',
  '.gitleaksignore',
  '.markdownlint-cli2.yaml',
  '.npmignore',
  '.nvmrc',
  '.pre-commit-config.yaml',
  '.prettierignore',
  '.prettierrc.cjs',
  'CHANGELOG.md',
  'CODE_OF_CONDUCT.md',
  'CONTRIBUTING.md',
  'LICENSE',
  'LICENSE-BUSL-1.1.txt',
  'LICENSING.md',
  'NOTICE',
  'PRIVACY.md',
  'README.md',
  'RELEASE-NOTES.md',
  'SECURITY.md',
  'assets',
  'docs',
  'eslint.config.mjs',
  'package.json',
  'packages',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'reference',
  'scripts',
  'tools',
  'tsconfig.json',
  'typedoc.json',
  'vitest.config.ts',
  'vitest.pack.config.ts'
]);
const defectMarker = String.raw`(?<![A-Z]-)\b${'D'}-\d{3}\b`;
const auditMarker = [
  String.raw`audit[- ]${'closure'}`,
  ['pre-publish', 'audit'].join(' '),
  ['audit', 'remediation'].join(' ')
].join('|');
const scannerVariable = ['GITLEAKS', 'VERSION'].join('_');
const reviewMarker = [
  String.raw`\b(?:${'SME'}|internal)\s+review\b`,
  String.raw`\bStory\s+\d+(?:\.\d+)*\s+audit\b`
].join('|');
const PUBLIC_DISCLOSURE = [
  new RegExp(defectMarker),
  new RegExp(String.raw`\b(?:${auditMarker})\b`, 'i'),
  new RegExp(String.raw`\b${'sec'}\s+v\d+#\d+\b`, 'i'),
  new RegExp(String.raw`\b${scannerVariable}\b|${'gitleaks'}\s+v?\d+\.\d+`, 'i'),
  new RegExp(String.raw`\b(?:${'SEC'}|${'DEV'})-\d{3}\b`),
  new RegExp(reviewMarker, 'i')
];
const PUBLIC_GENERIC_FIXTURES = new Map([
  ['packages/express-middleware/tests/middleware.test.ts', ['private-network-address']],
  ['packages/logger/tests/integration/performance.spec.ts', ['private-network-address']],
  ['packages/logger/tests/unit/transform.spec.ts', ['private-network-address']]
]);
const REVIEWED_BINARY_SHA256 = new Map([
  ['assets/logo-with-text.jpg', 'a4a48492129b9e6059b7a9c51c11a350725dd9f3b39ec26331c7c4b3ce4dc25e'],
  ['assets/logo.jpg', '348baee538b2e02984299e7b9f618f2c691495af52da4feab1eb1e604f7a5d10'],
  ['docs/assets/blog-index.png', '59326fd2e01b48d83c61b6f7024561db21e23cc7d9a55a7cbf01453c4eedccd4'],
  ['docs/assets/blog-post-seatbelt.png', '1c44b45a52a9011c416d19b05846405485034b4f69c5899d8d45bd3edef304cf'],
  ['docs/assets/connector-elizaos.png', '515f95ebddf686e69c3ed4ac8d58b80534992015620a12d4aea4eeb849c1f3ac'],
  ['docs/assets/connectors-index.png', '8d0e2a81fc2461079625a8cdc7dda6a0e3a6f8ce9dda363bc168cb3f77f55b96'],
  ['docs/assets/demo-elizaos.png', '1ad2017969e3d2a47b3bff93d9f4cb27649ea10f7a243285f4c24d486b09c2db'],
  ['docs/assets/docs-index.png', '066e2ac9fc8a4fb55055e376a5c6dfa0fee8c940eb275fbc01f59bb24fd1ae4d'],
  ['docs/assets/docs-validators.png', 'dab316fbc543eae3ae1c37313e27d615ebb39cfee0db8c2dc45f9670edfa9a69']
]);
const OPAQUE_BINARY = /\.(?:avi|gif|jpe?g|mov|mp4|node|otf|pdf|png|ttf|wasm|webp|woff2?)$/i;

export function rejectPublicDisclosureMarkers(text) {
  if (PUBLIC_DISCLOSURE.some(pattern => pattern.test(text))) {
    throw new Error('Public export contains a prohibited public disclosure marker');
  }
  return true;
}

export function validatePublicPath(path) {
  if (typeof path !== 'string' || hasUnsafePathCharacter(path)) {
    throw new Error('Public export contains an unsafe path');
  }
  const [root, child] = path.split('/');
  if (!PUBLIC_ROOTS.has(root)) throw new Error(`Public export contains an unapproved root: ${root}`);
  if (path === '.github/workflows/oss-export-gate.yml') {
    throw new Error('Public export contains a canonical-only workflow');
  }
  if (root === 'tools' && child && path.includes('/') && !path.startsWith('tools/eslint-plugin-bonklm-edge/')) {
    if (path.split('/').length > 2) throw new Error(`Public export contains an unapproved tools subtree: ${child}`);
  }
  return true;
}

function validatePackageLicenses(repoRoot, paths) {
  const roots = new Set(
    paths
      .filter(path => path.startsWith('packages/'))
      .map(path => path.split('/')[1])
      .filter(name => name && name !== 'examples')
  );
  for (const root of roots) {
    const manifestPath = `packages/${root}/package.json`;
    if (!paths.includes(manifestPath)) throw new Error(`Public package manifest is missing: ${manifestPath}`);
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(join(repoRoot, manifestPath), 'utf8'));
    } catch (error) {
      throw new Error(`Public package manifest is invalid: ${manifestPath}`, { cause: error });
    }
    if (manifest.license !== 'Apache-2.0') throw new Error(`Public export contains a non-Apache package: ${root}`);
  }
}

export function checkPublicExport(repoRoot, paths, restrictedTerms) {
  if (!Array.isArray(paths) || paths.length === 0) throw new Error('Public export tracked-file list is empty');
  validatePackageLicenses(repoRoot, paths);
  for (const path of paths) {
    validatePublicPath(path);
    rejectPublicDisclosureMarkers(path);
    scanPublicTextValue(path, restrictedTerms);
    const absolute = join(repoRoot, path);
    if (lstatSync(absolute).isSymbolicLink()) throw new Error(`Public export contains a symbolic link: ${path}`);
    if (isNestedArchivePath(path)) throw new Error('Public export contains a nested archive');
    const bytes = readFileSync(absolute);
    if (hasArchiveMagic(bytes)) throw new Error('Public export contains a nested archive');
    scanRestrictedTermValue(bytes, restrictedTerms);
    for (const text of decodedTextValues(bytes)) {
      rejectPublicDisclosureMarkers(text);
      scanPublicTextValue(text, [], PUBLIC_GENERIC_FIXTURES.get(path));
    }
    if (OPAQUE_BINARY.test(path)) {
      const expected = REVIEWED_BINARY_SHA256.get(path);
      const actual = createHash('sha256').update(bytes).digest('hex');
      if (!expected || actual !== expected) throw new Error('Public export contains an unreviewed binary asset');
    }
  }
  return paths.length;
}

export function runCli({ argv1, scriptPath, repoRoot, restrictedValue, list, log, logError, setExitCode }) {
  if (argv1 !== scriptPath) return false;
  try {
    const restricted = parseRestrictedTerms(restrictedValue, true);
    const paths = list(repoRoot);
    const count = checkPublicExport(repoRoot, paths, restricted);
    log(`check-public-export: PASS — ${count} tracked file(s) match the public allowlist and deny policy`);
  } catch (error) {
    logError('check-public-export: FAIL — public export validation failed');
    setExitCode(1);
  }
  return true;
}

export function trackedFiles(repoRoot) {
  return execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8' }).split('\0').filter(Boolean);
}

export function setProcessExitCode(code) {
  process.exitCode = code;
}

runCli({
  argv1: process.argv[1],
  scriptPath: SCRIPT_PATH,
  repoRoot: REPO_ROOT,
  restrictedValue: process.env.BONKLM_RESTRICTED_TERMS,
  list: trackedFiles,
  log: console.log,
  logError: console.error,
  setExitCode: setProcessExitCode
});
