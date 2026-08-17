// SPDX-License-Identifier: Apache-2.0
/**
 * `@blackunicorn/bonklm-cloudflare-agents` — Cloudflare Agents
 * (Durable Objects + Workerd) connector for BonkLM.
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
 * **Edge-targeted**. Builds on BonkLM core APIs that use Node built-ins.
 * Workerd `nodejs_compat` flag required.
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
  type SqlStorageLike
} from './types.js';
