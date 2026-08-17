/**
 * Workspace coverage guard for the connector registry.
 *
 * The wizard's promise is that it detects and configures EVERY publishable
 * connector. Nothing enforced that before: the registry was a hand-maintained
 * array, so a connector package could ship without the wizard ever knowing it
 * existed — which is exactly what happened (5 registered out of 52 published).
 *
 * This suite reads the workspace manifests off disk and fails the build when
 * registry membership and published packages disagree in either direction.
 * Remove the descriptor for a package and this suite goes red; add a connector
 * package without registering it and this suite goes red.
 *
 * @module connectors/registry.workspace.test
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAllConnectors } from './registry.js';
import { CONNECTOR_CATALOG } from './catalog/index.js';
import { isConnectorDefinition } from './base.js';
import { isValidConnectorIdFormat } from '../commands/connector-id.js';
import { MAX_PORTS_TO_CHECK } from '../detection/services.js';
import { NON_INGRESS_FRAMEWORK_CONNECTORS } from '../commands/doctor.js';

/** `packages/core/src/cli/connectors` → repository root. */
const REPO_ROOT = fileURLToPath(new URL('../../../../..', import.meta.url));
const PACKAGES_DIR = join(REPO_ROOT, 'packages');

/**
 * The core library itself. It is published, but it is the thing connectors plug
 * into rather than a connector, so it is not expected in the registry.
 */
const CORE_PACKAGE = '@blackunicorn/bonklm';

/**
 * Reads every publishable (`private !== true`) package name under `packages/`.
 *
 * @returns Package names, sorted.
 */
function readPublishablePackages(): string[] {
  const names: string[] = [];
  for (const entry of readdirSync(PACKAGES_DIR)) {
    const manifestPath = join(PACKAGES_DIR, entry, 'package.json');
    let raw: string;
    try {
      if (!statSync(manifestPath).isFile()) {
        continue;
      }
      raw = readFileSync(manifestPath, 'utf-8');
    } catch {
      continue;
    }
    const manifest = JSON.parse(raw) as { name?: string; private?: boolean };
    if (manifest.private === true || !manifest.name || manifest.name === CORE_PACKAGE) {
      continue;
    }
    names.push(manifest.name);
  }
  return names.sort();
}

describe('connector registry — workspace coverage', () => {
  const published = readPublishablePackages();
  const connectors = getAllConnectors();

  it('finds the workspace packages (guards against a broken path)', () => {
    expect(published.length).toBeGreaterThan(40);
    expect(published).toContain('@blackunicorn/bonkdrant');
  });

  it('registers a connector for every publishable package', () => {
    const registered = new Set(connectors.map(c => c.npmPackage).filter(Boolean));
    const missing = published.filter(name => !registered.has(name));
    expect(missing, `unregistered connector packages: ${missing.join(', ')}`).toEqual([]);
  });

  it('registers no connector for a package that is not published', () => {
    const publishedSet = new Set(published);
    const orphans = connectors
      .map(c => c.npmPackage)
      .filter((name): name is string => !!name && !publishedSet.has(name));
    expect(orphans, `connectors pointing at unpublished packages: ${orphans.join(', ')}`).toEqual([]);
  });

  it('claims each package exactly once', () => {
    const claims = connectors.map(c => c.npmPackage).filter(Boolean);
    expect(new Set(claims).size).toBe(claims.length);
  });

  it('gives every connector an npmPackage', () => {
    const anonymous = connectors.filter(c => !c.npmPackage).map(c => c.id);
    expect(anonymous, `connectors missing npmPackage: ${anonymous.join(', ')}`).toEqual([]);
  });
});

