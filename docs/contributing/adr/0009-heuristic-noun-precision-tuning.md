# ADR-0009: Heuristic noun-precision tuning — count/co-occurrence heuristics shed coincidental catches in favor of precision

> Status: Living document. Scope: internal contributor guide. Records the standing policy for tuning
> the membership of the term lists used by BonkLM's count-based jailbreak heuristics, and the
> discipline required when a tuning change trades recall for precision.

## Problem

Some jailbreak signals are **count / co-occurrence heuristics**: they maintain a flat list of
"suspicious" terms and emit a finding when the input contains at least N of them. The canonical
example is `multiple_authority_claims` (`packages/core/src/validators/jailbreak-heuristic.ts`),
which emits a WARNING when `>= 2` members of an `authorityWords` list appear.

These heuristics are cheap and catch crude term-stacking, but their term lists are prone to drift: a
term that _looks_ authority-related in isolation often co-occurs in ordinary benign prose, where it
trips the threshold with no attack context. Two cases have now surfaced:

- **Profession nouns** (`developer`, `engineer`, `owner`, `creator`) in the
  `developer_impersonation` surface — they appear in firmware bug reports, platform briefs, and
  project descriptions.
- **AI-vendor nouns** (`anthropic`, `openai`) in `authorityWords` — they appear together in neutral
  model comparisons, provider-tooling docs, and technical write-ups that name more than one vendor.

A term that carries no role or imperative semantics on its own does not belong in a pure
co-occurrence counter. Leaving it there produces false positives — the worst failure mode for a
guardrail.

## Decision

**Count/co-occurrence heuristic term lists are restricted to terms that carry the attack's semantics
on their own. Terms whose presence is only weakly correlated with an attack are removed, even when a
small number of genuine attacks were being caught by them — provided that recall is owned elsewhere
or the loss is a coincidental (non-vector) catch.**

Two corollaries:

1. **Named recall lives in dedicated patterns, not in the counter.** Genuine impersonation ("I am an
   Anthropic developer", "I am a developer reviewing code") is matched precisely by the
   `developer_impersonation` jailbreak pattern (`jailbreak-patterns.ts`) and the PromptInjection
   `authority_claim` pattern (`pattern-engine.ts`). Those patterns require a first-person /
   role-assertion frame the bare noun lacks, so they do not false-fire on benign mentions. The
   counter's job is only crude multi-term stacking; it is not the home of named-entity recall.

2. **A coincidental catch is not a detection vector.** When a count heuristic happened to block a
   real attack only because the attack incidentally contained the removed term (not because the term
   was the attack's mechanism), dropping the term sheds a _coincidental_ catch, not a vector. That
   recall belongs to the attack's real detection layer (a dedicated content pattern, or — for
   binding/provenance-shaped attacks — the connector-provenance layer,
   [ADR-0010](./0010-provenance-gated-indirect-injection.md)), to be added as its own increment.

## Discipline required for every such change

A noun-precision tuning change is a behavior change to a security control. It is only "done" with:

1. **Measured impact, not asserted.** A full-corpus before/after disposition diff on two real builds
   (term present vs removed), reporting every fixture whose block disposition changes — the benign
   false-positives freed and any attack catches shed. "It only removes false positives" must be
   _shown_, because as case 2 above proves, it sometimes also sheds coincidental attack catches.

2. **Maintainer ratification when genuine attack catches are shed.** If the diff shows any
   attack-labelled fixture loses its only block path, the precision/recall trade is a value
   judgment, not a technical one. It must be ratified by the maintainer before shipping (e.g. via
   the AskUserQuestion flow), and the shed attacks re-homed to their proper detection layer as a
   tracked follow-up.

3. **ADR-0001 non-vacuity tests, both directions.** A dedicated test file must pin:
   - GATING controls that go RED if the removed term is restored (the benign input would re-fire);
   - PRESERVED controls that go RED if a retained term is removed (a genuine claim stops firing);
   - PRESERVED-RECALL controls that go RED if the dedicated pattern that now owns the recall loses
     its term (proves the named recall did not move with this change).

   `tests/unit/validators/jailbreak-developer-impersonation-gating.test.ts` and
   `tests/unit/validators/jailbreak-vendor-authority-gating.test.ts` are the reference
   implementations.

## Disclosure

Per the project security-disclosure policy, the public artifacts of such a change (source comments,
test comments, changeset, commit/PR text) describe the false-positive class qualitatively and MUST
NOT contain fixture names, finding counts, defect IDs, or remediation timelines. The measured corpus
figures live only in the gitignored internal QA tree.

## Consequences

- The count heuristics become thinner and more precise; some now contribute recall only for the
  rarer multi-term phrasing. This is intended — the dedicated patterns carry the common
  single-entity case.
- Each tuning is reversible and self-documenting: the term list, the comment, the test file, and
  (for ratified recall trades) the internal QA record together explain why each term is or is not
  present.
