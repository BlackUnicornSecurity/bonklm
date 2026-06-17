//
// Shared primitive: compute BonkLM's SHIPPED production dependency closure.
//
// "Shipped" = what a consumer actually installs when they `npm install` a
// BonkLM package: the transitive closure reached by following ONLY
// `dependencies` (+ `optionalDependencies`) edges, starting from the publishable
// packages' own `dependencies`. peerDependencies and devDependencies are
// excluded by construction — they are never in a BonkLM tarball's closure
// (peers are consumer-supplied, dev never ships). This is the honest scope for
// the supply-chain advisory gate, the license audit, and the CycloneDX SBOM
// generator. See docs/contributing/adr/0008-supply-chain-posture.md.
//
// The walk reads each package's installed package.json through Node's own module
// resolution (createRequire), so it follows pnpm's symlinked store correctly and
// never re-implements semver resolution.

import { createRequire } from 'node:module';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

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

// All publishable (non-private) workspace packages: [{ name, dir }].
export function publishableRoots(repoRoot) {
  const out = [];
  const pkgsDir = join(repoRoot, 'packages');
  for (const d of readdirSync(pkgsDir)) {
    const pj = join(pkgsDir, d, 'package.json');
    if (!existsSync(pj)) continue;
    const p = JSON.parse(readFileSync(pj, 'utf8'));
    if (p.private) continue;
    out.push({ name: p.name, dir: join(pkgsDir, d) });
  }
  return out;
}

// Compute the shipped closure.
//   opts.roots    — [{ name, dir }] to seed from (default: all publishable pkgs)
//   opts.repoRoot — repo root (used when roots omitted)
// Returns Map<"name@version", { name, version, license, dir, direct, viaWorkspace }>.
export function shippedClosure({ roots, repoRoot }) {
  const seedRoots = roots || publishableRoots(repoRoot);
  const seen = new Map();
  const queue = [];

  for (const r of seedRoots) {
    const m = loadManifest(r.dir);
    // Seed from BOTH dependencies and optionalDependencies: npm installs a
    // package's optionalDependencies by default, so a publishable package's own
    // optional dep ships in its install closure exactly like a regular dependency.
    // The transitive walk below already follows both; the seed must match it or a
    // top-level optional dep would be silently omitted from the closure.
    for (const dep of Object.keys({ ...(m.dependencies || {}), ...(m.optionalDependencies || {}) })) {
      queue.push({ name: dep, fromDir: r.dir, direct: true });
    }
  }

  while (queue.length) {
    const { name, fromDir, direct } = queue.shift();
    const pjPath = resolvePkgJson(name, fromDir);
    if (!pjPath) continue; // optional/platform dep absent — not shipped on this host
    let pj;
    try {
      pj = JSON.parse(readFileSync(pjPath, 'utf8'));
    } catch {
      continue;
    }
    const key = `${pj.name}@${pj.version}`;
    if (seen.has(key)) continue;
    const isWorkspace = (pj.name || '').startsWith('@blackunicorn/');
    seen.set(key, {
      name: pj.name,
      version: pj.version,
      license: normalizeLicense(pj),
      dir: dirname(pjPath),
      direct: !!direct,
      viaWorkspace: isWorkspace
    });
    const next = { ...(pj.dependencies || {}), ...(pj.optionalDependencies || {}) };
    for (const d of Object.keys(next)) queue.push({ name: d, fromDir: dirname(pjPath), direct: false });
  }
  return seen;
}
