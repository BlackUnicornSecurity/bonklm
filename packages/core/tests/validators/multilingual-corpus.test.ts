/**
 * Story 3.12 — Multilingual Corpus framework
 *
 * Sprint 16 (Pass 1) deliverable:
 *   - Composition check across per-language corpora.
 *   - Recall + FPR measurement framework (NO per-language recall floor
 *     enforced until Sprint 22 close — Hindi seed is curator-unreviewed,
 *     pattern-set incomplete, recall would be artificially low).
 *
 * Sprint 22 close adds:
 *   - Per-language recall ≥ 85% gate.
 *   - Per-language FPR ≤ 5% gate.
 *   - Curator-vs-pattern-author separation attestation per language.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MultilingualDetector } from '../../src/validators/multilingual-patterns.js';

interface CorpusEntry {
  id: string;
  language: string;
  category: string;
  payload: string;
  expected_block: boolean;
  translation_en?: string;
  curator: string;
  notes?: string;
}

const corpusDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'benchmarks',
  'multilingual-corpus'
);

function listLanguageDirs(): string[] {
  if (!existsSync(corpusDir)) return [];
  return readdirSync(corpusDir).filter((entry) => {
    const full = join(corpusDir, entry);
    return statSync(full).isDirectory();
  });
}

function loadCorpus(lang: string, kind: 'true-positives' | 'true-negatives'): CorpusEntry[] {
  const path = join(corpusDir, lang, `${kind}.json`);
  if (!existsSync(path)) return [];
  return JSON.parse(readFileSync(path, 'utf-8')) as CorpusEntry[];
}

let languages: string[];
beforeAll(() => {
  languages = listLanguageDirs();
});

describe('Multilingual Corpus — framework integrity', () => {
  it('corpus directory exists and contains ≥1 language', () => {
    expect(languages.length).toBeGreaterThanOrEqual(1);
  });

  it('each language has either both TP+TN files or neither (no partial scaffolds in CI)', () => {
    for (const lang of languages) {
      const tp = join(corpusDir, lang, 'true-positives.json');
      const tn = join(corpusDir, lang, 'true-negatives.json');
      const hasTp = existsSync(tp);
      const hasTn = existsSync(tn);
      expect(hasTp).toBe(hasTn);
    }
  });

  it('every TP entry has expected_block: true; every TN entry has expected_block: false', () => {
    for (const lang of languages) {
      const tp = loadCorpus(lang, 'true-positives');
      const tn = loadCorpus(lang, 'true-negatives');
      for (const entry of tp) expect(entry.expected_block).toBe(true);
      for (const entry of tn) expect(entry.expected_block).toBe(false);
    }
  });

  it('every entry carries a curator field (AAD-D separation discipline)', () => {
    for (const lang of languages) {
      const all = [...loadCorpus(lang, 'true-positives'), ...loadCorpus(lang, 'true-negatives')];
      for (const entry of all) {
        expect(typeof entry.curator).toBe('string');
        expect(entry.curator.length).toBeGreaterThan(0);
      }
    }
  });

  it('per-language TP corpus has exactly 20 entries (Sprint 22 gate prerequisite)', () => {
    for (const lang of languages) {
      const tp = loadCorpus(lang, 'true-positives');
      if (tp.length === 0) continue; // No corpus yet for this language.
      expect(tp.length).toBe(20);
    }
  });

  it('per-language TN corpus has exactly 20 entries (Sprint 22 gate prerequisite)', () => {
    for (const lang of languages) {
      const tn = loadCorpus(lang, 'true-negatives');
      if (tn.length === 0) continue;
      expect(tn.length).toBe(20);
    }
  });
});

describe('Multilingual Corpus — recall + FPR baseline (Sprint 16 measurement; gate from Sprint 22)', () => {
  const detector = new MultilingualDetector();

  it('records baseline recall + FPR per language (no gate; pre-Sprint-22)', () => {
    const report: Record<string, { recall: number; fpr: number; tp: number; tn: number }> = {};
    for (const lang of languages) {
      const tp = loadCorpus(lang, 'true-positives');
      const tn = loadCorpus(lang, 'true-negatives');
      if (tp.length === 0 && tn.length === 0) continue;

      let blockedTp = 0;
      for (const entry of tp) {
        const r = detector.validate(entry.payload);
        if (r.blocked) blockedTp++;
      }
      let blockedTn = 0;
      for (const entry of tn) {
        const r = detector.validate(entry.payload);
        if (r.blocked) blockedTn++;
      }
      report[lang] = {
        recall: tp.length > 0 ? blockedTp / tp.length : 0,
        fpr: tn.length > 0 ? blockedTn / tn.length : 0,
        tp: tp.length,
        tn: tn.length,
      };
    }
    // Sprint 16: surface but do not gate.
    // eslint-disable-next-line no-console
    console.log(
      'Multilingual baseline (Sprint 16):',
      Object.entries(report)
        .map(([l, m]) => `${l} recall=${(m.recall * 100).toFixed(0)}% fpr=${(m.fpr * 100).toFixed(0)}%`)
        .join('  ')
    );
    expect(Object.keys(report).length).toBeGreaterThanOrEqual(1);
  });

  /**
   * Sprint 22 close will activate this per-language gate. Today it is
   * conditional (skip when patterns missing): hi (Hindi) has NO patterns
   * yet — patterns ship Sprint 21. The TP corpus exists FIRST so
   * curator-vs-pattern-author separation is enforceable at pattern-PR time.
   */
  it.skip('Sprint 22 gate: per-language recall ≥ 85% AND FPR ≤ 5%', () => {
    for (const lang of languages) {
      const tp = loadCorpus(lang, 'true-positives');
      const tn = loadCorpus(lang, 'true-negatives');
      if (tp.length === 0) continue;

      let blockedTp = 0;
      for (const entry of tp) {
        if (detector.validate(entry.payload).blocked) blockedTp++;
      }
      const recall = blockedTp / tp.length;
      expect(recall).toBeGreaterThanOrEqual(0.85);

      let blockedTn = 0;
      for (const entry of tn) {
        if (detector.validate(entry.payload).blocked) blockedTn++;
      }
      const fpr = tn.length > 0 ? blockedTn / tn.length : 0;
      expect(fpr).toBeLessThanOrEqual(0.05);
    }
  });
});
