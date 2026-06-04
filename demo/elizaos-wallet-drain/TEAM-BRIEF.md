# BonkLM-ElizaOS pre-launch evidence — team brief

**Date:** 2026-05-21
**Author:** Schen Long (with Claude harness)
**Audience:** BonkLM dev + leadership, BU security team
**Status:** Pre-launch evidence package complete. Connector ships Sprint 8-9.
**Required action:** Read §6 — there are upstream-disclosure and Story 1.8 AC
changes that need owners before campaign launch.

---

## 1. TL;DR

We tried to drain a wallet from a vanilla ElizaOS 1.7.2 agent loaded with
plugin-solana 1.2.6 across **7 character variants × 3 modern LLMs × 2 user
message styles = 42 baseline runs** plus targeted exploits. Result:

- **0 of 42 bio-injection baseline runs drained funds to the attacker.**
  Modern LLMs (openai/gpt-5.5, claude-sonnet-4-6, qwen3.6:35b-a3b-q8_0) resist
  bio poisoning when the secondary LLM extraction layer is intact. This is an
  honest, non-obvious finding that we lead with.
- **4 of 4 targeted attacks drained successfully.** All four are on devnet
  with paired memo transactions carrying the BonkLM tagline.

The four working attacks expose **two pre-existing CVE-grade misconfigs in
vanilla ElizaOS** that have nothing to do with prompt injection per se —
they're authentication gaps on the local HTTP API. We will need to disclose
these upstream while the campaign goes live.

**Bottom line for the Sprint 8-9 connector:** the original Story 1.8 AC
("blocked at Action.validate") is **necessary but insufficient.** We need
three more ACs added (§7). The biggest one is an append-only shadow log —
without it, our action-boundary validator can be defeated by simply
mutating the persisted memories the validator reads.

---

## 2. Scope of what we tested

| Layer | Versions / providers |
|---|---|
| ElizaOS core | `@elizaos/core@1.7.2` (npm `latest` as of 2026-05-21) |
| Plugin-solana | `@elizaos/plugin-solana@1.2.6` |
| LLM matrix | `openai/gpt-5.5` via OpenRouter, `claude-sonnet-4-6`, local Ollama `qwen3.6:35b-a3b-q8_0` on Spark3 |
| Chain | Solana devnet only. Genesis-hash verified at every script entry. No mainnet touched. |
| Wallets | Three fresh devnet keypairs generated for this session: AGENT `ERN3…xwhd`, ATTACKER `8HqE…H6v3`, RECIPIENT `3sdC…omVs`. |
| Funding | 5 SOL agent wallet from `faucet.solana.com`, GitHub-auth path. |

Baseline matrix (42 runs):
- 4 bio-injection variants (obvious / steganographic / delayed-trigger-rules / multilingual+base64)
- 3 bonus variants (knowledge, messageExamples, system-prompt poisoning)
- 2 user-message styles: explicit (address typed) + ambiguous ("send to my friend")
- 3 LLMs per cell

---

## 3. The architectural finding (good news)

`plugin-solana`'s `TRANSFER_SOLANA` action handler makes a **SECONDARY LLM
call** with the `transferTemplate` template. That template only references
`{{recentMessages}}`, which expands to **user-authored messages in the
current DM room only**. The character `bio`, `knowledge`, `messageExamples`,
and `system` fields are not in the secondary call's context.

So bio injection alone — the lazy "ElizaOS is trivially drainable" pitch —
**does not actually drain modern LLMs.** We tested it 21 ways. None drained.

This is an architectural property worth shouting about in the campaign. It
also tells us where the real attack surface is: anything that lands the
attacker pubkey **inside a user-authored message in the current DM room**.

---

## 4. The four working attacks (on-chain receipts)

All wallets and signatures below are devnet. Solscan links live in
`evidence/MATRIX.md` and `MITIGATION-MAP.md`.

### Class 1 — Phishing (de-emphasize publicly)
- **TX:** `2jqv7cg2…sDTh9`
- User pastes attacker-supplied phishing copy that contains the attacker
  pubkey. Lame attack. Mention in passing only.

### Class 2 — Unauthenticated API memory INJECTION ⚠️ CVE-grade
- **TX:** `5DPhVeH2…u3yzm`
- ElizaOS's local HTTP API has no authentication by default. Attacker on
  the same LAN, behind a misconfigured proxy, via SSRF, or from a malicious
  browser tab can `POST /api/messaging/sessions/:sessionId/messages` with
  `author_id` of the legitimate user. Server treats it as a real user
  message. Plants in the DM room. Drains.
- The `transport: "http"` field in the body is the critical routing key.
- **Recipe:** one curl command.

