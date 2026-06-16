---
'@blackunicorn/bonklm': patch
---

core: harden `sanitizeLogString` (and thus `sanitizeMeta`) against zero-width / Unicode-format log
injection.

The canonical CWE-117 log-sanitization primitive now hex-escapes the zero-width / Unicode-format
character class — U+061C, U+200B–U+200F, U+2060–U+2064, and U+FEFF — to `\uNNNN` markers, alongside
the control, newline / line-separator, and bidi-override/isolate classes it already neutralized.
These code points render as nothing yet survive in the byte stream, so an attacker-influenced string
could previously smuggle invisible content into a log line (homoglyph / zero-width spoof) or wedge a
naive Unicode-aware log parser. Hex-escaping preserves forensic signal. The fix is inherited by
every connector and engine log sink that routes attacker-influenced strings through the shared
primitive; legitimate Unicode log content (accented Latin, CJK, emoji) is unaffected.
