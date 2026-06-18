---
'@blackunicorn/bonklm': patch
---

fix(core): make BoundaryDetector confusable/homoglyph delimiter detection work in the standard
engine integration.

`BoundaryDetector`'s confusable-variant scan — which catches homoglyph variants of delimiter tokens
such as a fullwidth `＜／ｓｙｓｔｅｍ＞` or `［／ＩＮＳＴ］` — previously ran only when a caller
passed an explicit second `normalizedContent` argument to `validate(content, normalizedContent)`.
`GuardrailEngine` invokes every validator single-arg (`validate(content)`), so wiring
`BoundaryDetector` into an engine left the advertised `detectConfusableVariants` option (default
`true`) inert and a homoglyph delimiter breakout undetected.

`validate(content)` now derives the normalized form internally when `detectConfusableVariants` is
enabled, so the scan runs in the standard `engine.validate(content)` path. The option is now
authoritative — set `detectConfusableVariants: false` to disable it. Raw exact-token detection,
severity/blocking behaviour, and — when the option is enabled (the default) — the explicit
two-argument API are all unchanged. Confusable detection folds look-alike Unicode via the library's
text normalizer; it complements, and does not replace, the raw delimiter scan.
