---
'@blackunicorn/bonklm': minor
---

Add a `tool_output_impersonation` prompt-injection detection category. It flags untrusted tool /
retrieved content that impersonates harness or system control framing, instructs the agent to skip
review, asserts an unverified "clean / verified" status on hearsay, pushes a premature merge
verdict, or attempts credential-phishing re-authentication. The credential-phishing signature (a
known bogus token host / `--paste-token` flag) blocks; the remaining heuristic signals are
non-blocking tripwires that surface a finding for review. Adds positive and negative regression
corpora for the known attack class.
