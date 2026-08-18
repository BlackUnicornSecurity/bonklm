#!/usr/bin/env node
// Public-safe surface gate for the exact tarballs retained by release preflight.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const AUTOMATIC_NPM_FILE =
  /^(?:package\.json|readme(?:\..*)?|licen[cs]e(?:\..*)?|changelog(?:\..*)?|history(?:\..*)?|notice(?:\..*)?)$/i;
const PUBLIC_TEXT_DENY = [
  {
    name: 'private-network-address',
    pattern:
      /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})\b/
  },
  {
    name: 'operator-home-path',
    pattern:
      /(?:\/Users\/|\/home\/)(?!(?:user|users|username|example|examples|foo|bar|baz|qux|test|tests|admin|ubuntu|daytona|node|root|guest|you|me|name|someone|alice|bob|dev|sandbox|app|home)(?![a-z0-9._-]))[a-z0-9][a-z0-9._-]*/i
  },
  { name: 'internal-team-path', pattern: /\bteam\/(?!uat\/)[a-z][\w.-]*/i },
  { name: 'agent-memory-path', pattern: /~\/\.claude|-Users-[a-z]/i },
  { name: 'scan-finding-count', pattern: /\b\d[\d,]*\s+(?:TRUE|FALSE)\s+POSITIVE/ },
  { name: 'scanner-version', pattern: /gitleaks\s+v?\d+\.\d+/i }
];
const APPROVED_LICENSE_SHA256 = new Map([
  ['Apache-2.0', 'f344e15a8f88b14ed338f66328b61878a5ec09543759c3c918f4dc1bb104cf00'],
  ['MIT', 'd751f5014958417ffd1704437fd165b905a5706278a1d6ce976f6f027f47f63f']
]);
const FORBIDDEN_DEPENDENCY_TREE = [
  /(?:^|\/)node_modules(?:\/|$)/i,
  /(?:^|\/)(?:npm-shrinkwrap\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$/i
];
const UNSAFE_PATH_PUNCTUATION = /[<>:"|?*[\]{}!]/u;
const WINDOWS_RESERVED_SEGMENT = /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\..*)?$/i;
const NESTED_ARCHIVE = /\.(?:7z|bz2|gz|jar|rar|tar|tgz|war|xz|zip|zst)$/i;
const OPAQUE_BINARY = /\.(?:avi|gif|jpe?g|mov|mp4|node|otf|pdf|png|ttf|wasm|webp|woff2?)$/i;

export function hasUnsafePathCharacter(value) {
  for (const character of value) {
    const code = character.codePointAt(0);
    if (
      code <= 0x1f ||
      (code >= 0x7f && code <= 0x9f) ||
      code === 0x061c ||
      (code >= 0x200b && code <= 0x200f) ||
      (code >= 0x2028 && code <= 0x202e) ||
      (code >= 0x2060 && code <= 0x2069) ||
      code === 0xfeff
    ) {
      return true;
    }
  }
  return false;
}

export function parseRestrictedTerms(value, required) {
  const terms = String(value ?? '')
    .split(/\r?\n/)
    .map(term => term.trim().toLowerCase().replace(/\s+/g, ' '))
    .filter(Boolean);
  if (required && terms.length === 0) throw new Error('Private deny policy is required for release preflight');
  if (terms.some(term => term.length > 128) || terms.length > 1000) throw new Error('Private deny policy is invalid');
  return terms;
}

export function scanPublicTextValue(text, restrictedTerms = [], ignoredGenericRules = []) {
  const ignored = new Set(ignoredGenericRules);
  const finding = PUBLIC_TEXT_DENY.find(rule => !ignored.has(rule.name) && rule.pattern.test(text));
  if (finding) throw new Error(`Tarball text matched ${finding.name}`);
  scanRestrictedTermValue(text, restrictedTerms);
}

export function scanRestrictedTermValue(text, restrictedTerms = []) {
  const matches = decodedTextValues(text).some(value => {
    const normalized = value.toLowerCase().replace(/\s+/g, ' ');
    return restrictedTerms.some(term => normalized.includes(term));
  });
  if (matches) {
    throw new Error('Tarball text matched restricted-internal-term');
  }
}

export function decodedTextValues(value) {
  if (!Buffer.isBuffer(value)) return [String(value)];
  const values = [value.toString('utf8')];
  for (const offset of [0, 1]) {
    const available = value.length - offset;
    const length = available - (available % 2);
    if (length < 2) continue;
    const bytes = value.subarray(offset, offset + length);
    values.push(bytes.toString('utf16le'), Buffer.from(bytes).swap16().toString('utf16le'));
  }
  return values;
}

export function hasArchiveMagic(bytes) {
  if (!Buffer.isBuffer(bytes)) return false;
  const prefix = bytes.subarray(0, 8).toString('hex');
  const embeddedSignatures = [
    '504b0304',
    '504b0506',
    '504b0708',
    '526172211a0700',
    '526172211a070100',
    '377abcaf271c',
    'fd377a585a00',
    '28b52ffd'
  ].map(value => Buffer.from(value, 'hex'));
  return (
    /^(?:1f8b|425a68)/.test(prefix) ||
    embeddedSignatures.some(signature => bytes.indexOf(signature) >= 0) ||
    hasValidTarHeader(bytes)
  );
}

function hasValidTarHeader(bytes) {
  if (bytes.length < 512 || !bytes.subarray(0, 100).some(byte => byte !== 0)) return false;
  const storedText = bytes.subarray(148, 156).toString('ascii').replace(/\0.*$/, '').trim();
  if (!/^[0-7]{1,7}$/.test(storedText)) return false;
  let actual = 0;
  for (let index = 0; index < 512; index += 1) {
    actual += index >= 148 && index < 156 ? 0x20 : bytes[index];
  }
  return Number.parseInt(storedText, 8) === actual;
}

export function isNestedArchivePath(path) {
  return NESTED_ARCHIVE.test(path);
}

function safeRelativePath(path) {
  return (
    typeof path === 'string' &&
    path.length > 0 &&
    path.normalize('NFC') === path &&
    !path.startsWith('/') &&
    !path.includes('\\') &&
    !hasUnsafePathCharacter(path) &&
    !UNSAFE_PATH_PUNCTUATION.test(path) &&
    path
      .split('/')
      .every(
        segment =>
          segment !== '' &&
          segment !== '.' &&
          segment !== '..' &&
          !segment.endsWith('.') &&
          !segment.endsWith(' ') &&
          !WINDOWS_RESERVED_SEGMENT.test(segment)
      )
  );
}

export function validateTarballEntries(manifest, entries) {
  if (
    typeof manifest?.name !== 'string' ||
    typeof manifest?.version !== 'string' ||
    !Array.isArray(manifest.files) ||
    manifest.files.length === 0 ||
    manifest.files.some(path => !safeRelativePath(path))
  ) {
    throw new Error('Tarball package manifest is missing a safe explicit files allowlist');
  }
  const normalized = entries.map(entry => (entry.endsWith('/') ? entry.slice(0, -1) : entry));
  const seen = new Set();
  for (const entry of normalized) {
    const folded = entry.toLowerCase();
    if ((entry !== 'package' && (!safeRelativePath(entry) || !entry.startsWith('package/'))) || seen.has(folded)) {
      throw new Error(`Tarball path is unsafe: ${entry}`);
    }
    seen.add(folded);
  }
  const files = entries.filter(entry => !entry.endsWith('/'));
  if (normalized.some(entry => FORBIDDEN_DEPENDENCY_TREE.some(pattern => pattern.test(entry)))) {
    throw new Error('Tarball contains an embedded dependency tree or lockfile');
  }
  if (files.some(isNestedArchivePath)) throw new Error('Tarball contains a nested archive');
  if (files.some(entry => OPAQUE_BINARY.test(entry))) throw new Error('Tarball contains an unreviewed opaque binary');
  if (!files.includes('package/package.json')) throw new Error('Tarball is missing package/package.json');
  if (!files.some(entry => /^package\/readme(?:\..*)?$/i.test(entry))) throw new Error('Tarball is missing README');
  if (!files.some(entry => /^package\/licen[cs]e(?:\..*)?$/i.test(entry)))
    throw new Error('Tarball is missing LICENSE');
  for (const entry of files) {
    const relative = entry.slice('package/'.length);
    const allowlisted =
      AUTOMATIC_NPM_FILE.test(relative) ||
      manifest.files.some(path => relative === path || relative.startsWith(`${path}/`));
    if (!allowlisted) throw new Error(`Tarball file is not allowlisted by package.json: ${entry}`);
  }
  if (!files.some(entry => entry.endsWith('.js'))) throw new Error('Tarball contains no compiled JavaScript');
}

export function validateShippedLicense(manifest, root) {
  const file = readdirSync(join(root, 'package')).find(entry => /^licen[cs]e(?:\..*)?$/i.test(entry));
  if (!file || typeof manifest.license !== 'string') throw new Error('Tarball license metadata is incomplete');
  const text = readFileSync(join(root, 'package', file), 'utf8');
  const expected = APPROVED_LICENSE_SHA256.get(manifest.license);
  const actual = createHash('sha256').update(text).digest('hex');
  if (actual !== expected) throw new Error(`Tarball LICENSE does not match package.json license ${manifest.license}`);
}

export function rejectSpecialFiles(root) {
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    const stats = lstatSync(path);
    if (stats.isSymbolicLink()) throw new Error(`Tarball extracted a symbolic link: ${path}`);
    if (stats.isDirectory()) rejectSpecialFiles(path);
    else if (!stats.isFile()) throw new Error(`Tarball extracted a non-regular file: ${path}`);
  }
}

