# Urdu (ur) — Multilingual Corpus

**Status**: Sprint 17 seed corpus (Story 3.12 Pass 2). Patterns landed Sprint 17 with RTL
bidi-control preprocessing. Native-speaker review pending — `curator: "claude-opus-4.7-seed"`.

**Script**: Perso-Arabic (اردو). Right-to-left. **Speakers**: 230M+ native + L2. **Patterns added**:
4 (system_override / constraint_removal / mode_switching / role_hijacking). **RTL guard**: input is
bidi-control-stripped via `stripBidiControls` BEFORE regex match (Sprint 17 / Story 3.12 R2
closure).

## Known limitations

- 4 categories only. No jailbreak / reformulation per language until Sprint 21+.
- No Roman Urdu transliteration variant.
- Native reviewer pending — translations may not be idiomatic.

## Sprint 21 hand-off

- Native reviewer signs off.
- Curator field updated to reviewer ID (non-anonymous).
- jailbreak + reformulation_trigger backfill per GAP-1/2.
- Roman Urdu romanization variant added.
