---
'@blackunicorn/bonklm': patch
---

Code-injection detection no longer flags a Markdown or inline-code backtick span solely because it
contains the bare word `id`. As a standalone token it matches ordinary identifier prose (`event id`,
a `{id}` path parameter, a `--tenant=$ID` flag, an XML `id="…"` attribute) far more often than a
genuine backtick command substitution, so its presence in the backtick keyword list produced false
positives on benign documentation, agent-log frames, and few-shot templates without adding real
detection. Genuine command substitution is unaffected: the unambiguous `$(id)` form, backtick spans
carrying any other dangerous command (`` `cat /etc/passwd` ``, `` `rm -rf …` ``, a destructive
`` `dd if=…/of=…` ``), and all other shell-metacharacter, network-egress, and dynamic-execution
patterns continue to block.
