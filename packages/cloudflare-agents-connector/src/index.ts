/**
 * `@blackunicorn/bonklm-cloudflare-agents` — Cloudflare Agents
 * (Durable Objects + Workerd) connector for BonkLM (Story 3.8).
 *
 * Subclass-mixin pattern:
 *
 * ```ts
 * import { Agent } from 'agents';
 * import { withBonklmAgent } from '@blackunicorn/bonklm-cloudflare-agents';
 *
 * class MyAgent extends withBonklmAgent(Agent, {
 *   engine,
 *   memoryWriteValidators: [memoryWriteValidator],
 *   retrievedDocValidators: [retrievedDocValidator],
 *   onBlock: (event) => myLogger.warn('bonklm BLOCK', event),
 * }) {
 *   async onMessage(message: string) {
 *     // setState + this.sql + ctx.storage are validated transparently
 *   }
 * }
 * ```
 *
 * **Edge-only**. Uses `@blackunicorn/bonklm/edge` entry exclusively.
 * Workerd `nodejs_compat` flag required (for the cachedValidate
 * SHA-256 canonical-JSON key derivation).
 */
export { withBonklmAgent } from './bonklm-agent.js';
export {
  CloudflareAgentBlockedError,
  type AgentLike,
  type AgentExecutionContextLike,
  type BonklmAgentConfig,
  type BonklmAgentHookContext,
  type CloudflareAgentBlockEvent,
  type DurableObjectStorageLike,
  type SqlStorageLike,
} from './types.js';
