/**
 * Sprint 14 deferred-closure item F:
 * Wrapped-method-drift smoke test against peer-dep SDK signatures.
 *
 * Each connector that uses a `WRAPPED_*_METHODS` Set (lance,
 * turbopuffer, future vector connectors) declares which methods on
 * the underlying SDK subject it intercepts. If a peer-dep major
 * removes one of those methods, the Proxy `get` trap returns
 * `undefined.bind(undefined)` at runtime — a confusing TypeError
 * rather than a guardrail error. The CI smoke catches this BEFORE
 * release by statically reading the peer-dep's .d.ts file and
 * asserting every wrapped method name still exists on the subject's
 * type declaration.
 *
 * Sprint 14 cumulative architect lane (arch X5) recommendation
 * implemented here as a static grep against the SDK's declaration
 * file. Lightweight, no SDK runtime needed.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(__dirname, '../../../..');

/**
 * Crude method-declaration extractor. Reads a TypeScript .d.ts file
 * and returns the set of method names declared on the named class.
 *
 * Does not try to be a real TS parser — just regex enough to catch
 * method names at indented positions inside `declare class X { ... }`.
 */
function extractMethodNames(dtsContent: string, className: string): Set<string> {
  const classRegex = new RegExp(
    `(?:export\\s+)?declare\\s+(?:abstract\\s+)?class\\s+${className}[^{]*\\{([\\s\\S]*?)\\n\\}`,
    'm'
  );
  const m = classRegex.exec(dtsContent);
  if (!m) {
    throw new Error(
      `wrapped-method-drift: could not find \`declare class ${className}\` in d.ts file`
    );
  }
  const body = m[1];
  const methodRegex = /^\s*(?:abstract\s+)?(?:get\s+)?([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/gm;
  const methods = new Set<string>();
  let methodMatch: RegExpExecArray | null;
  while ((methodMatch = methodRegex.exec(body)) !== null) {
    const name = methodMatch[1];
    if (name === 'constructor' || name === 'if' || name === 'for') continue;
    methods.add(name);
  }
  return methods;
}

describe('Sprint 14 deferred-closure item F — wrapped-method drift smoke', () => {
  describe('Turbopuffer Namespace', () => {
    const sdkDts = resolve(
      workspaceRoot,
      'node_modules/.pnpm/@turbopuffer+turbopuffer@2.1.0/node_modules/@turbopuffer/turbopuffer/resources/namespaces.d.ts'
    );

    it('SDK declaration file is present (peer-dep installed)', () => {
      const content = readFileSync(sdkDts, 'utf-8');
      expect(content.length).toBeGreaterThan(0);
    });

    it('every wrapped method exists on the live SDK Namespace declaration', () => {
      const content = readFileSync(sdkDts, 'utf-8');
      const sdkMethods = extractMethodNames(content, 'Namespace');
      // These names MUST stay in lockstep with the connector's
      // `WRAPPED_NAMESPACE_METHODS` Set. If a peer-dep major removes
      // one of these names, this test fails — replace the wrap or
      // bump the peer-dep ceiling in package.json.
      const connectorWrappedMethods = ['write', 'query', 'multiQuery', 'deleteAll'];
      for (const method of connectorWrappedMethods) {
        expect(sdkMethods.has(method), `Turbopuffer Namespace.${method}() missing in SDK`).toBe(
          true
        );
      }
    });
  });

  describe('LanceDB Table', () => {
    const sdkDts = resolve(
      workspaceRoot,
      'packages/lance-connector/node_modules/@lancedb/lancedb/dist/table.d.ts'
    );

    it('SDK declaration file is present (peer-dep installed)', () => {
      const content = readFileSync(sdkDts, 'utf-8');
      expect(content.length).toBeGreaterThan(0);
    });

    it('every wrapped method exists on the live SDK Table declaration', () => {
      const content = readFileSync(sdkDts, 'utf-8');
      const sdkMethods = extractMethodNames(content, 'Table');
      const connectorWrappedMethods = [
        'add',
        'update',
        'delete',
        'search',
        'query',
        'mergeInsert',
      ];
      for (const method of connectorWrappedMethods) {
        expect(sdkMethods.has(method), `LanceDB Table.${method}() missing in SDK`).toBe(
          true
        );
      }
    });
  });
});
