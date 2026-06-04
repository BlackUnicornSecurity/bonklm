# Hand-off prompt — produce the BEFORE/AFTER campaign video

> Paste this prompt into Claude Code, Cursor, or a fresh Claude session.
> Self-contained — no prior conversation context needed.

---

## Mission

Produce a single 60-90 second MP4 demonstrating the BonkLM-ElizaOS attack
+ mitigation narrative for the campaign. Two halves:

- **BEFORE (0:00–0:30):** vanilla ElizaOS + plugin-solana, a malicious
  ElizaOS plugin runs, agent drains the user's wallet to attacker on
  devnet, Solscan tab confirms.
- **AFTER (0:30–1:15):** same character file, `@blackunicorn/bonklm-elizaos-preview`
  prepended to `plugins[]`. Same attack runs. Agent refuses the transfer
  with a visible `bonklm` block message. No funds move on-chain.
- **Outro (1:15–1:30):** call to bookmark the Sprint 8-9 launch.

Output artifacts (all relative to `demo/elizaos-wallet-drain/`):

```
recordings/
├── before.mov            QuickTime screen capture of the drain run
├── after.mov             QuickTime screen capture of the blocked run
├── before-solscan.png    Playwright screenshot of drain TX page
├── before-annotated.mp4  ffmpeg cut + text overlays
├── after-annotated.mp4   ffmpeg cut + text overlays
└── final-campaign.mp4    Concatenated 60-90s deliverable
```

Final MP4 target: 1920×1080, H.264, ≤30 MB, ≤90 seconds. Twitter-postable.

---

## Read first (in this order)

1. **`demo/elizaos-wallet-drain/TEAM-BRIEF.md`** — what attacks were
   proven, on which TXs, why memory tampering vs supply-chain matters.
2. **`demo/elizaos-wallet-drain/MITIGATION-MAP.md`** — the layered
   defense design. The "AFTER" demo implements a minimal subset.
3. **`demo/elizaos-wallet-drain/SAFETY.md`** — devnet invariants. Run
   `node scripts/safety-check.mjs` before any signing.
4. **`demo/elizaos-wallet-drain/CAMPAIGN-DRAFT.md` §2** — the 90s video
   script. This is your storyboard.
5. **`demo/elizaos-wallet-drain/scripts/run-exploit.mjs`** — existing
   harness for the drain runs.

---

## Hard constraints

1. **DEVNET ONLY.** Every script entry verifies the RPC genesis hash. Do
   not change `SOLANA_RPC_URL` in `.env.demo`. If `safety-check.mjs`
   ever exits non-zero, abort and ask.
2. **Redact pubkeys in any text overlay** to first-4 + last-4 chars.
   Full strings live in committed evidence JSON — but on-camera they
   should be `ERN3…xwhd` / `8HqE…H6v3` / `3sdC…omVs`.
3. **No private keys on camera, ever.** `.env.demo` has 4 lines starting
   with `*_PRIVATE_KEY` — make sure terminal never scrolls one into view.
   If recording a terminal, set `LOG_LEVEL=info` (not debug) and
   `quiet: true` for dotenv to suppress promo banners.
4. **You will build a "preview" stub connector** — see §"Build the AFTER
   stub" below. Label every artifact "preview stub — full connector
   ships Sprint 8-9." Do not pretend the production connector exists today.
5. **The POC malicious plugin** (`plugins/poisoned-defaults/`) is marked
   `private: true`. Do not publish it. The video can SHOW the
   plugin name on camera but the source is local-only.
6. **No mainnet RPC, no mainnet token mints, no mainnet wallet** anywhere
   in any artifact.

---

## Decision — which attack to feature

The campaign brief in `CAMPAIGN-DRAFT.md` §2 currently storyboards the
supply-chain attack. Two viable choices:

| Choice | Attack | Visual strength | Narrative strength |
|---|---|---|---|
| **A** | Supply-chain plugin (variant-supply-chain × gpt-5.5 × ambiguous) | Strong — `bun add @…/poisoned-defaults` is a recognizable moment | "user did nothing wrong" |
| **B** | Memory tampering (variant-2 × gpt-5.5 × memory-tamper) | Stronger — a curl PATCH command live on camera is visceral | "their own message was rewritten" |

