---
'@blackunicorn/bonklm': patch
---

fix(core): detect additional system-prompt delimiter breakout variants in BoundaryDetector

Recovers detection of three families of prompt-boundary breakout that the existing patterns missed,
without re-introducing false positives on benign content:

- closing-tag short forms — `</sys>`, `</inst>`, `</instruction>` — alongside the already-covered
  `</system>` / `</instructions>` / `</context>` / `</prompt>` and `</s>` / `[/INST]`;
- reordered bracketed end markers — `[SYSTEM MESSAGE END]`, `[SYSTEM END]`, `[INSTRUCTIONS END]` —
  the subject-first phrasing of the already-covered `[END SYSTEM]` marker;
- delimited "END OF" markers — `=== END OF SYSTEM PROMPT ===`, `---END OF SYSTEM PROMPT---`,
  `=== END OF INSTRUCTIONS ===` — which the equals/dashed siblings missed because they required the
  `=== SYSTEM END ===` word order. The opening and closing delimiter run must match (`===…===` or
  `---…---`), so an unrelated heading rule cannot collude into a match.

All three are treated as critical-severity breakouts, so they block at the default (standard)
sensitivity. Each pattern is anchored on an explicit system/instruction-termination token with no
benign use; benign prose that merely mentions "the end of the system", uses a `<rules>` config tag,
or carries a mismatched delimiter run is unaffected. Detection-only additions; no behavioral change
to non-matching content.
