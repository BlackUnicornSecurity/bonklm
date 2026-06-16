// SPDX-License-Identifier: Apache-2.0
/**
 * @blackunicorn/bonklm-eko
 * ========================
 * Eko v4 multi-agent connector for BonkLM. Reuses
 * `@blackunicorn/bonklm-browser-agents-core` for the normalised
 * event union (act / extract / observe / agent.execute / file /
 * mcp.tool).
 *
 * Public surface:
 *   - `wrapEko(client, engine, options?)` — wraps an Eko client.
 *     Intercepts `eko.run` (composed_context at task-creation),
 *     walks `eko.agents` registry wrapping BrowserAgent + FileAgent
 *     shapes, and intercepts `eko.mcp.callTool` (validates both args
 *     and result per AC).
 *   - `wrapEkoBrowserAgent(agent, engine, options?)` — direct
 *     BrowserAgent wrap (testing fixtures + non-Eko consumers).
 *   - `wrapEkoFileAgent(agent, engine, options?)` — direct FileAgent
 *     wrap.
 *   - `EkoGuardrailBlockedError` — extends the shared base class.
 *
 * **CUA WARNING** — see `packages/browser-agents-core/README.md`.
 * Eko's screenshot-driven CUA mode is refused unless explicitly
 * opted-in via `allowCuaMode: true`; opt-in emits an unmissable
 * warning at construction.
 */
export { wrapEko, wrapEkoBrowserAgent, wrapEkoFileAgent, EkoGuardrailBlockedError } from './wrap-eko.js';
export type {
  EkoBrowserAgentLike,
  EkoFileAgentLike,
  EkoLike,
  EkoMcpClientLike,
  EkoRunTask,
  WrapEkoOptions
} from './types.js';