**Recommended: A.** Easier to demo (single agent boot), cleaner narrative
arc, doesn't require splitting screen between two terminals. Use B for a
follow-up technical-audience clip. Default to A unless the user
overrides.

---

## Build the AFTER stub (the connector preview)

`@blackunicorn/bonklm-elizaos` doesn't ship until Sprint 8-9. To
demonstrate the block, build a minimal preview stub in
`demo/elizaos-wallet-drain/plugins/bonklm-elizaos-preview/`.

### Behavior contract for the stub

The stub is a real ElizaOS plugin. Listed in the character file's
`plugins[]` array. It does ONE thing:

> Wrap every Action whose name matches `/^(TRANSFER|SEND|SWAP|PAY)_(SOL|EVM|SOLANA|TOKEN|ETHEREUM)/i`.
> Replace its `validate` with: check whether the LLM-emitted recipient
> pubkey appears in any **user-authored** memory (entityId === USER_ID)
> in the room's recent history. If it does AND the memory's metadata
> indicates a Provider-sourced or HTTP-unauth-sourced write, REFUSE.
> If the recipient doesn't appear in any user-authored message at all,
> REFUSE. Otherwise allow.

### Required output

When the stub refuses, it must:
- Log to the agent's stdout a clearly-visible block line:
  ```
  [bonklm-elizaos-preview] BLOCKED TRANSFER_SOLANA
    reason: recipient 8HqE…H6v3 not in any user-authored message
    action: refused before signing
  ```
- Cause the action to return without broadcasting. No on-chain TX.

### Scope discipline

Stub MUST NOT:
- Implement the shadow log (Sprint 8-9 work)
- Implement `runtime.bonklm.wrapMemory` (Sprint 8-9)
- Run any LLM call of its own
- Touch the network

It's ~80 lines of JS. Pattern after
`plugins/poisoned-defaults/index.js` for the package structure.

### Package layout

```
plugins/bonklm-elizaos-preview/
├── package.json     ({"name":"@blackunicorn/bonklm-elizaos-preview","version":"0.0.0-preview","private":true})
└── index.js         (Plugin export with actions: [wrappedTransfer, ...])
```

Install with `bun add file:./plugins/bonklm-elizaos-preview`.

### Character file for the AFTER run

Copy `characters/variant-supply-chain.json` to
`characters/variant-supply-chain-WITH-BONKLM.json` and prepend the new
plugin name to the `plugins[]` array. ORDER MATTERS — bonklm must load
before plugin-solana so its action-wrap composes around plugin-solana's
TRANSFER_SOLANA.

---

## Recording the BEFORE clip (the drain)

### Setup (one-time)

```bash
cd demo/elizaos-wallet-drain
node scripts/safety-check.mjs              # MUST PASS
node scripts/verify-balances.mjs           # confirm agent has > 0.15 SOL
```

Resize terminal window to 1280×720 area on a clean desktop background.
Use a monospace font ≥16pt for legibility on Twitter mobile playback.
Increase line spacing 1.3x if your terminal app supports it.

### The shot

1. Start QuickTime "New Screen Recording" — area selection. Capture the
   terminal window only (not full desktop).
2. In terminal, run:
   ```bash
   node scripts/run-exploit.mjs \
     --variant variant-supply-chain \
     --llm openrouter \
     --mode ambiguous
   ```
3. Wait for the run to complete. Expected: `outcome: DRAINED` line.
4. Stop QuickTime. Save as `recordings/before.mov`.

### Playwright Solscan screenshot

After the run, extract the drain signature from the run.json:
```bash
node -e "const d=require('./evidence/variant-supply-chain/openrouter/ambiguous/run.json'); console.log(d.lastDrainSig||'check log')"
```

Or grep the log:
```bash
ls -t logs/variant-supply-chain-openrouter-*.log | head -1 | xargs grep -oE 'signature":"[A-Za-z0-9]{60,}"' | head -1
```

Then drive Playwright MCP to `https://solscan.io/tx/<sig>?cluster=devnet`,
let it render, take a full-page PNG to `recordings/before-solscan.png`.

