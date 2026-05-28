# @blackunicorn/bonklm-elizaos

ElizaOS connector for BonkLM — flagship web3-agent guardrails. Wraps `runtime.createMemory` with a
sealed `Object.defineProperty`, intercepts every web3-signing action handler with the
`ToolCallArgsValidator` + two-condition recipient gate, and ships a `bonklm doctor` static-audit
CLI.

## Install

```bash
npm install @blackunicorn/bonklm-elizaos @blackunicorn/bonklm @elizaos/core
```

## Usage — minimal

```ts
import { bonklmPlugin } from '@blackunicorn/bonklm-elizaos';
import { PromptInjectionValidator } from '@blackunicorn/bonklm';

// Register first (priority 1000) so BonkLM seals createMemory before
// any other plugin can install a competing wrap.
runtime.use(
  bonklmPlugin({
    validators: [new PromptInjectionValidator()],
    productionMode: true
  })
);
```

## Construct B — sealed `wrapMemory`

`bonklmPlugin.init` installs a `runtime.createMemory` wrapper via `Object.defineProperty` with
`writable: false, configurable: false`. Hostile plugins cannot unwrap or re-wrap. The wrapper:

- Ignores caller-supplied `memory.source` and recomputes it from closure-captured
  `runtime.bonklm.currentCallContext.sourceTrust`. A Provider plugin literally cannot supply
  `source: 'authenticated'` via arguments — closes the source-spoof attack class.
- Refuses Provider-source writes of `tableName === 'messages'` unless the caller plugin's package
  name is in `VERIFIED_PUBLISHER_ALLOWLIST` (exact-match in Phase-1; Levenshtein typo-squat layer in
  Phase-2).

Trusted call sites use `withCallContext`:

```ts
import { withCallContext } from '@blackunicorn/bonklm-elizaos';

await withCallContext(
  runtime,
  { sourceTrust: 'authenticated', pluginName: '@elizaos/plugin-solana' },
  async () => {
    await runtime.createMemory({ tableName: 'messages', content: { text } });
  }
);
```

## Construct C — Two-condition recipient gate

Every signing action whose name matches the default regex is wrapped. Before the handler runs, the
connector:

1. Runs `createToolCallArgsValidator` on the args tree (Story 1.1's per-leaf tree walker +
   position-stable bypass-resistance).
2. Reads `runtime.getMemories({ roomId, tableName: 'messages' })` and evaluates the two-condition
   gate:
   - BLOCK if `args.recipient` appears ONLY in messages matching a Story 1.1c preference-setting
     pattern, OR
   - BLOCK if `args.recipient` does NOT appear in any user-authored (`source: 'authenticated'`)
     message at all.

Unauthenticated-source memories (`unauthenticated_http`) are excluded from the recipient lookup —
closes RT2 (API impostor inserting a fake user message via the unauthenticated POST route).

### Documented Class-4 limitation

The recipient gate reads `runtime.getMemories(...)`. If the persistence layer is mutated via the
unauthenticated upstream PATCH route, BonkLM reads attacker-controlled data. **Story 2.4a (Sprint
12, v0.5.0)** closes the gap via a shadow-log read primitive (Story 1.3b).

## Construct D — `bonklm doctor` static audit

```bash
npx bonklm-doctor character.json plugins.json
```

Static analysis covers:

- Plaintext-looking secrets in character fields (CRITICAL).
- Weak / missing identity anchor in character system prompt (MEDIUM).
- Plugins not in `VERIFIED_PUBLISHER_ALLOWLIST` (MEDIUM).

`exitCode === 1` whenever any CRITICAL finding is present. CI scripts MUST surface non-zero exit
codes — `|| true` is the documented anti-pattern (audit-loop BC4).

## Phase-2 follow-ups (Story 1.8 backlog + Story 2.4a)

Tracked across the roadmap split:

- **Construct A shadow-log read** (Story 1.3b + 2.4a) — closes the Class-4 PATCH-route attack
  window.
- **`--runtime` mode** in `bonklm doctor` — probes the local agent's HTTP API for unauthenticated
  `/memories` routes.
- **Startup-time HTTP probe** in `bonklmPlugin.init()` — `acknowledgeClass4Risk: true` escape hatch
  when the unauth route is detected.
- **RT5 / RT6 regression tests** — startup-probe + wrapMemory tamper-resistance scenarios. Need a
  runnable `elizaos start` harness.
- **Levenshtein-distance ≤ 2 typo-squat detection** for both Construct B refuse-write AND Construct
  D plugin audit.
- **30-day-post-v0.5.0 EOL flag** in `package.json.deprecated`.
- **Coordinated-disclosure pipeline gate** — `team/upstream-disclosure-status.md` check at RC tag
  time.

## License

MIT
