---
'@blackunicorn/bonklm': minor
---

feat(core): add SocialEngineeringValidator — deterministic social-engineering intent detection

Adds a new content-surface validator, `SocialEngineeringValidator`, to the GA bundle. It recognises
two manipulation classes that the surface-pattern validators miss because the attack lives in the
co-occurrence of signals (a pretext, a pressure tactic, a secret elicitation, an inducement) rather
than in any single keyed token:

- **credential-phishing** — an elicitation directed at a victim-owned secret (a wallet seed /
  recovery phrase, a private key, a 2FA / one-time code, a CVV / PIN / SSN, a password), recognised
  by the directional co-occurrence of an exfil verb moving the victim's secret to the requester,
  across several de-obfuscated views of the input;
- **pretext-coercion** — an impersonation / authority pretext or an urgency / coercion / secrecy
  frame co-occurring with an inducement to an irreversible action (transfer / wire / buy gift cards,
  install remote-access software, connect a wallet, approve a transaction).

Detection is fully deterministic (same input → same verdict), edge-portable (no Node `Buffer` —
base64 views go through the shared codec), and purely additive in the engine — it only ever raises a
block, so it cannot reduce recall or remove a true positive. Findings carry only static library
constants; no input text enters findings or logs.

Precision is enforced by directional, governing co-occurrence guards plus per-signal negation guards
so a defender's deliverable — "write **phishing-awareness training**", "a rule to **flag**
seed-phrase requests", "**detect** a pretext call", "we will **never ask** for your password" — is
not flagged, while an explicit elicitation / coercion goal is never excused by such a frame.
Exported as `SocialEngineeringValidator` / `validateSocialEngineering` / `detectSocialEngineering`.
