---
'@blackunicorn/bonklm': patch
---

Tuned the prompt-injection and jailbreak heuristics to substantially reduce false positives on
benign structured and plain content. The jailbreak `spaced_characters` obfuscation pattern now
requires actual whitespace between letters, so ordinary words such as "ignore"/"bypass" in normal
prose no longer trip it; fuzzy keyword matching is restricted to distinctive terms and skips
inflections and length-mismatched tokens, so common English words no longer collide with jailbreak
keywords; the authority-claim heuristic no longer counts generic job words (e.g. "developer",
"engineer"). The prompt-injection role/XML/JSON structured-content patterns were narrowed to genuine
instruction-injection markers, and the "heavy Unicode obfuscation" signal now requires actual
non-ASCII characters, so pretty-printed ASCII JSON is no longer mis-flagged. Detection of real
prompt-injection and jailbreak attempts is preserved, with added regression coverage for both the
benign-pass and the still-blocking cases.
