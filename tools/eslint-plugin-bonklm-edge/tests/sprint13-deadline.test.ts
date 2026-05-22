/**
 * tools/eslint-plugin-bonklm-edge — Sprint-13 rotation closure.
 *
 * Sprint 12 introduced this test as a CI-enforced deletion gate
 * for `grandfather-allowlist.json`. Sprint 13 day 1 deleted the
 * file — this test now asserts the post-rotation invariant:
 * the allowlist file MUST NOT exist in the repo (its presence
 * would indicate a regression / inadvertent restore from git).
 */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const allowlistPath = resolve(here, '..', 'grandfather-allowlist.json');

describe('Sprint-13 rotation closure', () => {
  it('grandfather-allowlist.json is deleted (Sprint 13 day 1 commitment)', () => {
    expect(existsSync(allowlistPath)).toBe(false);
  });
});
