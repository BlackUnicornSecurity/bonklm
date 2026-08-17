#!/usr/bin/env node
//
// CycloneDX SBOM generator for a BonkLM publishable package.
//
// Emits a CycloneDX 1.5 JSON BOM describing the SHIPPED production dependency
// closure of the selected package (runtime/optional dependencies plus the
// non-optional peers npm 7+ installs by default; see lib-shipped-closure.mjs).
// Self-contained: no third-party SBOM toolchain is
// added to a supply-chain-hardening change — the BOM is derived from the
// installed package manifests pnpm already resolved.
//
// The output (*.sbom.json) is a build/release artifact, gitignored
// (.gitignore: *.sbom.json) — the generator is the committed, reproducible
// source of truth. A consumer can re-run `pnpm sbom` to reproduce it.
//
// Usage:
//   node scripts/gen-sbom.mjs                 # writes bonklm-core.sbom.json
//   node scripts/gen-sbom.mjs --out path.json # custom path
//   node scripts/gen-sbom.mjs --root tools/example --out example.sbom.json
//   node scripts/gen-sbom.mjs --print         # write summary to stdout too

import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { loadManifest, normalizeLicense, shippedClosure } from './lib-shipped-closure.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SPEC_VERSION = '1.5';

export function parseArgs(argv, repoRoot = REPO_ROOT, { error = console.error, exit = process.exit } = {}) {
  const out = {
    out: join(repoRoot, 'bonklm-core.sbom.json'),
    print: false,
    root: join(repoRoot, 'packages', 'core')
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') out.out = argv[++i];
    else if (a === '--root') out.root = resolve(repoRoot, argv[++i]);
    else if (a === '--print') out.print = true;
    else if (a === '-h' || a === '--help') out.help = true;
    else {
      error(`unknown argument: ${a}`);
      exit(2);
      return null;
    }
  }
  return out;
}

// Package URL (purl) for an npm package, per the purl spec: the scope is the
// namespace (URL-encoded), the bare name is the name.
function purl(name, version) {
  if (name.startsWith('@')) {
    const slash = name.indexOf('/');
    const scope = encodeURIComponent(name.slice(0, slash)); // %40scope
    const bare = encodeURIComponent(name.slice(slash + 1));
    return `pkg:npm/${scope}/${bare}@${version}`;
  }
  return `pkg:npm/${encodeURIComponent(name)}@${version}`;
}

// SPDX license id heuristic — emit `license.id` for a clean SPDX id, an
// `expression` for AND/OR compound expressions, else a free-form `license.name`.
const SPDX_IDS = new Set([
  'MIT',
  'Apache-2.0',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
  'Unlicense',
  'BlueOak-1.0.0',
  'MPL-2.0',
  'CC-BY-4.0',
  'CC0-1.0',
  'Python-2.0',
  'Zlib',
  'AFL-2.1'
]);
function licenseNode(expr) {
  if (!expr || expr === 'Unknown') return undefined;
  const e = String(expr).trim();
  if (/\b(AND|OR)\b/i.test(e) || e.includes('(')) return [{ expression: e }];
  if (SPDX_IDS.has(e)) return [{ license: { id: e } }];
  return [{ license: { name: e } }];
}

function componentHashes(integrity) {
  const match = /^sha512-([A-Za-z0-9+/]+={0,2})$/.exec(integrity ?? '');
  if (!match) return undefined;
  const bytes = Buffer.from(match[1], 'base64');
  if (bytes.length !== 64 || bytes.toString('base64') !== match[1]) return undefined;
  return [{ alg: 'SHA-512', content: bytes.toString('hex') }];
}

function component(info, type, integrities) {
  const c = {
    type,
    'bom-ref': purl(info.name, info.version),
    name: info.name,
    version: info.version,
    purl: purl(info.name, info.version),
    scope: 'required'
  };
  const lic = licenseNode(info.license);
  if (lic) c.licenses = lic;
  const hashes = componentHashes(integrities.get(`${info.name}@${info.version}`));
  if (hashes) c.hashes = hashes;
  return c;
}

export function main(options) {
  const { argv, env, exit, integrities, log, properties, repoRoot, write } = Object.assign(
    {
      argv: process.argv.slice(2),
      env: process.env,
      exit: process.exit,
      integrities: new Map(),
      log: console.log,
      repoRoot: REPO_ROOT,
      write: writeFileSync
    },
    options
  );
  const args = parseArgs(argv, repoRoot, { error: log, exit });
  if (!args) return null;
  if (args.help) {
    log('Usage: node scripts/gen-sbom.mjs [--root package-dir] [--out path.json] [--print]');
    exit(0);
    return null;
  }
  const root = loadManifest(args.root);
  const rootLicense = normalizeLicense(root);
  if (rootLicense === 'Unknown') throw new Error(`SBOM root ${root.name} has no recognized license`);
  const closure = shippedClosure({ roots: [{ name: root.name, dir: args.root }], repoRoot });

  // Exclude the root component itself from the components list.
  const rootKey = `${root.name}@${root.version}`;
  const components = [...closure.values()]
    .filter(i => `${i.name}@${i.version}` !== rootKey)
    .sort((a, b) => (a.name === b.name ? a.version.localeCompare(b.version) : a.name.localeCompare(b.name)))
    .map(i => component(i, 'library', integrities));
  const rootComponent = component(
    { name: root.name, version: root.version, license: rootLicense },
    'library',
    integrities
  );

  // Deterministic serial number derived from the component set (no RNG/clock in
  // the identity), formatted as a valid urn:uuid.
  const digest = createHash('sha256')
    .update(
      JSON.stringify({
        components: [rootComponent, ...components].map(item => ({ hashes: item.hashes ?? [], purl: item.purl })),
        properties: [...(properties ?? [])].sort((left, right) =>
          `${left.name}\0${left.value}`.localeCompare(`${right.name}\0${right.value}`)
        )
      })
    )
    .digest('hex');
  const serial = `urn:uuid:${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20, 32)}`;

  const generator = loadManifest(repoRoot);
  const bom = {
    bomFormat: 'CycloneDX',
    specVersion: SPEC_VERSION,
    serialNumber: serial,
    version: 1,
    metadata: {
      timestamp: env.SOURCE_DATE_EPOCH
        ? new Date(Number(env.SOURCE_DATE_EPOCH) * 1000).toISOString()
        : new Date().toISOString(),
      tools: [{ vendor: 'BlackUnicorn', name: 'bonklm-gen-sbom', version: generator.version }],
      component: rootComponent,
      ...(properties?.length ? { properties } : {})
    },
    components
  };

  write(args.out, `${JSON.stringify(bom, null, 2)}\n`);
  log(`CycloneDX ${SPEC_VERSION} SBOM written: ${args.out}`);
  log(`  root:       ${root.name}@${root.version}`);
  log(`  components: ${components.length} (shipped production closure)`);
  log(`  serial:     ${serial}`);
  if (args.print) {
    const byLic = {};
    for (const c of components) {
      const l = c.licenses
        ? c.licenses[0].expression || c.licenses[0].license.id || c.licenses[0].license.name
        : 'Unknown';
      byLic[l] = (byLic[l] || 0) + 1;
    }
    log('  license mix:', JSON.stringify(byLic));
  }
  return bom;
}

export function runCli({ argv1, scriptPath, run }) {
  if (argv1 !== scriptPath) return false;
  run();
  return true;
}

runCli({
  argv1: process.argv[1],
  scriptPath: fileURLToPath(import.meta.url),
  run: main
});
