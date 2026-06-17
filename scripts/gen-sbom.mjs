#!/usr/bin/env node
//
// CycloneDX SBOM generator for @blackunicorn/bonklm core.
//
// Emits a CycloneDX 1.5 JSON BOM describing the SHIPPED production dependency
// closure of the core package (the npm-install closure a consumer receives —
// `dependencies`/`optionalDependencies` only, peers excluded; see
// lib-shipped-closure.mjs). Self-contained: no third-party SBOM toolchain is
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
//   node scripts/gen-sbom.mjs --print         # write summary to stdout too

import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadManifest, shippedClosure } from './lib-shipped-closure.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CORE_DIR = join(REPO_ROOT, 'packages', 'core');
const SPEC_VERSION = '1.5';

function parseArgs(argv) {
  const out = { out: join(REPO_ROOT, 'bonklm-core.sbom.json'), print: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') out.out = argv[++i];
    else if (a === '--print') out.print = true;
    else if (a === '-h' || a === '--help') out.help = true;
    else {
      console.error(`unknown argument: ${a}`);
      process.exit(2);
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

function component(info, type = 'library') {
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
  return c;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node scripts/gen-sbom.mjs [--out path.json] [--print]');
    process.exit(0);
  }
  const core = loadManifest(CORE_DIR);
  const closure = shippedClosure({ roots: [{ name: core.name, dir: CORE_DIR }] });

  // Exclude the root component itself from the components list.
  const rootKey = `${core.name}@${core.version}`;
  const components = [...closure.values()]
    .filter(i => `${i.name}@${i.version}` !== rootKey)
    .sort((a, b) => (a.name === b.name ? a.version.localeCompare(b.version) : a.name.localeCompare(b.name)))
    .map(i => component(i));

  // Deterministic serial number derived from the component set (no RNG/clock in
  // the identity), formatted as a valid urn:uuid.
  const digest = createHash('sha256')
    .update(components.map(c => c.purl).join('\n'))
    .digest('hex');
  const serial = `urn:uuid:${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20, 32)}`;

  const generator = loadManifest(REPO_ROOT);
  const bom = {
    bomFormat: 'CycloneDX',
    specVersion: SPEC_VERSION,
    serialNumber: serial,
    version: 1,
    metadata: {
      timestamp: process.env.SOURCE_DATE_EPOCH
        ? new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000).toISOString()
        : new Date().toISOString(),
      tools: [{ vendor: 'BlackUnicornSecurity', name: 'bonklm-gen-sbom', version: generator.version }],
      component: component({ name: core.name, version: core.version, license: core.license || 'Apache-2.0' })
    },
    components
  };

  writeFileSync(args.out, `${JSON.stringify(bom, null, 2)}\n`);
  console.log(`CycloneDX ${SPEC_VERSION} SBOM written: ${args.out}`);
  console.log(`  root:       ${core.name}@${core.version}`);
  console.log(`  components: ${components.length} (shipped production closure)`);
  console.log(`  serial:     ${serial}`);
  if (args.print) {
    const byLic = {};
    for (const c of components) {
      const l = c.licenses
        ? c.licenses[0].expression || c.licenses[0].license.id || c.licenses[0].license.name
        : 'Unknown';
      byLic[l] = (byLic[l] || 0) + 1;
    }
    console.log('  license mix:', JSON.stringify(byLic));
  }
}

main();
