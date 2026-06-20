---
'@blackunicorn/bonklm': patch
---

fix(core): stop counting AI-vendor names as authority claims in the jailbreak heuristic

Refines the `multiple_authority_claims` jailbreak heuristic so AI-vendor nouns (`anthropic`,
`openai`) no longer contribute to its authority-term count. Those names co-occur in ordinary benign
content — neutral model comparisons, provider-tooling docs, and technical write-ups that name more
than one vendor — and tripped the count threshold with no attack context, producing false positives.

The heuristic now counts only privileged-ROLE impersonation terms
(`administrator`/`sysadmin`/`superuser`). Genuine named-vendor impersonation ("I am an Anthropic
developer", "I'm an OpenAI researcher") is unaffected: it is caught precisely by the dedicated
`developer_impersonation` jailbreak pattern and the PromptInjection `authority_claim` pattern.

Net effect is a precision improvement (fewer false positives on benign multi-vendor content), with
the dedicated impersonation detectors unchanged.
