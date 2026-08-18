//
// Shared primitive: compute BonkLM's SHIPPED production dependency closure.
//
// "Shipped" = the default npm 7+ install surface for a BonkLM package: runtime
// dependencies, optional dependencies, and non-optional peer dependencies.
// Optional peers and dev dependencies stay outside this closure because npm
// does not install them for a clean consumer by default. This common closure
// feeds the advisory gate, license audit, and CycloneDX SBOM generator.
//
// The walk reads each package's installed package.json through Node's own module
// resolution (createRequire), so it follows pnpm's symlinked store correctly and
// never re-implements semver resolution.

import { createRequire } from 'node:module';
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export function loadManifest(dir) {
  return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
}

// Normalize the many historical shapes of the package.json license field to a
// single SPDX-ish string, or 'Unknown'.
export function normalizeLicense(pj) {
  if (typeof pj.license === 'string') return pj.license;
  if (pj.license && typeof pj.license === 'object' && pj.license.type) return pj.license.type;
  if (Array.isArray(pj.licenses) && pj.licenses.length) {
    return (
      pj.licenses
        .map(l => (typeof l === 'string' ? l : l.type))
        .filter(Boolean)
        .join(' OR ') || 'Unknown'
    );
  }
  return 'Unknown';
}

// Resolve a dependency's package.json path from a parent directory context.
// Falls back to resolving the package entry and walking up to its package.json
// (needed for packages whose `exports` map omits `./package.json`).
export function resolvePkgJson(name, fromDir) {
  const req = createRequire(join(fromDir, 'noop.js'));
  try {
    return req.resolve(`${name}/package.json`);
  } catch {
    /* fall through */
  }
  let searchDir = resolve(fromDir);
  while (true) {
    const directManifest = join(searchDir, 'node_modules', ...name.split('/'), 'package.json');
    if (existsSync(directManifest)) return realpathSync(directManifest);
    const parent = dirname(searchDir);
    if (parent === searchDir) break;
    searchDir = parent;
  }
  try {
    let p = req.resolve(name);
    while (p && p !== dirname(p)) {
      p = dirname(p);
      const pj = join(p, 'package.json');
      if (existsSync(pj)) {
        try {
          const parsed = JSON.parse(readFileSync(pj, 'utf8'));
          if (parsed.name === name) return pj;
        } catch {
          /* keep walking */
        }
      }
    }
  } catch {
    /* unresolved (e.g. platform-specific optional dep not installed) */
  }
  return null;
}

function manifestsUnder(repoRoot, area) {
  const base = join(repoRoot, area);
  if (!existsSync(base)) return [];
  return readdirSync(base)
    .map(name => join(base, name))
    .filter(dir => existsSync(join(dir, 'package.json')))
    .map(dir => ({ dir, manifest: loadManifest(dir) }));
}

// All publishable workspace packages, including explicitly opted-in Tier-B tools.
export function publishableRoots(repoRoot) {
  const family = manifestsUnder(repoRoot, 'packages').filter(item => item.manifest.private !== true);
  const tierB = manifestsUnder(repoRoot, 'tools').filter(
    item => item.manifest.private !== true && item.manifest.workspacePolicy === 'tier-b-publishable'
  );
  return [...family, ...tierB].map(item => ({ name: item.manifest.name, dir: item.dir }));
}

export function selectPublishableRoots(repoRoot, paths) {
  const available = publishableRoots(repoRoot);
  if (!paths?.length) return available;
  const byDirectory = new Map(available.map(root => [resolve(root.dir), root]));
  return paths.map(path => {
    const selected = byDirectory.get(resolve(repoRoot, path));
    if (!selected) throw new Error(`Release root is not publishable: ${path}`);
    return selected;
  });
}

function installEdges(manifest, fromDir, direct) {
  const edge = (name, optional) => ({ name, fromDir, direct, optional });
  const requiredPeers = Object.keys(manifest.peerDependencies || {}).filter(
    name => manifest.peerDependenciesMeta?.[name]?.optional !== true
  );
  return [
    ...Object.keys(manifest.dependencies || {}).map(name => edge(name, false)),
    ...Object.keys(manifest.optionalDependencies || {}).map(name => edge(name, true)),
    ...requiredPeers.map(name => edge(name, false))
  ];
}

// Compute the shipped closure.
//   opts.roots    — [{ name, dir }] to seed from (default: all publishable pkgs)
//   opts.repoRoot — repo root (used when roots omitted)
// Returns Map<"name@version", { name, version, license, dir, direct, viaWorkspace }>.
export function shippedClosure({ roots, repoRoot }) {
  const seedRoots = roots || publishableRoots(repoRoot);
  const workspaceDirectories = new Set(
    (repoRoot
      ? [...manifestsUnder(repoRoot, 'packages'), ...manifestsUnder(repoRoot, 'tools')].map(item => item.dir)
      : seedRoots.map(root => root.dir)
    ).map(directory => realpathSync(resolve(directory)))
  );
  const seen = new Map();
  const queue = [];

  for (const r of seedRoots) {
    const m = loadManifest(r.dir);
    queue.push(...installEdges(m, r.dir, true));
  }

  while (queue.length) {
    const { name, fromDir, direct, optional } = queue.shift();
    const pjPath = resolvePkgJson(name, fromDir);
    if (!pjPath) {
      if (optional) continue;
      throw new Error(`Required dependency ${name} could not be resolved from ${fromDir}`);
    }
    let pj;
    try {
      pj = JSON.parse(readFileSync(pjPath, 'utf8'));
    } catch (error) {
      throw new Error(`Dependency manifest for ${name} is malformed: ${pjPath}`, { cause: error });
    }
    const key = `${pj.name}@${pj.version}`;
    if (seen.has(key)) continue;
    const isWorkspace = workspaceDirectories.has(realpathSync(resolve(dirname(pjPath))));
    seen.set(key, {
      name: pj.name,
      version: pj.version,
      license: normalizeLicense(pj),
      dir: dirname(pjPath),
      direct: !!direct,
      viaWorkspace: isWorkspace
    });
    queue.push(...installEdges(pj, dirname(pjPath), false));
  }
  return seen;
}
