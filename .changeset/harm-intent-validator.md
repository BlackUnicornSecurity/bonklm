---
'@blackunicorn/bonklm': minor
---

feat(core): add HarmIntentValidator — deterministic harm-goal intent detection

Adds a new content-surface validator, `HarmIntentValidator`, to the GA bundle. It recognises two
intent classes that the surface-pattern validators miss because they carry no single keyed token —
they are wrapped in narrative/persona, multi-turn decomposition, few-shot priming, back-translation,
or token/base64 obfuscation:

- **exploit-generation** — a request to produce a _working_ offensive / code-execution primitive (an
  exploit, shellcode, a reverse/bind shell, a weaponized payload), recognised by the co-occurrence
  of a "produce" verb, an offensive artifact, and a working-primitive / code-execution signal across
  several de-obfuscated views of the input;
- **restricted-synthesis** — an actionable request to produce a controlled / restricted / dangerous
  substance.

Detection is fully deterministic (same input → same verdict), edge-portable (no Node `Buffer`), and
purely additive in the engine — it only ever raises a block, so it cannot reduce recall or remove a
true positive. Findings carry only static library constants; no input text enters findings or logs.

Precision is enforced by directional, governing co-occurrence guards so a defender's deliverable —
"write a rule to **detect** a reverse shell", "build a **rootkit detector**", "**disassemble** this
captured trojan", "a **legal brief on** the manufacture of a controlled substance" — is not flagged,
while an explicit code-execution goal or a step-by-step synthesis request is never excused by such a
frame. Exported as `HarmIntentValidator` / `validateHarmIntent` / `detectHarmIntent`.
