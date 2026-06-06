/**
 * Tests for the shared CLI path-containment helper {@link isPathWithinRoot}.
 *
 * The helper is pure (string + `node:path` only), so these are fast unit tests
 * with no filesystem fixtures. Paths use the host separator — `/` on the POSIX
 * dev/CI host — matching the `resolve()`/`sep` the helper itself uses (the same
 * convention as the cwd-mocked win32 boundary tests in `config/env.test.ts`).
 *
 * Non-vacuity (ADR-0001): the security-load-bearing cases below are annotated
 * with the exact source mutation that flips them — e.g. dropping `+ sep` makes
 * the sibling-prefix cases pass containment, so the corresponding assertions go
 * red. None of these are happy-path-only checks.
 */

import { describe, it, expect } from 'vitest';
import { resolve, sep } from 'node:path';

import { isPathWithinRoot } from './path.js';

describe('isPathWithinRoot', () => {
  describe('strict nesting (defaults)', () => {
    it('accepts a path strictly nested under root', () => {
      expect(isPathWithinRoot('/var/app/sub/file.txt', '/var/app')).toBe(true);
      expect(isPathWithinRoot('/var/app/x', '/var/app')).toBe(true);
    });

    it('rejects a path outside root', () => {
      expect(isPathWithinRoot('/var/other/file', '/var/app')).toBe(false);
      expect(isPathWithinRoot('/etc/passwd', '/var/app')).toBe(false);
    });

    it('rejects the parent of root', () => {
      expect(isPathWithinRoot('/var', '/var/app')).toBe(false);
    });
  });

  describe('allowRootItself', () => {
    it('rejects a candidate equal to root by default', () => {
      // Default `allowRootItself: false` — root is not "within" itself.
      expect(isPathWithinRoot('/var/app', '/var/app')).toBe(false);
    });

    it('accepts a candidate equal to root when allowRootItself is set', () => {
      // doctor.ts `core.hooksPath = .` relies on this branch.
      expect(isPathWithinRoot('/var/app', '/var/app', { allowRootItself: true })).toBe(true);
    });

    it('a nested path stays within regardless of allowRootItself', () => {
      expect(isPathWithinRoot('/var/app/sub', '/var/app', { allowRootItself: false })).toBe(true);
      expect(isPathWithinRoot('/var/app/sub', '/var/app', { allowRootItself: true })).toBe(true);
    });
  });

  describe('sibling-prefix boundary (the `+ sep` guard)', () => {
    it('rejects a sibling whose name extends the root name', () => {
      // NON-VACUOUS: this is the bypass the `+ sep` boundary exists to close.
      // A bare `startsWith(root)` (no `+ sep`) returns true for `/var/app-evil`
      // because the string `/var/app-evil` starts with `/var/app` — so dropping
      // `+ sep` from the source flips these to `true` and the test goes red.
      expect(isPathWithinRoot('/var/app-evil', '/var/app')).toBe(false);
      expect(isPathWithinRoot('/var/app-evil/secret', '/var/app')).toBe(false);
      expect(isPathWithinRoot('/var/application', '/var/app')).toBe(false);
    });

    it('still nests the legitimate child that shares the prefix up to the separator', () => {
      expect(isPathWithinRoot('/var/app/evil', '/var/app')).toBe(true);
    });
  });

  describe('caseInsensitive', () => {
    it('is case-SENSITIVE by default (rejects a case-only difference)', () => {
      // NON-VACUOUS counterpart to the case-fold test: with the default the
      // upper-case candidate is NOT contained.
      expect(isPathWithinRoot('/VAR/APP/sub', '/var/app')).toBe(false);
    });

    it('accepts a case-only difference when caseInsensitive is set', () => {
      // NON-VACUOUS: removing the fold (`path.toLowerCase()`) from the source
      // makes this comparison case-sensitive again, so it goes red. Mirrors the
      // win32 env.ts sink (case-insensitive filesystem).
      expect(isPathWithinRoot('/VAR/APP/sub', '/var/app', { caseInsensitive: true })).toBe(true);
      expect(isPathWithinRoot('/var/app/SUB', '/VAR/APP', { caseInsensitive: true })).toBe(true);
    });

    it('does NOT open the sibling-prefix bypass under case-folding', () => {
      // Case-folding must not weaken the `+ sep` boundary.
      expect(isPathWithinRoot('/VAR/APP-EVIL', '/var/app', { caseInsensitive: true })).toBe(false);
    });

    it('honours allowRootItself together with case-folding', () => {
      expect(isPathWithinRoot('/VAR/APP', '/var/app', { caseInsensitive: true })).toBe(false);
      expect(isPathWithinRoot('/VAR/APP', '/var/app', { caseInsensitive: true, allowRootItself: true })).toBe(true);
    });
  });

  describe('resolution semantics', () => {
    it('resolves a relative candidate against ROOT, not the process cwd', () => {
      // A relative candidate is root-relative: with root `/var/app`, `sub/file`
      // resolves to `/var/app/sub/file` (inside). NON-VACUOUS: if the helper
      // resolved the candidate against process.cwd() instead, this would be
      // `<cwd>/sub/file`, NOT inside `/var/app` — the assertion flips.
      expect(isPathWithinRoot('sub/file', '/var/app')).toBe(true);
      // `.` resolves to root itself → governed by allowRootItself.
      expect(isPathWithinRoot('.', '/var/app')).toBe(false);
      expect(isPathWithinRoot('.', '/var/app', { allowRootItself: true })).toBe(true);
      // A relative candidate that climbs out of root is rejected.
      expect(isPathWithinRoot('../sibling', '/var/app')).toBe(false);
    });

    it('resolves a relative root against the process cwd', () => {
      const cwd = process.cwd();
      expect(isPathWithinRoot(resolve(cwd, 'a/b'), '.')).toBe(true);
    });

    it('normalises `..` / `.` segments before the containment check', () => {
      // A net-escaping candidate is rejected even though its prefix looks inside.
      expect(isPathWithinRoot('/var/app/sub/../../escape', '/var/app')).toBe(false);
      // A `..` that resolves back inside is NOT over-blocked.
      expect(isPathWithinRoot('/var/app/sub/../kept', '/var/app')).toBe(true);
      // Redundant `.` / duplicate separators collapse.
      expect(isPathWithinRoot('/var/app/./sub', '/var/app')).toBe(true);
    });

    it('treats a trailing separator on root as the same directory', () => {
      // resolve() strips the trailing separator, so `/var/app/` === `/var/app`.
      expect(isPathWithinRoot('/var/app/sub', `/var/app${sep}`)).toBe(true);
      expect(isPathWithinRoot('/var/app', `/var/app${sep}`, { allowRootItself: true })).toBe(true);
    });

    it('contains children of the filesystem root (root resolves to a bare separator)', () => {
      // NON-VACUOUS: this is the `root + sep` doubling bug. resolve(sep) is a bare
      // separator (`/` on POSIX), so a naive `startsWith(root + sep)` would test
      // `startsWith('//')` and reject EVERY child. The `endsWith(sep)` guard makes
      // the prefix idempotent for a root that already ends in `sep` (filesystem
      // root, a drive root, or a UNC root). Drop that guard and these flip.
      const fsRoot = resolve(sep);
      expect(isPathWithinRoot(resolve(sep, 'etc', 'passwd'), fsRoot)).toBe(true);
      expect(isPathWithinRoot(resolve(sep, 'anything'), fsRoot)).toBe(true);
      // A relative candidate under the fs-root is still contained.
      expect(isPathWithinRoot('etc', fsRoot)).toBe(true);
      // The fs-root itself is still governed by allowRootItself.
      expect(isPathWithinRoot(fsRoot, fsRoot)).toBe(false);
      expect(isPathWithinRoot(fsRoot, fsRoot, { allowRootItself: true })).toBe(true);
    });
  });
});
