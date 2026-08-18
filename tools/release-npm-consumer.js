import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { main as generateSbom } from '../scripts/gen-sbom.mjs';
import { classifyLicense, rootLicenseFindings } from '../scripts/license-audit.mjs';
import { loadManifest, shippedClosure } from '../scripts/lib-shipped-closure.mjs';
import { embeddedManifest, verifyBundle } from './release-npm-bundle.js';

const NPM_REGISTRY = 'https://registry.npmjs.org';
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NODE_BUILTINS = new Set([...builtinModules, ...builtinModules.map(name => `node:${name}`)]);

function consumerManifest(dir, packages) {
  return {
    name: 'bonklm-release-consumer-preflight',
    private: true,
    type: 'module',
    dependencies: Object.fromEntries(packages.map(pkg => [pkg.name, `file:${join(dir, pkg.file)}`]))
  };
}

function smokeSource(bundleDir, packages) {
  const attempts = packages.map(pkg => {
    const manifest = embeddedManifest(join(bundleDir, pkg.file));
    const optionalPeers = Object.keys(manifest.peerDependencies ?? {}).filter(
      name => manifest.peerDependenciesMeta?.[name]?.optional === true
    );
    return { name: pkg.name, optionalPeers };
  });
  return `for (const item of ${JSON.stringify(attempts)}) {
  try { await import(item.name); }
  catch (error) {
    const missing = error?.code === 'ERR_MODULE_NOT_FOUND'
      ? String(error.message).match(/^Cannot find package '([^']+)'/)?.[1]
      : undefined;
    if (!missing || !item.optionalPeers.includes(missing)) throw error;
  }
}\n`;
}

export function rootImportablePackages(_bundleDir, packages) {
  return packages;
}

function installedRoots(consumerDir, packages) {
  return packages.map(pkg => ({ name: pkg.name, dir: join(consumerDir, 'node_modules', ...pkg.name.split('/')) }));
}

export function packageEntrypointFiles(manifest) {
  const files = new Set();
  const collect = value => {
    if (typeof value === 'string') {
      files.add(value.startsWith('./') || value.startsWith('../') || isAbsolute(value) ? value : `./${value}`);
    } else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === 'object') Object.values(value).forEach(collect);
  };
  [manifest.main, manifest.module, manifest.types, manifest.bin, manifest.exports].forEach(collect);
  return [...files].sort();
}

function moduleReferences(path, packageType) {
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
  if (source.parseDiagnostics.length > 0) throw new Error('Clean consumer package contains invalid source syntax');
  const specifiers = [];
  const isDeclaration = path.endsWith('.d.ts');
  const isEsm = path.endsWith('.mjs') || (!path.endsWith('.cjs') && packageType === 'module');
  const staticString = node => {
    if (ts.isStringLiteralLike(node)) return node.text;
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = staticString(node.left);
      const right = staticString(node.right);
      return left === null || right === null ? null : left + right;
    }
    return null;
  };
  const visit = node => {
    const declaration =
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
        ? node.moduleSpecifier.text
        : null;
    const importCall =
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      (node.arguments.length === 1 || node.arguments.length === 2);
    const requireCall =
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'require' &&
      node.arguments.length === 1;
    const call = importCall || requireCall ? node : null;
    const argument = call?.arguments[0];
    const callSpecifier = argument ? staticString(argument) : null;
    if (call && callSpecifier === null)
      throw new Error('Clean consumer package has an unverifiable dynamic module specifier');
    const importType =
      ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) ? staticString(node.argument.literal) : null;
    const specifier = declaration ?? callSpecifier ?? importType;
    const mode =
      isDeclaration || importType !== null
        ? 'types'
        : declaration || call?.expression.kind === ts.SyntaxKind.ImportKeyword
          ? 'esm'
          : isEsm
            ? 'invalid'
            : 'cjs';
    if (specifier) specifiers.push({ specifier, mode });
    ts.forEachChild(node, visit);
  };
  visit(source);
  return specifiers;
}

