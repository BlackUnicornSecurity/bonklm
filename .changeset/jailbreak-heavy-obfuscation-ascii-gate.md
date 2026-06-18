---
'@blackunicorn/bonklm': patch
---

Jailbreak detection no longer raises a "heavy text obfuscation" warning on whitespace-heavy
plain-ASCII content (for example pretty-printed JSON or deeply indented configuration). Such content
shrinks during normalization but is not obfuscated; the detection is now gated on the presence of an
actual non-ASCII character — matching the gate the prompt-injection validator already applies — so
genuine homoglyph / zero-width / combining-mark obfuscation still blocks while benign structured
text no longer produces a false positive.
