#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { classifyReleaseScope } from './release-scope.js';
import { parseSemver } from './semver.js';

const SCOPE_PATTERN = /^Release-Scope: (.+)$/gm;

export function command(commandName, args, options) {
  return execFileSync(commandName, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options });
}

export function parseReleaseScope(body) {
  const matches = [...String(body ?? '').matchAll(SCOPE_PATTERN)].map(match => match[1]);
  if (matches.length !== 1) throw new Error('Published Release must contain exactly one Release-Scope marker');
  return classifyReleaseScope(matches[0]).scope;
}

function resolveTagSha(run, tag) {
  run('git', ['fetch', '--force', 'origin', `refs/tags/${tag}:refs/tags/${tag}`], {});
  run('git', ['fetch', '--no-tags', 'origin', 'main'], {});
  const sha = run('git', ['rev-list', '-n', '1', tag], {}).trim();
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`Release tag ${tag} did not resolve to a commit`);
  run('git', ['merge-base', '--is-ancestor', sha, 'origin/main'], {});
  return sha;
}

function assertReleaseFields(release, expected, resolvedSha) {
  const scope = parseReleaseScope(release?.body);
  if (
    release?.tag_name !== expected.tag ||
    release?.draft !== false ||
    release?.prerelease !== expected.prerelease ||
    typeof release?.published_at !== 'string' ||
    release.published_at.length === 0 ||
    scope !== expected.scope ||
    resolvedSha !== expected.sha
  ) {
    throw new Error('Published Release identity mismatch');
  }
  return resolvedSha;
}

export function validateRelease({ release, expected, run }) {
  return assertReleaseFields(release, expected, resolveTagSha(run, expected.tag));
}

function fetchRelease(run, repository, suffix) {
  return JSON.parse(run('gh', ['api', `repos/${repository}/releases/${suffix}`], {}));
}

export function resolvePublishedRelease({ repository, scope, tag, run }) {
  const { prefix } = classifyReleaseScope(scope);
  const parsed = tag.startsWith(prefix) ? parseSemver(tag.slice(prefix.length)) : null;
  if (parsed === null) throw new Error(`Release tag ${tag} does not contain valid SemVer`);
  const release = fetchRelease(run, repository, `tags/${tag}`);
  const sha = resolveTagSha(run, tag);
  assertReleaseFields(release, { prerelease: parsed.prerelease !== null, scope, sha, tag }, sha);
  return { sha, tag };
}

function missingPackage(error) {
  const detail = `${error?.stderr ?? ''}\n${error?.message ?? ''}`;
  return error?.status === 1 && /\bHTTP\s+404\b|404 Not Found/i.test(detail);
}

export function assertPackageVisibility({ owner, packageName, expected, allowMissing, run }) {
  let value;
  try {
    value = JSON.parse(run('gh', ['api', `orgs/${owner}/packages/container/${packageName}`], {}));
  } catch (error) {
    if (allowMissing && missingPackage(error)) return null;
    throw error;
  }
  if (value?.visibility !== expected) {
    throw new Error(`${packageName} visibility must be ${expected}`);
  }
  return value.visibility;
}

function containerTags(version) {
  const tags = version?.metadata?.container?.tags;
  if (!Array.isArray(tags) || !tags.every(tag => typeof tag === 'string')) {
    throw new Error('GHCR package versions response is malformed');
  }
  return tags;
}

export function assertNoMutableContainerTags({ owner, packageName, run }) {
  const pages = JSON.parse(
    run(
      'gh',
      ['api', '--paginate', '--slurp', `orgs/${owner}/packages/container/${packageName}/versions?per_page=100`],
      {}
    )
  );
  if (!Array.isArray(pages) || !pages.every(Array.isArray)) {
    throw new Error('GHCR package versions response is malformed');
  }
  const mutableTags = pages
    .flat()
    .flatMap(containerTags)
    .filter(tag => tag === 'latest' || tag === 'next');
  if (mutableTags.length > 0) {
    throw new Error(`Remove unsupported mutable GHCR tags before release: ${[...new Set(mutableTags)].join(', ')}`);
  }
  return true;
}

export function ghcrBootstrap({ owner, publicPackage, stagingPackage, run }) {
  const publicVisibility = assertPackageVisibility({
    owner,
    packageName: publicPackage,
    expected: 'public',
    allowMissing: true,
    run
  });
  assertPackageVisibility({
    owner,
    packageName: stagingPackage,
    expected: 'private',
    allowMissing: true,
    run
  });
  if (publicVisibility !== null) {
    assertNoMutableContainerTags({ owner, packageName: publicPackage, run });
  }
  return publicVisibility === null;
}

function requiredEnv(env, name) {
  const value = env[name];
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${name} is required`);
  return value;
}

export function main({ argv, env, run, log }) {
  const [action, owner, packageName, visibility, option, extra] = argv;
  if (action === 'classify-body' && owner !== undefined && packageName === undefined) {
    const classification = classifyReleaseScope(parseReleaseScope(owner));
    const result = `${classification.scope}\t${classification.kind}\t${classification.prefix}`;
    log(result);
    return result;
  }
  if (action === 'revalidate' && owner === undefined) {
    const repository = requiredEnv(env, 'GITHUB_REPOSITORY');
    const release = fetchRelease(run, repository, requiredEnv(env, 'RELEASE_ID'));
    const sha = validateRelease({
      release,
      expected: {
        prerelease: requiredEnv(env, 'RELEASE_PRERELEASE') === 'true',
        scope: requiredEnv(env, 'RELEASE_SCOPE'),
        sha: requiredEnv(env, 'RELEASE_SHA'),
        tag: requiredEnv(env, 'RELEASE_TAG')
      },
      run
    });
    log(sha);
    return sha;
  }
  if (action === 'resolve-published' && owner && packageName && visibility && option === undefined) {
    const result = resolvePublishedRelease({ repository: owner, scope: packageName, tag: visibility, run });
    log(result.sha);
    return result;
  }
  if (
    action === 'assert-package' &&
    owner &&
    packageName &&
    ['private', 'public'].includes(visibility) &&
    [undefined, 'allow-missing'].includes(option) &&
    extra === undefined
  ) {
    const result = assertPackageVisibility({
      owner,
      packageName,
      expected: visibility,
      allowMissing: option === 'allow-missing',
      run
    });
    log(result ?? 'missing');
    return result;
  }
  if (action === 'assert-no-mutable-tags' && owner && packageName && visibility === undefined) {
    const result = assertNoMutableContainerTags({ owner, packageName, run });
    log(String(result));
    return result;
  }
  if (action === 'ghcr-bootstrap' && owner && packageName && visibility && option === undefined) {
    const result = ghcrBootstrap({ owner, publicPackage: packageName, stagingPackage: visibility, run });
    log(String(result));
    return result;
  }
  throw new Error(
    'Usage: release-state.js classify-body <release-body> | revalidate | resolve-published <repository> <scope> <tag> | assert-package <owner> <package> <private|public> [allow-missing] | assert-no-mutable-tags <owner> <package> | ghcr-bootstrap <owner> <public-package> <staging-package>'
  );
}

export function runCli({ argv1, scriptPath, run, exit }) {
  if (argv1 !== scriptPath) return false;
  try {
    run();
  } catch {
    console.error('release-state: release state command failed');
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
  run: createRunner({ argv: process.argv.slice(2), env: process.env, run: command, log: console.log }),
  exit: process.exit
});
