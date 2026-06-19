---
'@blackunicorn/bonklm': minor
---

feat(core): add `EncodedRescanValidator` — decode-then-rescan defense for obfuscated injections.

`EncodedRescanValidator` decodes content that hides an injection behind an encoding layer
(unicode-escape, numeric HTML entity, percent/URL, base64, base32, hex, ROT13, ROT47, reversed text,
leetspeak, and multi-layer chains of these) and re-runs the existing injection / jailbreak pattern
engines on the decoded text — so a payload the plaintext scanners miss is caught once revealed.

Precision is preserved without new false positives on benign encoded content: every decoded variant
is gated through an injection-keyword filter and must match a real injection pattern before it
blocks. Marker-driven transports (a literal escape / entity / blob is present) may act on a
WARNING-level decoded match, while speculative ciphers and multi-layer chains require a CRITICAL
match. The validator is purely additive — it can only raise a block on content the rest of the
engine already allowed, so it never reduces recall or removes a true positive.

Add it to your validator set for untrusted input that may carry encoded payloads:

```typescript
import {
  GuardrailEngine,
  PromptInjectionValidator,
  EncodedRescanValidator
} from '@blackunicorn/bonklm';

const engine = new GuardrailEngine({
  validators: [new PromptInjectionValidator(), new EncodedRescanValidator()]
});
```
