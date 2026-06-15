---
'@blackunicorn/bonklm-qdrant': patch
---

Harden the qdrant connector's payload-filter log and error sinks against control-character (CWE-117)
log injection. A retrieved-point payload field name could reach the `filterPayload` regex-path log
entries unescaped; that field name — along with the remaining filter-validation log/throw boundaries
in the guarded client — is now routed through the shared log-sanitizer before it reaches a logger or
a thrown error message, so attacker-influenced content can no longer carry raw newlines or other
control bytes into a consumer's logs. Added regression coverage for the known attack class.
