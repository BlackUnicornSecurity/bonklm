/**
 * Story 3.2 / R2-13 — sandbox-attack-corpus recall test
 *
 * Loads the 50-pattern hash-pinned corpus and runs each payload through
 * the appropriate validator (CodeInjection / PathTraversal). Asserts the
 * Sprint 16 baseline:
 *
 *  - Recall ≥ 80% across the full 50-pattern corpus.
 *  - Recall ≥ 90% on the 35 mechanically-derived patterns (indices that
 *    map directly to validator regex sinks).
 *
 * Story 4.5 (Sprint 24) consumes this same corpus by hash and gates
 * sandbox-connector graduation at recall ≥ 95%. The Sprint 16 baseline
 * intentionally lives below the graduation threshold so the hand-curated
 * AAD-D patterns have headroom for v0.7 tightening.
 *
 * Hash check: the test reads `corpus.hash` and recomputes `sha256` over
 * `patterns.json`; any drift fails the test loudly so the Sprint 4.5
 * graduation reviewer can trust the file-hash chain.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CodeInjectionValidator } from '../../src/validators/code-injection.js';
import { PathTraversalValidator } from '../../src/validators/path-traversal.js';

interface CorpusEntry {
  id: string;
  category: 'code_injection' | 'package_install' | 'path_traversal' | 'shell_metachar';
  subcategory: string;
  payload: string;
  expected_block: boolean;
  hand_curated: boolean;
  notes?: string;
}

const corpusDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'benchmarks', 'sandbox-attack-corpus');

let patterns: CorpusEntry[];

beforeAll(() => {
  const raw = readFileSync(join(corpusDir, 'patterns.json'), 'utf-8');
  patterns = JSON.parse(raw) as CorpusEntry[];
});

describe('sandbox-attack-corpus — composition + hash integrity', () => {
  it('contains exactly 50 entries with the R2-13 composition (60/20/10/10)', () => {
    expect(patterns.length).toBe(50);
    const counts = patterns.reduce<Record<string, number>>((acc, p) => {
      acc[p.category] = (acc[p.category] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts.code_injection).toBe(30);
    expect(counts.package_install).toBe(10);
    expect(counts.path_traversal).toBe(5);
    expect(counts.shell_metachar).toBe(5);
  });

  it('5-10 entries are flagged hand_curated (AAD-D requirement)', () => {
    const hc = patterns.filter(p => p.hand_curated).length;
    expect(hc).toBeGreaterThanOrEqual(5);
    expect(hc).toBeLessThanOrEqual(10);
  });

  it('corpus.hash matches sha256(patterns.json) — hash chain intact', () => {
    const raw = readFileSync(join(corpusDir, 'patterns.json'), 'utf-8');
    const computed = createHash('sha256').update(raw).digest('hex');
    const expected = readFileSync(join(corpusDir, 'corpus.hash'), 'utf-8').trim();
    expect(computed).toBe(expected);
  });

  /**
   * Hardcoded hash (architect CONCERN-3 + security CONCERN-5 audit
   * closure). Tamper-evidence anchor: a corpus-poisoner who edits
   * patterns.json + corpus.hash atomically still has to update THIS
   * constant, surfacing the modification in code review diff.
   *
   * After any legitimate corpus mutation:
   *  1. Run `node packages/core/benchmarks/sandbox-attack-corpus/build-corpus.mjs`
   *  2. Copy the printed sha256 into both `corpus.hash` AND this constant
   *  3. Commit all three (patterns.json, corpus.hash, this test) together
   */
  it('hardcoded sha256 anchor matches sha256(patterns.json) — defeats atomic poisoning', () => {
    const EXPECTED_CORPUS_SHA256 = 'db9c1986a01ae0d4f5281c74a038b0392415132d21e38aac80b6aacea778fff4';
    const raw = readFileSync(join(corpusDir, 'patterns.json'), 'utf-8');
    const computed = createHash('sha256').update(raw).digest('hex');
    expect(computed).toBe(EXPECTED_CORPUS_SHA256);
  });

  it('all entries carry expected_block=true (100% attack corpus, no benign)', () => {
    for (const p of patterns) {
      expect(p.expected_block).toBe(true);
    }
  });
});

describe('sandbox-attack-corpus — Sprint 16 recall baseline', () => {
  it('CodeInjectionValidator + PathTraversalValidator recall ≥ 80% across the full corpus', async () => {
    const ci = new CodeInjectionValidator();
    const pt = new PathTraversalValidator({ cwd: '/srv/sandbox' });

    let blocked = 0;
    const misses: string[] = [];

    for (const entry of patterns) {
      const r =
        entry.category === 'path_traversal' ? await pt.validate(entry.payload) : await ci.validate(entry.payload);
      if (r.blocked) {
        blocked++;
      } else {
        misses.push(`${entry.id} [${entry.category}/${entry.subcategory}]: ${entry.payload.slice(0, 80)}`);
      }
    }

    const recall = blocked / patterns.length;
    if (recall < 0.8) {
      // Surface misses for quick remediation when this drops.
      // eslint-disable-next-line no-console
      console.error('Corpus misses (Sprint 16 baseline):\n  ' + misses.join('\n  '));
    }
    expect(recall).toBeGreaterThanOrEqual(0.8);
  });

  it('recall on mechanically-derived (non-hand-curated) entries ≥ 90%', async () => {
    const ci = new CodeInjectionValidator();
    const pt = new PathTraversalValidator({ cwd: '/srv/sandbox' });

    const mechEntries = patterns.filter(p => !p.hand_curated);
    let blocked = 0;
    for (const entry of mechEntries) {
      const r =
        entry.category === 'path_traversal' ? await pt.validate(entry.payload) : await ci.validate(entry.payload);
      if (r.blocked) blocked++;
    }
    const recall = blocked / mechEntries.length;
    expect(recall).toBeGreaterThanOrEqual(0.9);
  });
});
