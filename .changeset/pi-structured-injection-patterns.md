---
'@blackunicorn/bonklm': patch
---

core: add high-precision prompt-injection patterns for structured / forged-turn injections

Closes three structured-injection detection gaps without re-introducing false positives on benign
structured content:

- a forged `{"role":"system"|"developer","content":"…"}` chat-message turn whose content carries an
  injected directive — legitimate transcripts with a benign system/assistant turn are unaffected,
  and the model's own `assistant` voice is excluded by design;
- a conversation-role tag (`<user>`/`<context>`/`<message>`/…) that wraps an injected directive —
  data-bearing tags such as `<user><name>…</name></user>` are unaffected;
- a bare "ignore all instructions" directive that omits a previous/prior/above qualifier — benign
  phrasings such as "ignore all the comments" and "follow all instructions" are unaffected.

Each pattern is gated on an imperative-directive co-signal so benign API responses, chat
transcripts, and XML/JSON data payloads do not match.