describe('connector registry — definition contract', () => {
  const connectors = getAllConnectors();

  it('produces a structurally valid definition for every connector', () => {
    const invalid = connectors.filter(c => !isConnectorDefinition(c)).map(c => c.id);
    expect(invalid, `invalid connector definitions: ${invalid.join(', ')}`).toEqual([]);
  });

  it('uses ids the CLI id guard accepts', () => {
    const bad = connectors.map(c => c.id).filter(id => !isValidConnectorIdFormat(id));
    expect(bad, `ids rejected by isValidConnectorIdFormat: ${bad.join(', ')}`).toEqual([]);
  });

  it('has unique ids', () => {
    const ids = connectors.map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('detects its own package for every connector', () => {
    const notSelfDetecting = connectors
      .filter(c => c.npmPackage && !c.detection.packageJson?.includes(c.npmPackage))
      .map(c => c.id);
    expect(notSelfDetecting, `connectors that do not detect their own package: ${notSelfDetecting.join(', ')}`).toEqual(
      []
    );
  });

  it('maps every prompted credential to a config key', () => {
    // A credential the wizard writes to .env but does not map to a config key
    // is collected and then never handed to the connector's test().
    const unmapped: string[] = [];
    for (const connector of connectors) {
      const optional = new Set(connector.optionalEnvVars ?? []);
      const mapped = new Set(Object.keys(connector.configKeyByEnvVar ?? {}));
      for (const envVar of connector.detection.envVars ?? []) {
        if (!optional.has(envVar) && !mapped.has(envVar)) {
          unmapped.push(`${connector.id}:${envVar}`);
        }
      }
    }
    expect(unmapped, `required env vars with no config key: ${unmapped.join(', ')}`).toEqual([]);
  });
});

describe('connector registry — detection-signal integrity', () => {
  const connectors = getAllConnectors();

  it('never lets two connectors claim the same env var', () => {
    // Env-var signals ARE value-deduped, so a collision would make the losing
    // connector's credential permanently undetectable. This was asserted only
    // in a comment before.
    const owner = new Map<string, string>();
    const collisions: string[] = [];
    for (const connector of connectors) {
      for (const envVar of connector.detection.envVars ?? []) {
        const previous = owner.get(envVar);
        if (previous) {
          collisions.push(`${envVar}: ${previous} and ${connector.id}`);
        } else {
          owner.set(envVar, connector.id);
        }
      }
    }
    expect(collisions, `env vars claimed twice: ${collisions.join('; ')}`).toEqual([]);
  });

  it('never lets two connectors claim the same port', () => {
    const owner = new Map<number, string>();
    const collisions: string[] = [];
    for (const connector of connectors) {
      for (const port of connector.detection.ports ?? []) {
        const previous = owner.get(port);
        if (previous) {
          collisions.push(`${port}: ${previous} and ${connector.id}`);
        } else {
          owner.set(port, connector.id);
        }
      }
    }
    expect(collisions, `ports claimed twice: ${collisions.join('; ')}`).toEqual([]);
  });

  it('keeps the port scan inside the service-detection budget', () => {
    // detectServices probes at most MAX_PORTS_TO_CHECK ports and drops the
    // rest with only a console.warn. Fail loudly here instead of losing a
    // connector's detection silently.
    const ports = new Set(connectors.flatMap(c => [...(c.detection.ports ?? [])]));
    expect(ports.size).toBeLessThanOrEqual(MAX_PORTS_TO_CHECK);
  });

  it('uses SCREAMING_SNAKE_CASE for every registry env var', () => {
    // The credential detector reads process.env[name]; a lowercase-initial name
    // could collide with an Object.prototype member. Enforced across the whole
    // registry, not just the catalog.
    const bad = connectors.flatMap(c =>
      (c.detection.envVars ?? []).filter(name => !/^[A-Z][A-Z0-9_]*$/.test(name)).map(name => `${c.id}:${name}`)
    );
    expect(bad).toEqual([]);
  });
});

describe('connector catalog — descriptor drift against the workspace manifests', () => {
  it('declares only peer packages the connector package actually peer-depends on', () => {
    // peerPackages is a hand-copy of each connector package's peerDependencies.
    // Without this check, renaming or dropping a peer SDK silently breaks that
    // connector's detection while every other gate stays green — the exact
    // drift class this registry exists to eliminate.
    const drift: string[] = [];
    for (const descriptor of CONNECTOR_CATALOG) {
      const declared = descriptor.peerPackages ?? [];
      if (declared.length === 0) {
        continue;
      }
      const dir = readdirSync(PACKAGES_DIR).find(entry => {
        try {
          const manifest = JSON.parse(readFileSync(join(PACKAGES_DIR, entry, 'package.json'), 'utf-8')) as {
            name?: string;
          };
          return manifest.name === descriptor.npmPackage;
        } catch {
          return false;
        }
      });
      if (!dir) {
        drift.push(`${descriptor.id}: no package directory for ${descriptor.npmPackage}`);
        continue;
      }
      const manifest = JSON.parse(readFileSync(join(PACKAGES_DIR, dir, 'package.json'), 'utf-8')) as {
        peerDependencies?: Record<string, string>;
      };
      const peers = new Set(Object.keys(manifest.peerDependencies ?? {}));
      drift.push(...declared.filter(name => !peers.has(name)).map(name => `${descriptor.id}: ${name}`));
    }
    expect(drift, `peerPackages not in the package's peerDependencies: ${drift.join('; ')}`).toEqual([]);
  });
});

describe('doctor rate-limiter deny-list', () => {
  it('names only packages that a registered connector actually ships', () => {
    // The deny-list keys on npm package names, and this repository renames
    // published packages (bonklm-qdrant -> bonkdrant). A stale key silently
    // turns the exclusion into a no-op and the false-positive warning returns.
    const shipped = new Set(getAllConnectors().map(c => c.npmPackage));
    const stale = [...NON_INGRESS_FRAMEWORK_CONNECTORS].filter(name => !shipped.has(name));
    expect(stale, `deny-list entries no connector ships: ${stale.join(', ')}`).toEqual([]);
  });
});

describe('connector catalog — descriptor hygiene', () => {
  it('gives every descriptor a summary', () => {
    const bare = CONNECTOR_CATALOG.filter(d => !d.summary || d.summary.trim().length === 0).map(d => d.id);
    expect(bare).toEqual([]);
  });

  it('never declares a peer package twice for one connector', () => {
    for (const descriptor of CONNECTOR_CATALOG) {
      const peers = descriptor.peerPackages ?? [];
      expect(new Set(peers).size, `duplicate peerPackages on ${descriptor.id}`).toBe(peers.length);
    }
  });

  it('uses SCREAMING_SNAKE_CASE env var names', () => {
    const bad: string[] = [];
    for (const descriptor of CONNECTOR_CATALOG) {
      const names = [...(descriptor.credentials ?? []).map(c => c.env), ...(descriptor.detectEnvVars ?? [])];
      bad.push(...names.filter(name => !/^[A-Z][A-Z0-9_]*$/.test(name)).map(name => `${descriptor.id}:${name}`));
    }
    expect(bad).toEqual([]);
  });
});