function validateBareSpecifier(specifier, manifest) {
  if (NODE_BUILTINS.has(specifier)) return;
  if (specifier === manifest.name) return;
  if (specifier.startsWith(`${manifest.name}/`)) {
    const subpath = `.${specifier.slice(manifest.name.length)}`;
    if (
      !manifest.exports ||
      Array.isArray(manifest.exports) ||
      typeof manifest.exports !== 'object' ||
      !Object.hasOwn(manifest.exports, subpath)
    ) {
      throw new Error('Clean consumer package has an unexported self import');
    }
    return;
  }
  const segments = specifier.split('/');
  const packageName = specifier.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0];
  const declared = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {})
  ]);
  if (!declared.has(packageName)) throw new Error('Clean consumer package has an undeclared package import');
}

function resolveRelativeModule(from, specifier, mode) {
  const base = resolve(dirname(from), specifier);
  const candidates =
    mode === 'esm'
      ? [base]
      : mode === 'types'
        ? [base, `${base}.d.ts`, join(base, 'index.d.ts')]
        : mode === 'cjs'
          ? [
              base,
              ...['.js', '.json', '.node'].map(extension => `${base}${extension}`),
              ...['index.js', 'index.json', 'index.node'].map(file => join(base, file))
            ]
          : [];
  return candidates.find(path => existsSync(path) && lstatSync(path).isFile());
}

function validateRelativeModuleGraph(entrypoint, packageDir, manifest, run, visited = new Set()) {
  if (visited.has(entrypoint) || !/\.(?:c|m)?js$|\.d\.ts$/.test(entrypoint)) return;
  visited.add(entrypoint);
  if (/\.(?:c|m)?js$/.test(entrypoint)) run(process.execPath, ['--check', entrypoint], { cwd: packageDir });
  for (const { specifier, mode } of moduleReferences(entrypoint, manifest.type)) {
    if (!specifier.startsWith('.')) {
      validateBareSpecifier(specifier, manifest);
      continue;
    }
    const dependency = resolveRelativeModule(entrypoint, specifier, mode);
    if (!dependency || relative(packageDir, dependency).startsWith('..')) {
      throw new Error('Clean consumer package has an incomplete relative module graph');
    }
    validateRelativeModuleGraph(dependency, packageDir, manifest, run, visited);
  }
}

export function validateInstalledEntrypoints(roots, run) {
  for (const root of roots) {
    const manifest = loadManifest(root.dir);
    const files = packageEntrypointFiles(manifest);
    if (files.length === 0) throw new Error(`Clean consumer package has no entrypoint: ${root.name}`);
    for (const file of files) {
      const path = resolve(root.dir, file);
      const rel = relative(root.dir, path);
      if (rel.startsWith('..') || !existsSync(path) || !lstatSync(path).isFile()) {
        throw new Error(`Clean consumer package has an invalid entrypoint: ${root.name}`);
      }
      validateRelativeModuleGraph(path, root.dir, manifest, run);
    }
  }
}

