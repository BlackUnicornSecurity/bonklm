/**
 * Agent-framework connector descriptors.
 *
 * These connectors wrap an agent runtime's tool / memory / handoff surfaces.
 * None of them takes a BonkLM-owned credential — they are configured in code
 * against an already-authenticated client — so detection is by the upstream SDK
 * in the project's `package.json` and the test is the `installed` probe.
 *
 * @module connectors/catalog/agents
 */

import type { ConnectorDescriptor } from '../descriptor.js';

export const AGENT_DESCRIPTORS: readonly ConnectorDescriptor[] = Object.freeze([
  {
    id: 'cloudflare-agents',
    name: 'Cloudflare Agents',
    category: 'agent',
    npmPackage: '@blackunicorn/bonklm-cloudflare-agents',
    peerPackages: ['agents'],
    summary: 'BonklmAgent for Durable Objects + Workerd — validates setState, sql and ctx.storage.'
  },
  {
    id: 'eko',
    name: 'Eko',
    category: 'agent',
    npmPackage: '@blackunicorn/bonklm-eko',
    peerPackages: ['@eko-ai/eko'],
    summary: 'Multi-agent guardrails — validates planner output, BrowserAgent, FileAgent and MCP tool dispatch.'
  },
  {
    id: 'elizaos',
    name: 'ElizaOS',
    category: 'agent',
    npmPackage: '@blackunicorn/bonklm-elizaos',
    peerPackages: ['@elizaos/core'],
    summary: 'Web3 agent guardrails — wrapMemory plus ToolCallArgsValidator integration.'
  },
  {
    id: 'genkit',
    name: 'Genkit',
    category: 'agent',
    npmPackage: '@blackunicorn/bonklm-genkit',
    peerPackages: ['genkit'],
    summary: 'Google Genkit plugin wiring BonkLM validators into flows.'
  },
  {
    id: 'livekit',
    name: 'LiveKit Agents',
    category: 'agent',
    npmPackage: '@blackunicorn/bonklm-livekit',
    peerPackages: ['@livekit/agents', '@livekit/rtc-node'],
    summary: 'Voice-agent guardrails — interim-injection detection interrupts the session before the LLM call.'
  },
  {
    id: 'llamaindex',
    name: 'LlamaIndex.TS',
    category: 'agent',
    npmPackage: '@blackunicorn/bonklm-llamaindex',
    peerPackages: ['llamaindex'],
    summary: 'RAG query and retrieval validation for LlamaIndex.TS.'
  },
  {
    id: 'mastra',
    name: 'Mastra',
    category: 'agent',
    npmPackage: '@blackunicorn/bonklm-mastra',
    peerPackages: ['@mastra/core'],
    summary: 'Mastra framework connector wiring BonkLM validators into agents and workflows.'
  },
  {
    id: 'mcp',
    name: 'MCP (Model Context Protocol)',
    category: 'agent',
    npmPackage: '@blackunicorn/bonklm-mcp',
    peerPackages: ['@modelcontextprotocol/sdk'],
    summary: 'Guards MCP tool calls and tool results — the bridge for any MCP host, including non-JS ones.'
  },
  {
    id: 'openai-agents',
    name: 'OpenAI Agents SDK',
    category: 'agent',
    npmPackage: '@blackunicorn/bonklm-openai-agents',
    peerPackages: ['@openai/agents'],
    summary: 'Wraps the Agent, Handoff and Realtime surfaces of the OpenAI Agents SDK.'
  },
  {
    id: 'stagehand',
    name: 'Stagehand',
    category: 'agent',
    npmPackage: '@blackunicorn/bonklm-stagehand',
    peerPackages: ['@browserbasehq/stagehand'],
    summary: 'Browserbase Stagehand guardrails on act / extract / observe / agent.execute.'
  },
  {
    id: 'vercel-ai',
    name: 'Vercel AI SDK',
    category: 'agent',
    npmPackage: '@blackunicorn/bonklm-vercel',
    peerPackages: ['ai'],
    summary: 'Vercel AI SDK connector with streaming validation support.'
  },
  {
    id: 'voltagent',
    name: 'VoltAgent',
    category: 'agent',
    npmPackage: '@blackunicorn/bonklm-voltagent',
    peerPackages: ['@voltagent/core'],
    summary: 'wrapVoltAgent(agent, engine) injects BonkLM validators into a VoltAgent.'
  }
] as const);