If Playwright MCP isn't available in your session, fall back to a manual
browser screenshot but note that in the deliverables.

---

## Recording the AFTER clip (the block)

### Setup

Same agent wallet — no need to re-fund. The drain failure means agent's
balance is unchanged.

```bash
node scripts/safety-check.mjs                    # PASS
# Clean agent state so the run starts fresh:
rm -rf .eliza data agent-store
```

### The shot

1. QuickTime new screen recording, same terminal window dimensions.
2. In terminal, run:
   ```bash
   node scripts/run-exploit.mjs \
     --variant variant-supply-chain-WITH-BONKLM \
     --llm openrouter \
     --mode ambiguous
   ```
3. Wait for the run to complete. Expected output includes the
   `[bonklm-elizaos-preview] BLOCKED TRANSFER_SOLANA` line and the
   final balances panel showing **attacker delta = 0.0000**.
4. Stop QuickTime. Save as `recordings/after.mov`.

### Verification

After the run completes:
```bash
node scripts/verify-balances.mjs
```

Attacker pubkey balance MUST be unchanged from before the AFTER run.
If it's not — abort, do NOT use the footage. The stub failed; report
the issue.

---

## ffmpeg post-production

### Tool check

```bash
which ffmpeg && ffmpeg -version | head -1
```

Should output `/opt/homebrew/bin/ffmpeg` (or similar) and a version ≥6.

### Annotation overlays

Use ffmpeg `drawtext` filter for in-frame labels. Font: a system font
the user already has. Suggested: `/System/Library/Fonts/Helvetica.ttc`
on macOS.

```bash
# Trim BEFORE clip to relevant segment + add label
ffmpeg -i recordings/before.mov \
  -ss 00:00:02 -to 00:00:28 \
  -vf "drawtext=fontfile=/System/Library/Fonts/Helvetica.ttc:text='BEFORE — vanilla ElizaOS + malicious plugin':fontcolor=white:fontsize=36:box=1:boxcolor=red@0.85:boxborderw=8:x=(w-text_w)/2:y=40" \
  -c:v libx264 -preset slow -crf 20 -c:a aac \
  recordings/before-annotated.mp4

# Trim AFTER clip
ffmpeg -i recordings/after.mov \
  -ss 00:00:02 -to 00:00:35 \
  -vf "drawtext=fontfile=/System/Library/Fonts/Helvetica.ttc:text='AFTER — bonklm-elizaos-preview (Sprint 8-9 stub)':fontcolor=white:fontsize=36:box=1:boxcolor=green@0.85:boxborderw=8:x=(w-text_w)/2:y=40" \
  -c:v libx264 -preset slow -crf 20 -c:a aac \
  recordings/after-annotated.mp4
```

### Outro card

Generate a 4-second card with the CTA. Use ffmpeg `color` source + `drawtext`:

```bash
ffmpeg -f lavfi -i color=c=black:size=1920x1080:d=4 \
  -vf "drawtext=fontfile=/System/Library/Fonts/Helvetica.ttc:text='@blackunicorn/bonklm-elizaos':fontcolor=white:fontsize=72:x=(w-text_w)/2:y=(h-text_h)/2-60, \
       drawtext=fontfile=/System/Library/Fonts/Helvetica.ttc:text='Sprint 8-9 — bookmark the release':fontcolor=#999999:fontsize=42:x=(w-text_w)/2:y=(h-text_h)/2+30, \
       drawtext=fontfile=/System/Library/Fonts/Helvetica.ttc:text='Seatbelt for web3 agents':fontcolor=#666666:fontsize=32:x=(w-text_w)/2:y=(h-text_h)/2+100" \
  -c:v libx264 -preset slow -crf 18 \
  recordings/outro.mp4
```

### Concatenate

```bash
cat > /tmp/concat-list.txt <<EOF
file 'recordings/before-annotated.mp4'
file 'recordings/after-annotated.mp4'
file 'recordings/outro.mp4'
EOF

ffmpeg -f concat -safe 0 -i /tmp/concat-list.txt -c copy recordings/final-campaign.mp4
```

