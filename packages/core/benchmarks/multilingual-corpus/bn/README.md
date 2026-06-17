# Bengali (bn) — Multilingual Corpus

**Status**: seed corpus (Pass 2). Native-speaker review pending — `curator: "claude-opus-4.7-seed"`
on all entries.

**Script**: Bengali (বাংলা). Left-to-right. **Speakers**: 270M+ native + L2. **Patterns added**: 4
(system_override / constraint_removal / mode_switching / role_hijacking). **Hand-off**: native
reviewer signs off; curator field updated; jailbreak + reformulation_trigger backfill.

## Patterns

- `bn_system_override` — ignore/forget previous instructions.
- `bn_constraint_removal` — remove/disable safety rules.
- `bn_mode_switching` — switch to developer/admin/unlimited mode.
- `bn_role_hijacking` — you are now / pretend to be.

## Known limitations

- 4 categories only. No jailbreak / reformulation per language yet.
- Seed translations may not be idiomatic for native speakers.
- No romanized (Latin-script) Bengali variant.