function scanPublicText(root, restrictedTerms, scanRoot = root) {
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    const stats = lstatSync(path);
    if (stats.isDirectory()) {
      scanPublicText(path, restrictedTerms, scanRoot);
      continue;
    }
    const bytes = readFileSync(path);
    try {
      if (hasArchiveMagic(bytes)) throw new Error('Tarball contains a nested archive');
      scanRestrictedTermValue(bytes, restrictedTerms);
      for (const text of decodedTextValues(bytes)) scanPublicTextValue(text);
    } catch (error) {
      throw new Error(`${relative(scanRoot, path)}: ${error.message}`, { cause: error });
    }
  }
}

export function checkReleaseTarballs(directory, restrictedTerms = []) {
  const resolved = resolve(directory);
  if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
    throw new Error('Supplied tarball directory does not exist');
  }
  const tarballs = readdirSync(resolved)
    .filter(file => file.endsWith('.tgz'))
    .sort();
  if (tarballs.length === 0) throw new Error('Supplied tarball directory is empty');
  const temporary = mkdtempSync(join(tmpdir(), 'bonklm-release-surface-'));
  try {
    for (const tarball of tarballs) {
      const source = join(resolved, tarball);
      const entries = execFileSync('tar', ['-tzf', source], { encoding: 'utf8' }).split('\n').filter(Boolean);
      const manifest = JSON.parse(execFileSync('tar', ['-xOf', source, 'package/package.json'], { encoding: 'utf8' }));
      validateTarballEntries(manifest, entries);
      for (const entry of entries) {
        scanPublicTextValue(entry.endsWith('/') ? entry.slice(0, -1) : entry, restrictedTerms);
      }
      const types = execFileSync('tar', ['-tvzf', source], { encoding: 'utf8' })
        .split('\n')
        .filter(Boolean)
        .map(line => line[0]);
      if (types.some(type => type !== '-' && type !== 'd')) {
        throw new Error('Tarball contains a link or special file');
      }
      const target = join(temporary, basename(tarball, '.tgz'));
      mkdirSync(target);
      execFileSync('tar', ['-xzf', source, '-C', target]);
      rejectSpecialFiles(target);
      validateShippedLicense(manifest, target);
      try {
        scanPublicText(target, restrictedTerms);
      } catch (error) {
        throw new Error(`${tarball}: ${error.message}`, { cause: error });
      }
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
  return tarballs.length;
}

export function publishableDirectories(repoRoot) {
  const collect = (area, predicate) => {
    const base = join(repoRoot, area);
    if (!existsSync(base)) return [];
    return readdirSync(base)
      .map(name => join(base, name))
      .filter(path => existsSync(join(path, 'package.json')))
      .filter(path => predicate(JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'))));
  };
  return [
    ...collect('packages', manifest => manifest.private !== true),
    ...collect('tools', manifest => manifest.private !== true && manifest.workspacePolicy === 'tier-b-publishable')
  ];
}

export function checkWorkspaceTarballs(repoRoot, restrictedTerms = [], run = execFileSync) {
  const temporary = mkdtempSync(join(tmpdir(), 'bonklm-workspace-tarballs-'));
  try {
    for (const packageDir of publishableDirectories(repoRoot)) {
      run('npm', ['pack', packageDir, '--pack-destination', temporary, '--ignore-scripts'], {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
      });
    }
    return checkReleaseTarballs(temporary, restrictedTerms);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

export function runCli({
  argv1,
  scriptPath,
  directory,
  workspace = false,
  repoRoot,
  restrictedValue,
  requireRestricted = false,
  log,
  logError,
  setExitCode,
  check = checkReleaseTarballs,
  checkWorkspace = checkWorkspaceTarballs
}) {
  if (argv1 !== scriptPath) return false;
  try {
    const restrictedTerms = parseRestrictedTerms(restrictedValue, requireRestricted);
    if (!directory && !workspace) throw new Error('BONKLM_TARBALL_DIR is required unless --workspace is used');
    const count = workspace ? checkWorkspace(repoRoot, restrictedTerms) : check(directory, restrictedTerms);
    log(`check-release-tarballs: PASS — ${count} exact tarball(s) match their public files allowlists`);
  } catch (error) {
    logError('check-release-tarballs: FAIL — exact tarball validation failed');
    setExitCode(1);
  }
  return true;
}

export function setProcessExitCode(code) {
  process.exitCode = code;
}

runCli({
  argv1: process.argv[1],
  scriptPath: SCRIPT_PATH,
  directory: process.env.BONKLM_TARBALL_DIR,
  workspace: process.argv[2] === '--workspace',
  repoRoot: resolve(dirname(SCRIPT_PATH), '..'),
  restrictedValue: process.env.BONKLM_RESTRICTED_TERMS,
  requireRestricted: process.env.BONKLM_REQUIRE_RESTRICTED_TERMS === 'true',
  log: console.log,
  logError: console.error,
  setExitCode: setProcessExitCode
});
