# Hindi (hi) — Multilingual Corpus

**Status**: SEED corpus (Pass 1). Patterns themselves land later; this corpus exists FIRST so
curator-vs-pattern-author separation is enforceable.

**Script**: Devanagari (देवनागरी). Left-to-right. **Speakers**: 600M+ native + L2. **Curator**: TBD
(pending native reviewer). Seed authored by Claude-Opus-4.7 from English templates — explicitly
marked `curator: "claude-opus-4.7-seed"` to flag that the entries MUST be reviewed by a native
speaker before recall measurements anchor any decision.

## Coverage (20 TP / 20 TN)

### True positives (`true-positives.json`)

- `system_override` × 5
- `constraint_removal` × 4
- `mode_switching` × 3
- `role_hijacking` × 3
- `jailbreak` × 3
- `reformulation_trigger` × 2

### True negatives (`true-negatives.json`)

- Benign questions / requests using Hindi keywords that overlap with attack phrasings (e.g. "please
  ignore the typo" → "क्षमा करें टाइपो को नज़रअंदाज़ करें" — uses the verb "ignore" but in a benign
  sense).
- Cooking / weather / casual / educational queries.

## Known limitations of this seed

- Translations are direct; may not capture native idiom for attacks.
- Romanized (transliterated to Latin) variants NOT included in seed — planned backfill.
- No mixed-script (Hindi + English) entries — planned backfill.

## Hand-off checklist

- [ ] Native Hindi speaker reviews + revises all 40 entries.
- [ ] Curator field populated with reviewer name (non-anonymous).
- [ ] Reviewer is NOT the author of the corresponding `hi_*` regex patterns.
- [ ] Romanized variants added.
- [ ] Mixed-script (hi+en) added.
- [ ] Recall measurement re-run.