### Class 3 — Supply-chain plugin
- **TX:** `ZijauV7S…BGUg`
- POC plugin at `plugins/poisoned-defaults/`. Provider's `get()` runs on
  every `composeState` and calls `runtime.createMemory` to plant a fake
  user message attributed to the user's entity_id in the current room.
- User typed nothing. No API was exposed. They just installed the plugin.
- Realistic threat: ElizaOS plugin marketplace has no signing or audit.
  Typo-squatting and compromised registry entries are realistic vectors.

### Class 4 — Memory TAMPERING ⚠️⚠️ Worst class
- **TX:** `E5QZwAT4…tyQ6v`
- `PATCH /api/agents/:agentId/memories/:memoryId` is **also**
  unauthenticated. Attacker enumerates memories via `GET
  /api/agents/:agentId/memories`, finds the user's legitimate transfer
  request, and PATCHes `content.text` to swap the recipient pubkey.
- The corrupted memory keeps the user's `entity_id`, `room_id`, original
  `created_at` timestamp. After tamper, the persisted record says the user
  asked for the attacker address.
- **Defeats any post-hoc validator that asks "did the user say this
  address?"** because the answer is yes, per the (silently rewritten)
  record. Only sound defense: an independent append-only log the attacker
  can't reach.

Every drain has a paired memo TX with: *"a warrior has fallen - BonkLM:
Data smashing Solution. drain=<sig>"* anchored on devnet.

---

## 5. Two upstream bugs we patched locally to unblock the demo

These are NOT BonkLM's responsibility to fix but block the campaign blog's
"vanilla ElizaOS" claim if not disclosed. **We should file these upstream
the same day the campaign goes live.**

1. **`parseJSONObjectFromText` null-string coercion** in `@elizaos/core`.
   Returns the string `"null"` instead of JSON `null`. Causes
   `plugin-solana`'s SOL transfers to fail with "Non-base58 character"
   because `content.tokenAddress === null` strict-equality fails and the
   SPL-token branch tries `new PublicKey("null")`. **Vanilla ElizaOS
   cannot transfer SOL at all** without our 1-line patch in
   `plugins-solana/dist/index.js`.

2. **`sessions.sendMessageSync` returns `{}` to api-client.** HTTP-mode
   sync responses are empty even though the agent processes the message
   correctly. Every consumer using this method gets a useless return
   value. Our harness works around it by parsing agent stdout + the DB.

The campaign blog has a "Pre-existing vanilla-ElizaOS bugs we surfaced"
section disclosing both. We do NOT pretend we ran pristine vanilla.

---

## 6. ACTION ITEMS — needs owners before campaign launch

### Engineering (Sprint 8-9 / Story 1.8 scope)

| ID | Action | Owner | Severity |
|---|---|---|---|
| AC1 | Replace Story 1.8 AC *"blocked at Action.validate"* with *"ToolCallArgsValidator blocks when args.recipient does not appear in any user-authored message"* | TBD | MUST |
| AC2 | Add AC: connector maintains an append-only **shadow log** of user messages (hash-chained, written at MESSAGE_RECEIVED, unreachable from the public API). ToolCallArgsValidator reads from the shadow log, **not** from the mutable `memories` table. **Without this, Class 4 defeats the validator.** | TBD | MUST |
| AC3 | Add AC: connector wraps `runtime.createMemory` and `runtime.updateMemory`. Refuse `type='messages'` writes from Provider source. Refuse `messages` content-mutations from unauthenticated HTTP sources. | TBD | MUST |
| AC4 | Add AC: `bonklm doctor` flags missing `ELIZAOS_API_KEY`, non-loopback bind, missing plugin-signing — surfaces all three at CRITICAL on startup. | TBD | SHOULD |
| AC5 | Add AC: connector wraps `Provider.get()` return values for in-prompt injection scanning. | TBD | SHOULD |

### Upstream disclosure (to `elizaOS/eliza` maintainers)

| ID | Action | Owner |
|---|---|---|
| U1 | File issue + PR: `parseJSONObjectFromText` null-string coercion bug. | TBD |
| U2 | File issue: `sessions.sendMessageSync` returns `{}` to api-client. | TBD |
| U3 | File security advisory: default-no-auth on memory PATCH/GET + sessions POST routes. Recommend default to `127.0.0.1` bind + require explicit `--listen 0.0.0.0`. | TBD — needs coordinated disclosure |
| U4 | Propose: declarative plugin permissions model (`Plugin.permissions: { memory: 'read'|'write'|'none' }`) enforced by runtime. | TBD |

### Campaign / GTM

