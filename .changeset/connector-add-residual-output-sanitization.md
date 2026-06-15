---
'@blackunicorn/bonklm': patch
---

The `bonklm connector add` command now hex-escapes ANSI / control / bidi / line-separator characters
in its remaining human-readable output paths: the echoed connector id in the invalid- and
unknown-connector messages, the existing-credential display (including the edge characters that
masking preserves), and ERROR-code wizard messages. This completes the human-path sanitization
already applied to the command's connection-test and catch-all error output, bringing it in line
with the sibling `connector test` / `connector remove` commands. Normal output is unchanged
(CWE-117).
