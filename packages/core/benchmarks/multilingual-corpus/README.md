# Multilingual Attack Corpus

Per-language test corpus consumed by `multilingual-corpus.test.ts` to measure per-language recall +
FPR.

## Layout

```
multilingual-corpus/
  <lang>/
    true-positives.json    # 20 attacks, expected_block: true
    true-negatives.json    # 20 benign,  expected_block: false
    README.md              # native-speaker review notes + curator credit
```

## Status by language

Updated 2026-05-23 (Pass 1 — scaffold).

### Tier 1 — original 10 (existing patterns; corpus backfill planned)

| Lang | Patterns      | TP corpus | TN corpus | Reviewer | Recall (last) | FPR (last) |
| ---- | ------------- | --------- | --------- | -------- | ------------- | ---------- |
| es   | 4             | ❌        | ❌        | TBD      | n/a           | n/a        |
| fr   | 4             | ❌        | ❌        | TBD      | n/a           | n/a        |
| de   | 4             | ❌        | ❌        | TBD      | n/a           | n/a        |
| pt   | 4             | ❌        | ❌        | TBD      | n/a           | n/a        |
| it   | 4             | ❌        | ❌        | TBD      | n/a           | n/a        |
| zh   | 4+1 romanized | ❌        | ❌        | TBD      | n/a           | n/a        |
| ja   | 4+1 romanized | ❌        | ❌        | TBD      | n/a           | n/a        |
| ko   | 4+1 romanized | ❌        | ❌        | TBD      | n/a           | n/a        |
| ru   | 4+1 romanized | ❌        | ❌        | TBD      | n/a           | n/a        |
| ar   | 4             | ❌        | ❌        | TBD      | n/a           | n/a        |

### Tier 2 — new 10 (backlog)

| Lang            | Patterns       | TP         | TN         | Reviewer | Recall (last)    | FPR (last) |
| --------------- | -------------- | ---------- | ---------- | -------- | ---------------- | ---------- |
| hi (Hindi)      | ❌ → seed only | ✅ seed 20 | ✅ seed 20 | TBD      | 0% (no patterns) | 0%         |
| bn (Bengali)    | ✅ 4 (SOV)     | ✅ seed 20 | ✅ seed 20 | TBD      | 75% (baseline)   | 0%         |
| ur (Urdu)       | ✅ 4 (SOV)     | ✅ seed 20 | ✅ seed 20 | TBD      | 80% (baseline)   | 0%         |
| id (Indonesian) | ❌             | ❌         | ❌         | TBD      | n/a              | n/a        |
| tr (Turkish)    | ❌             | ❌         | ❌         | TBD      | n/a              | n/a        |
| fa (Persian)    | ❌             | ❌         | ❌         | TBD      | n/a              | n/a        |
| vi (Vietnamese) | ❌             | ❌         | ❌         | TBD      | n/a              | n/a        |
| th (Thai)       | ❌             | ❌         | ❌         | TBD      | n/a              | n/a        |
| pl (Polish)     | ❌             | ❌         | ❌         | TBD      | n/a              | n/a        |
| nl (Dutch)      | ❌             | ❌         | ❌         | TBD      | n/a              | n/a        |

## Entry schema (TP + TN)

```json
{
  "id": "hi-tp-001",
  "language": "hi",
  "category": "system_override",
  "payload": "<attack-or-benign-string>",
  "expected_block": true,
  "translation_en": "ignore previous instructions",
  "curator": "TBD",
  "notes": "optional"
}
```

`expected_block: true` for `true-positives.json`; `false` for `true-negatives.json`.

## Recall / FPR gate

- Per-language **recall ≥ 85%** against the 20-TP corpus.
- Per-language **FPR ≤ 5%** against the 20-TN corpus.
- Below either threshold → hand-curation pass.

## Curator-separation discipline

Each entry's `curator` field MUST be filled before the corpus is consumed for a recall measurement.
Following the hand-curated-pattern evidence approach (transplanted here), the curator MUST NOT be
the same person who hand-tunes the corresponding regex pattern — otherwise the recall gate is
tautological. Each corpus PR enumerates the curator-vs-pattern-author separation per language.

## Stability

Each per-language corpus is FROZEN once it lands. Mutations land via a separate "corpus refresh" PR
with a corpus-rev bump in the per-language README.
