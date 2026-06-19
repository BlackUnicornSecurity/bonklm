---
'@blackunicorn/bonklm': patch
---

Gate the jailbreak `homoglyph_substitution` rule to spans that contain a non-ASCII codepoint,
mirroring the gate already applied to `heavy_obfuscation`. Benign prose that mentions the plain
English word "jailbreak" (security-research notes, reading lists, methodology sections) no longer
triggers a homoglyph finding, while genuine Cyrillic / Greek look-alike substitutions inside the
matched span continue to block.
