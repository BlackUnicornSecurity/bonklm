# Urdu (ur) — Multilingual Corpus

**Status**: seed corpus (Pass 2). Patterns landed with RTL bidi-control preprocessing.
Native-speaker review pending — `curator: "claude-opus-4.7-seed"`.

**Script**: Perso-Arabic (اردو). Right-to-left. **Speakers**: 230M+ native + L2. **Patterns added**:
4 (system_override / constraint_removal / mode_switching / role_hijacking). **RTL guard**: input is
bidi-control-stripped via `stripBidiControls` BEFORE regex match.

## Known limitations

- 4 categories only. No jailbreak / reformulation per language yet.
- No Roman Urdu transliteration variant.
- Native reviewer pending — translations may not be idiomatic.

## Hand-off

- Native reviewer signs off.
- Curator field updated to reviewer ID (non-anonymous).
- jailbreak + reformulation_trigger backfill.
- Roman Urdu romanization variant added.
