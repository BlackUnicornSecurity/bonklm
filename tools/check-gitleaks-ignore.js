#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HASH = /^# line-sha256:([a-f0-9]{64})$/;
const FINGERPRINT = /^(.+):([^:]+):(\d+)$/;

function sourceLine(root, relative, lineNumber) {
  if (isAbsolute(relative) || relative.split('/').includes('..')) return undefined;
  const file = resolve(root, relative);
  return readFileSync(file, 'utf8').split(/\r?\n/)[lineNumber - 1];
}

export function verifyGitleaksIgnore(root) {
  const findings = [];
  const lines = readFileSync(resolve(root, '.gitleaksignore'), 'utf8').split(/\r?\n/);
  let expectedHash;
  for (const line of lines) {
    const hash = HASH.exec(line);
    if (hash !== null) {
      expectedHash = hash[1];
      continue;
    }
    if (line === '' || (line.startsWith('#') && expectedHash === undefined)) continue;
    const fingerprint = FINGERPRINT.exec(line);
    if (fingerprint === null || expectedHash === undefined) {
      findings.push(`unverified ignore entry: ${line}`);
      expectedHash = undefined;
      continue;
    }
    const current = sourceLine(root, fingerprint[1], Number(fingerprint[3]));
    const actualHash = current === undefined ? undefined : createHash('sha256').update(current).digest('hex');
    if (actualHash !== expectedHash) findings.push(`source line changed: ${line}`);
    expectedHash = undefined;
  }
  if (expectedHash !== undefined) findings.push('orphaned line hash');
  return findings;
}

export function runGitleaksIgnoreCheck(root, output = console) {
  const findings = verifyGitleaksIgnore(root);
  if (findings.length > 0) {
    output.error(findings.join('\n'));
    return 1;
  }
  output.log('Gitleaks ignore integrity: PASS');
  return 0;
}

const here = dirname(fileURLToPath(import.meta.url));
/* istanbul ignore next -- exercised by the workflow and local CLI gate */
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runGitleaksIgnoreCheck(resolve(here, '..'));
}
