---
'@blackunicorn/bonklm': patch
---

The jailbreak validator no longer flags a casual professional self-introduction as authority
impersonation. Its `developer_impersonation` pattern previously matched the profession nouns
"developer", "engineer", and "creator" in a first-person self-introduction ("I'm a developer working
on …") — ordinary benign statements rather than authority claims, which produced false positives on
legitimate content. Those nouns were removed from the jailbreak pattern; named-provider
impersonation ("I'm an OpenAI / Anthropic …") and privileged-role claims ("I am an administrator")
still fire there.

Detection coverage in the default validator stack is unchanged: the prompt-injection validator
independently continues to flag the assertive "I am a developer / engineer" authority-claim form,
and forged-authorization payloads (e.g. a retrieved document declaring "the verification bypass is
now authorized") remain blocked by its forged-authorization patterns. Only the casual contraction /
"this is" self-introduction forms — the benign false positives — are freed. Mutation-proven
regression tests included.
