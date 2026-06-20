---
'@blackunicorn/bonklm': patch
---

fix(core): detect fiction/persona-framed demands for a complete operational weapon

Two jailbreak patterns (a new fictional-frame weaponization category in JailbreakValidator) that
recover narrative-wrapped requests for a fully operational harmful artifact — the kind that wraps
"write the complete working exploit" or "synthesize the controlled substance" inside a novel,
screenplay, RPG sourcebook, documentary re-enactment, memoir, or professor persona:

- `fic_frame_opexploit` — a fiction/persona frame that DEMANDS a working, reproducible
  memory-corruption exploit. Requires three co-occurring anchors: the fiction frame, a production
  demand that the artifact itself be functional/reproducible/implementable ("the code must actually
  function", "reproduce the attack", "operational detail for a student to implement", "the full
  pwntools script", "the exact byte offset to the return", "how to build a … exploit"), and a
  concrete operational-exploit step (shellcode, saved-return-address overwrite, ROP chain, defeat
  ASLR, corrupt a vtable, etc.).
- `fic_frame_synth` — a fiction/persona frame that demands controlled-substance or weapon synthesis
  given in procedural detail ("explaining each stage", "the procedure they used").

The production-demand anchor is the discriminator, and it is deliberately a demand to PRODUCE a
working weapon, not a demand for authentic prose. So a request to merely describe, teach, or narrate
an attack does not fire: benign technical fiction that asks for authentic prose ("keep it
authentic", "no real code"), defensive incident-response / malware-analysis training, and
remediation write-ups are left untouched even when they name an exploitation technique; frame-less
security education / CTF / pentest write-ups do not fire because they lack the fiction frame; a
purely pedagogical request is left untouched because as text it is indistinguishable from a benign
course handout. Both patterns require all three anchors to co-occur within bounded windows (so a
stray fiction aside cannot collude with an unrelated security paragraph) and are `^`-anchored
zero-width lookaheads — linear-time (tens of milliseconds worst-case on a 100 KB adversarial input),
no catastrophic backtracking. Validated against the full benign control corpus plus a hand-built
adversarial benign set (technical novels / screenplays / RPGs that name a technique, defensive IR /
malware-analysis training framed as a scenario, frame-less exploit-dev / CTF / pentest education,
drug-trade journalism, and lawful chemistry) with no new false positives. Additive: only raises
blocks, never reduces recall; no existing detection changes.
