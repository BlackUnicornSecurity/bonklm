---
'@blackunicorn/bonklm': patch
---

Detect invisible Unicode Tags-block characters (Plane 14, U+E0000–U+E007F) used for covert
instruction injection. These characters mirror ASCII but render to no glyph, letting an attacker
smuggle directives past human review while byte-level model tokenizers still read them. The
PromptInjection validator now flags any Tags-block character, while excluding well-formed emoji
subdivision-flag sequences (e.g. 🏴󠁧󠁢󠁳󠁣󠁴󠁿) so legitimate flag emoji are not affected.
