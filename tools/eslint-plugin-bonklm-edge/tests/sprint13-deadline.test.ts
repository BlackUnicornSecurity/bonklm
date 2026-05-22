/**
 * tools/eslint-plugin-bonklm-edge — Sprint-13 deadline enforcement.
 *
 * The grandfather-allowlist.json carries a `sprint13DeadlineUtc` field
 * (set during Sprint-12 iter-2 audit BLOCK-7 closure: self-attestation
 * collapses under deadline pressure, so we wire CI-enforced expiry).
 *
 * Behavior:
 *   - PRE-deadline: passes; the allowlist may still exist (WARN phase).
 *   - POST-deadline: FAILS unless the allowlist file has been deleted.
 *     Sprint 13 day-1 PR deletes the file AND flips the recommended
 *     config (already uniform 'error'); this test then trivially
 *     passes via the absence path.
 *
 * Run as part of the normal vitest suite — runs on every CI build.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const allowlistPath = resolve(here, '..', 'grandfather-allowlist.json');

describe('Sprint-13 deadline enforcement', () => {
  it('grandfather-allowlist.json must be deleted past sprint13DeadlineUtc', () => {
    if (!existsSync(allowlistPath)) {
      // File deleted — post-Sprint-13 state. Pass.
      expect(true).toBe(true);
      return;
    }
    const parsed = JSON.parse(readFileSync(allowlistPath, 'utf-8')) as {
      sprint13DeadlineUtc?: string;
    };
    expect(typeof parsed.sprint13DeadlineUtc).toBe('string');
    const deadline = new Date(parsed.sprint13DeadlineUtc!);
    expect(Number.isNaN(deadline.getTime())).toBe(false);

    const now = new Date();
    if (now > deadline) {
      throw new Error(
        `Sprint-13 deadline ${parsed.sprint13DeadlineUtc} has passed but ` +
          `grandfather-allowlist.json still exists. Delete the file and ` +
          `migrate consumers from configs.warnPhase to configs.recommended.`
      );
    }
    expect(now <= deadline).toBe(true);
  });

  it('sprint13DeadlineUtc field is present + parseable when the file exists', () => {
    if (!existsSync(allowlistPath)) {
      expect(true).toBe(true);
      return;
    }
    const parsed = JSON.parse(readFileSync(allowlistPath, 'utf-8')) as {
      sprint13DeadlineUtc?: string;
      files?: unknown;
    };
    expect(typeof parsed.sprint13DeadlineUtc).toBe('string');
    expect(Array.isArray(parsed.files)).toBe(true);
  });
});