| ID | Action | Owner |
|---|---|---|
| C1 | Decide disclosure timing: do we coordinate with elizaOS maintainers BEFORE publishing the unauthenticated-API findings, or publish simultaneously? Recommend reaching out 7-14 days ahead of campaign launch. | TBD |
| C2 | Fill in placeholder ecosystem stats in `CAMPAIGN-DRAFT.md` §4 (npm download counts, GitHub stars, plugin counts) — do NOT invent. | TBD |
| C3 | Pick the primary tweet variant. Current draft has 4 options: memory-tamper, supply-chain, API-impostor, architectural. Recommended primary: memory-tamper (most novel, hardest to dismiss). | TBD |
| C4 | Storyboard the 90-second video. Script in `CAMPAIGN-DRAFT.md` §2 features the supply-chain attack — consider switching to memory-tamper as the headline given its severity. | TBD |
| C5 | Bookmark page for `@blackunicorn/bonklm-elizaos` Sprint 8-9 launch. | TBD |

---

## 7. Honest constraints (the campaign must own these)

- **Connector ships Sprint 8-9, not today.** Every campaign asset says so.
- **0 drains on bio-only injection.** We show that openly.
- **One real upstream bug we patched** (`parseJSONObjectFromText` null
  coercion) — without it, vanilla SOL transfers don't work attack-or-no-attack.
  Disclosed in blog + README.
- **No mainnet claim.** Everything is devnet. Same code paths, but the
  on-chain receipts are devnet-only.
- **We tested 3 LLMs, not "every LLM."** No generalization beyond what
  we tested.

---

## 8. Where the artifacts live

Repo: `/Users/paultinp/LLM-Guardrails/demo/elizaos-wallet-drain/`

```
README.md                 Reproduction recipe
SAFETY.md                 Devnet invariants — read first
MITIGATION-MAP.md         Phase E — per-attack pseudocode + 5-row risk register
CAMPAIGN-DRAFT.md         Phase G — tweet variants, 90s script, blog outline
TEAM-BRIEF.md             This document

characters/               7 baseline character variants + variant-supply-chain
plugins/poisoned-defaults/ POC malicious plugin (private:true, NOT for publication)
scripts/                  13 orchestration scripts (sweep, inject, tamper, memo, screenshot)
evidence/
  ├── MATRIX.md / .json   Full result matrix across all 42+4 runs
  ├── variant-2-bio-steganographic/openrouter/
  │   ├── social-eng/             Drain 1 (phishing) + Solscan screenshots
  │   ├── memory-inject-api/      Drain 2 (API impostor) + Solscan screenshots
  │   └── memory-tamper/          Drain 4 (PATCH tamper) + Solscan screenshots
  └── variant-supply-chain/openrouter/ambiguous/   Drain 3 (plugin) + Solscan screenshots
logs/                     Raw ElizaOS stdout per run (gitignored, contains pubkeys)
```

**Devnet wallets state (as of brief publication):**
- AGENT `ERN3…xwhd`: 1.20 SOL
- ATTACKER `8HqE…H6v3`: 0.40 SOL (4 confirmed drains)
- RECIPIENT `3sdC…omVs`: 3.40 SOL (legit transfers from baseline)

**No mainnet exposure. No real funds at risk. All keys ephemeral to this session.**

---

## 9. Open questions for the team

1. **Disclosure coordination:** Do we want to give elizaOS maintainers a
   heads-up before campaign launch on the unauthenticated API gap? Lean
   yes — keeps it a responsible-disclosure story rather than a drive-by.
2. **Lead with which attack?** Memory tampering is the most novel and
   hardest to dismiss. Supply-chain is more relatable. I recommend
   memory-tamper for the technical audience, supply-chain for the
   founder-audience YouTube/Twitter clip. Both belong in the blog.
3. **Sprint 8-9 capacity:** the shadow-log requirement (AC2) is L
   effort, not trivial. If we're capacity-constrained, is the campaign
   pinned to Sprint 8-9 ship date or can it slip a sprint?
4. **bonklm doctor scope:** does the doctor ship in v0.4.0 alongside
   the connector, or is it a separate v0.4.1 deliverable?

---

## 10. What I need from you THIS WEEK

- Story 1.8 AC owner picks up AC1-AC5 and updates `team/plans/2026-05-21-v0.4-v0.7-roadmap-FINAL.md`.
- Security/compliance owner takes U1-U4 (upstream disclosure timing).
- GTM owner takes C1-C5 (decides on disclosure coordination + headline framing + campaign date).
- All: read `MITIGATION-MAP.md`. The four attack classes shape every
  design choice in the connector.
