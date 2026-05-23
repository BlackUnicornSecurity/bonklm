# Multilingual Attack Corpus (Story 3.12)

Per-language test corpus consumed by `multilingual-corpus.test.ts` to measure per-language recall + FPR.

## Layout

```
multilingual-corpus/
  <lang>/
    true-positives.json    # 20 attacks, expected_block: true
    true-negatives.json    # 20 benign,  expected_block: false
    README.md              # native-speaker review notes + curator credit
```

## Status by language

Updated 2026-05-23 (Sprint 16 / Story 3.12 Pass 1 — scaffold).

### Tier 1 — original 10 (existing patterns; corpus backfill in Sprints 17-22)

| Lang | Patterns | TP corpus | TN corpus | Reviewer | Recall (last) | FPR (last) |
|---|---|---|---|---|---|---|
| es | 4 | ❌ | ❌ | TBD | n/a | n/a |
| fr | 4 | ❌ | ❌ | TBD | n/a | n/a |
| de | 4 | ❌ | ❌ | TBD | n/a | n/a |
| pt | 4 | ❌ | ❌ | TBD | n/a | n/a |
| it | 4 | ❌ | ❌ | TBD | n/a | n/a |
| zh | 4+1 romanized | ❌ | ❌ | TBD | n/a | n/a |
| ja | 4+1 romanized | ❌ | ❌ | TBD | n/a | n/a |
| ko | 4+1 romanized | ❌ | ❌ | TBD | n/a | n/a |
| ru | 4+1 romanized | ❌ | ❌ | TBD | n/a | n/a |
| ar | 4 | ❌ | ❌ | TBD | n/a | n/a |

### Tier 2 — new 10 (Sprint 17-22 backlog)

| Lang | Sprint | Patterns | TP | TN | Reviewer |
|---|---|---|---|---|---|
| hi (Hindi) | 16 (seed) / 21 (full) | ❌ → seed only | ✅ seed 20 | ✅ seed 20 | TBD |
| bn (Bengali) | 17 | ❌ | ❌ | ❌ | TBD |
| ur (Urdu) | 17 | ❌ | ❌ | ❌ | TBD |
| id (Indonesian) | 18 | ❌ | ❌ | ❌ | TBD |
| tr (Turkish) | 18 | ❌ | ❌ | ❌ | TBD |
| fa (Persian) | 19 | ❌ | ❌ | ❌ | TBD |
| vi (Vietnamese) | 19 | ❌ | ❌ | ❌ | TBD |
| th (Thai) | 20 | ❌ | ❌ | ❌ | TBD |
| pl (Polish) | 20 | ❌ | ❌ | ❌ | TBD |
| nl (Dutch) | 21 | ❌ | ❌ | ❌ | TBD |

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

## Recall / FPR gate (Sprint 22 close)

  - Per-language **recall ≥ 85%** against the 20-TP corpus.
  - Per-language **FPR ≤ 5%** against the 20-TN corpus.
  - Below either threshold → hand-curation pass.

## Curator-separation discipline

Each entry's `curator` field MUST be filled before the corpus is consumed for a recall measurement. Per the Story 4.5 AAD-D evidence pattern (transplanted here), the curator MUST NOT be the same person who hand-tunes the corresponding regex pattern in the same sprint — otherwise the recall gate is tautological. The Sprint 22 closure PR enumerates the curator-vs-pattern-author separation per language.

## Stability

Each per-language corpus is FROZEN at the sprint that lands it. Mutations land via a separate "corpus refresh" PR with a corpus-rev bump in the per-language README.