export function cleanConsumerLicenseReport(roots) {
  const closure = shippedClosure({ roots });
  const flagged = rootLicenseFindings(roots);
  for (const info of closure.values()) {
    const verdict = classifyLicense(info.license);
    if (verdict !== 'ok') flagged.push({ ...info, verdict });
  }
  if (flagged.length > 0) throw new Error('Clean consumer install contains a non-permissive or unknown license');
  return [...closure.values()]
    .map(({ name, version, license }) => ({ name, version, license }))
    .sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`));
}

export function cleanConsumerIntegrities(consumerDir, manifest) {
  let lock;
  try {
    lock = JSON.parse(readFileSync(join(consumerDir, 'package-lock.json'), 'utf8'));
  } catch (error) {
    throw new Error('Clean consumer package lock is missing or invalid', { cause: error });
  }
  if (!lock?.packages || Array.isArray(lock.packages) || typeof lock.packages !== 'object') {
    throw new Error('Clean consumer package lock is missing or invalid');
  }
  const integrities = new Map(manifest.packages.map(pkg => [`${pkg.name}@${pkg.version}`, pkg.integrity]));
  for (const [path, item] of Object.entries(lock.packages)) {
    const segments = path.split('/');
    const marker = segments.lastIndexOf('node_modules');
    const pathName = segments[marker + 1];
    const scopedName =
      pathName?.startsWith('@') && segments[marker + 2] ? `${pathName}/${segments[marker + 2]}` : undefined;
    const name = item?.name ?? (pathName?.startsWith('@') ? scopedName : pathName);
    if (!name || !item?.version || item.integrity === undefined) continue;
    const encoded = /^sha512-([A-Za-z0-9+/]+={0,2})$/.exec(item.integrity)?.[1];
    const decoded = encoded ? Buffer.from(encoded, 'base64') : null;
    if (!decoded || decoded.length !== 64 || decoded.toString('base64') !== encoded) {
      throw new Error('Clean consumer package lock contains an invalid integrity');
    }
    const key = `${name}@${item.version}`;
    if (integrities.has(key) && integrities.get(key) !== item.integrity) {
      throw new Error('Clean consumer package lock contains conflicting integrities');
    }
    integrities.set(key, item.integrity);
  }
  return integrities;
}

export function attachConsumerIntegrities(components, integrities) {
  return components.map(component => {
    const integrity = integrities.get(`${component.name}@${component.version}`);
    if (!integrity) throw new Error('Clean consumer dependency integrity is missing');
    return { ...component, integrity };
  });
}

function writeConsumerEvidence({ consumerDir, evidenceDir, manifest, roots }) {
  mkdirSync(evidenceDir, { recursive: true });
  const integrities = cleanConsumerIntegrities(consumerDir, manifest);
  const components = attachConsumerIntegrities(cleanConsumerLicenseReport(roots), integrities);
  writeFileSync(
    join(evidenceDir, 'clean-consumer-inventory.json'),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        sourceSha: manifest.sourceSha,
        packages: manifest.packages.map(({ name, version, integrity }) => ({ name, version, integrity })),
        components
      },
      null,
      2
    )}\n`
  );
  for (let index = 0; index < roots.length; index += 1) {
    const root = roots[index];
    const pkg = manifest.packages[index];
    const filename = root.name.replace(/[^a-z0-9.-]+/gi, '-').replace(/^-+|-+$/g, '');
    generateSbom({
      argv: ['--root', root.dir, '--out', join(evidenceDir, `${filename}.sbom.json`)],
      env: process.env,
      log: () => {},
      properties: [
        { name: 'bonklm:release:source-sha', value: manifest.sourceSha },
        { name: 'bonklm:npm:integrity', value: pkg.integrity }
      ],
      integrities,
      repoRoot: REPO_ROOT
    });
  }
}

export function preflightConsumerBundle({ dir, evidenceDir, run, trusted }) {
  const bundleDir = resolve(dir);
  const manifest = verifyBundle(bundleDir, trusted);
  if (!evidenceDir) throw new Error('Clean consumer evidence directory is required');
  const consumerDir = mkdtempSync(join(tmpdir(), 'bonklm-npm-consumer-'));
  try {
    writeFileSync(
      join(consumerDir, 'package.json'),
      `${JSON.stringify(consumerManifest(bundleDir, manifest.packages))}\n`
    );
    writeFileSync(
      join(consumerDir, 'smoke.mjs'),
      smokeSource(bundleDir, rootImportablePackages(bundleDir, manifest.packages))
    );
    run('npm', ['install', '--ignore-scripts', '--audit=false', '--fund=false', `--registry=${NPM_REGISTRY}`], {
      cwd: consumerDir
    });
    const roots = installedRoots(consumerDir, manifest.packages);
    validateInstalledEntrypoints(roots, run);
    run('npm', ['audit', '--omit=dev', '--audit-level=high', `--registry=${NPM_REGISTRY}`], { cwd: consumerDir });
    writeConsumerEvidence({
      consumerDir,
      evidenceDir: resolve(evidenceDir),
      manifest,
      roots
    });
    run(process.execPath, ['smoke.mjs'], { cwd: consumerDir });
    return manifest;
  } finally {
    rmSync(consumerDir, { recursive: true, force: true });
  }
}