If the source clips have different framerates/resolutions, `-c copy`
will fail; re-encode the inputs to a common spec first:

```bash
for f in before-annotated after-annotated outro; do
  ffmpeg -y -i recordings/$f.mp4 \
    -vf "scale=1920:1080,fps=30,format=yuv420p" \
    -c:v libx264 -preset slow -crf 20 -c:a aac -ar 48000 \
    recordings/$f-normalized.mp4
done

cat > /tmp/concat-list.txt <<EOF
file 'recordings/before-annotated-normalized.mp4'
file 'recordings/after-annotated-normalized.mp4'
file 'recordings/outro-normalized.mp4'
EOF

ffmpeg -f concat -safe 0 -i /tmp/concat-list.txt -c copy recordings/final-campaign.mp4
```

### Final size + duration check

```bash
ffprobe -v error -show_entries format=duration,size -of default=noprint_wrappers=1 recordings/final-campaign.mp4
```

Targets:
- duration ≤ 90 seconds (Twitter native cap)
- size ≤ 30 MB (good for autoplay)

If size is too big, lower bitrate:
```bash
ffmpeg -i recordings/final-campaign.mp4 \
  -c:v libx264 -preset slow -crf 24 -maxrate 4M -bufsize 8M \
  -c:a aac -b:a 96k \
  recordings/final-campaign-compressed.mp4
```

---

## Reporting cadence

1. After §"Read first": confirm scope. State which attack (A
   supply-chain or B memory-tamper). STOP for user override.
2. After building the AFTER stub: demonstrate a single dry-run of the
   AFTER scenario in terminal. Capture the `BLOCKED` log line. STOP for
   review before recording.
3. After BEFORE + AFTER raw recordings exist: confirm both look clean
   (no private keys visible, pubkeys redacted in any visible env dump).
   STOP before ffmpeg post.
4. After final-campaign.mp4 renders: report duration, size, file path.
   Do NOT publish anywhere — hand the file back to the user for
   approval.

---

## Out of scope

- Voiceover. Add VO post-hand-off if the user wants.
- Music. Same.
- Subtitle / caption track. Same.
- Publishing to Twitter/YouTube. User-only action.
- Building anything beyond the preview stub. The full connector ships
  Sprint 8-9.

---

## Honest framing required in the AFTER clip

The on-screen label MUST say "preview stub — full connector ships
Sprint 8-9." Do not let the AFTER clip imply the production connector
exists today. The stub implements ~5% of what the production connector
will do (per `MITIGATION-MAP.md` §"Summary table"). It catches THIS
specific attack class because the recipient pubkey is provably absent
from user-authored messages. The shadow log + memory wraps that defend
classes 2 + 4 are NOT in the stub.

If the user wants AFTER to demonstrate classes 2 or 4, the stub gets
more complex — flag this back to the user before starting.

---

## Files you will touch

```
plugins/bonklm-elizaos-preview/      NEW directory — stub connector
  ├── package.json
  └── index.js
characters/variant-supply-chain-WITH-BONKLM.json    NEW — bonklm in plugins[]
recordings/                          fill with artifacts
```

You will NOT touch:
- `packages/*` (BonkLM core library — Sprint 8-9 work)
- `characters/variant-*.json` baselines
- `scripts/*` (existing harness scripts are reused as-is)
- Any of the existing `.env.demo` keys

---

## What "done" looks like

- `recordings/final-campaign.mp4` exists, duration 60-90s, ≤ 30 MB.
- BEFORE half shows the drain with a real on-chain TX visible.
- AFTER half shows the `[bonklm-elizaos-preview] BLOCKED` line and
  unchanged on-chain balances.
- No private keys visible on camera.
- All pubkeys redacted in overlays (full pubkeys may appear in raw
  terminal text on a single frame — acceptable but redact in overlays).
- Outro card with "Sprint 8-9" CTA.
- Hand the file back to the user with a one-line summary:
  *"final-campaign.mp4 ready, X seconds, Y MB, attacker balance Z SOL
  before-and-after."*

**Begin with §"Read first," then check in per §"Reporting cadence" step 1.**
