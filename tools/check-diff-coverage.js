#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
// Modules that compile to zero executable statements, so istanbul emits no
// coverage entry for them at all: type-only modules, and pure re-export
// barrels. Requiring coverage of a file that cannot have any is a false
// failure. Anything listed here must contain declarations and re-exports only —
// add a statement to one of these files and it belongs off this list.
const NO_STATEMENT_MODULES = new Set([
  'packages/bonklm-server/src/types.ts',
  'packages/fastify-plugin/src/types.ts',
  'packages/core/src/cli/connectors/index.ts',
  'packages/core/src/cli/detection/index.ts'
]);

export function command(commandName, args, options) {
  return execFileSync(commandName, args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options
  });
}

export function parseUnifiedDiff(diff) {
  const changed = new Map();
  let file;
  let line = 0;
  let inHunk = false;
  for (const text of String(diff).split('\n')) {
    if (text.startsWith('diff --git ')) {
      file = undefined;
      inHunk = false;
    } else if (text.startsWith('+++ ')) {
      file = text === '+++ /dev/null' ? undefined : text.slice(6);
      if (file && !changed.has(file)) changed.set(file, new Set());
    } else if (HUNK.test(text)) {
      line = Number(text.match(HUNK)[1]);
      inHunk = true;
    } else if (inHunk && file && text.startsWith('+')) {
      changed.get(file).add(line);
      line += 1;
    } else if (inHunk && !text.startsWith('-') && !text.startsWith('\\')) {
      line += 1;
    }
  }
  return changed;
}

export function isCoveredSource(file) {
  if (
    NO_STATEMENT_MODULES.has(file) ||
    !/\.(?:js|mjs|ts)$/.test(file) ||
    /\.d\.ts$|\.test\.|-test-helpers\.|\/(?:tests|test)\//.test(file)
  ) {
    return false;
  }
  return /^packages\/[^/]+\/src\//.test(file) || /^scripts\//.test(file) || /^tools\//.test(file);
}

function spansChanged(location, lines) {
  for (let line = location.start.line; line <= location.end.line; line += 1) {
    if (lines.has(line)) return true;
  }
  return false;
}

function relativeCoverage(coverage, root) {
  return new Map(
    Object.entries(coverage).map(([file, value]) => [relative(root, resolve(file)).replaceAll('\\', '/'), value])
  );
}

function statementFailures(file, lines, coverage) {
  return Object.entries(coverage.statementMap).flatMap(([id, location]) =>
    spansChanged(location, lines) && coverage.s[id] === 0
      ? [`${file}:${location.start.line} changed statement is not covered`]
      : []
  );
}

function branchFailures(file, lines, coverage) {
  return Object.entries(coverage.branchMap).flatMap(([id, branch]) => {
    const conditionChanged = spansChanged(branch.loc, lines);
    return branch.locations.flatMap((location, index) =>
      (conditionChanged || spansChanged(location, lines)) && coverage.b[id][index] === 0
        ? [`${file}:${location.start.line ?? branch.loc.start.line} changed branch arm ${index + 1} is not covered`]
        : []
    );
  });
}

export function evaluateDiffCoverage({ coverage, changed, root }) {
  const indexed = relativeCoverage(coverage, root);
  const failures = [];
  for (const [file, lines] of changed) {
    if (!isCoveredSource(file)) continue;
    const fileCoverage = indexed.get(file);
    if (!fileCoverage) {
      failures.push(`${file} is changed production code but is absent from coverage`);
      continue;
    }
    failures.push(...statementFailures(file, lines, fileCoverage));
    failures.push(...branchFailures(file, lines, fileCoverage));
  }
  return failures;
}

function addUntracked(changed, root, output) {
  for (const file of output.split('\n').filter(Boolean)) {
    const count = readFileSync(resolve(root, file), 'utf8').split('\n').length;
    changed.set(file, new Set(Array.from({ length: count }, (_, index) => index + 1)));
  }
}

function freshGenesisRange(root, run) {
  try {
    run('git', ['rev-parse', '--verify', 'HEAD^'], { cwd: root });
    return [EMPTY_TREE_SHA, 'HEAD'];
  } catch (error) {
    if ([1, 128].includes(error?.status)) return null;
    throw error;
  }
}

function diffRange(base, root, run) {
  if (!base) return ['HEAD'];
  if (/^0{40}$/.test(base)) return freshGenesisRange(root, run);
  try {
    run('git', ['cat-file', '-e', `${base}^{commit}`], { cwd: root });
  } catch (error) {
    if ([1, 128].includes(error?.status)) return freshGenesisRange(root, run);
    throw error;
  }
  try {
    run('git', ['merge-base', base, 'HEAD'], { cwd: root });
    return [`${base}...HEAD`];
  } catch (error) {
    if (error?.status === 1) return freshGenesisRange(root, run);
    throw error;
  }
}

export function main({ root, base, coveragePath, run, log }) {
  const coverage = JSON.parse(readFileSync(resolve(root, coveragePath), 'utf8'));
  const range = diffRange(base, root, run);
  if (range === null) {
    log('Diff coverage PASS (fresh public genesis; repository coverage thresholds enforced)');
    return true;
  }
  const changed = parseUnifiedDiff(run('git', ['diff', '--unified=0', '--no-color', ...range, '--'], { cwd: root }));
  if (!base) {
    addUntracked(changed, root, run('git', ['ls-files', '--others', '--exclude-standard'], { cwd: root }));
  }
  const failures = evaluateDiffCoverage({ coverage, changed, root });
  if (failures.length > 0) throw new Error(`Diff coverage is below 100%:\n${failures.join('\n')}`);
  log(`Diff coverage PASS (${[...changed.keys()].filter(isCoveredSource).length} changed source files)`);
  return true;
}

export function runCli({ argv1, scriptPath, run, exit }) {
  if (argv1 !== scriptPath) return false;
  try {
    run();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    exit(1);
  }
  return true;
}

export function createRunner(options) {
  return () => main(options);
}

runCli({
  argv1: process.argv[1],
  scriptPath: fileURLToPath(import.meta.url),
  run: createRunner({
    root: process.cwd(),
    base: process.env.DIFF_COVERAGE_BASE,
    coveragePath: 'coverage/coverage-final.json',
    run: command,
    log: console.log
  }),
  exit: process.exit
});
