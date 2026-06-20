---
'@blackunicorn/bonklm': patch
---

fix(core): catch label-free typed constraint-removal and "relax your guidelines" directives

Two label-free constraint-removal patterns that complement the forged-`SYSTEM OVERRIDE`-label
detector, recovering injection forms the qualifier-gated `ignore_instructions` /
`ignore_all_instructions` / `constraint_removal` set misses, without adding false positives on
ordinary technical, legal, medical, or instructional prose:

- `constraint_removal_typed` — a removal verb + the **required** `all` totality quantifier + a typed
  control noun the base set omits
  (`security`/`content`/`fairness`/`neutrality`/`equality`/`ethical`/ `moral`). The `all` marker
  separates the attack ("ignore all security protocols") from technical prose ("disable security
  checks in dev", "override security checks now require MFA").
- `relax_own_guidelines` — `relax`/`loosen`/`lower`/`ease`/`drop`/`lift` + the **required**
  second-person `your` + `guidelines`/`guardrails`, so legal/medical prose ("the court lifted
  restrictions", "the nurse will ease your restrictions") does not fire.

Both are negation-guarded and ReDoS-safe (bounded windows, fixed-width lookbehinds), and validated
false-positive-free against the full benign control corpus (including a two-round precision review's
adversarial benign set). Additive: only raises blocks, never reduces recall; no existing detection
changes.
