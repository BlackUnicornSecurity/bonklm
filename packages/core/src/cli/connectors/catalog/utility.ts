/**
 * Utility-package descriptors.
 *
 * These packages have no external service to authenticate against — they are
 * shared primitives consumed by the other connectors, or helpers configured
 * entirely in code. They are still registered so `bonklm status` and the wizard
 * report the whole published surface rather than a subset, and so the
 * workspace-coverage guard in `registry.test.ts` stays exact.
 *
 * @module connectors/catalog/utility
 */

import type { ConnectorDescriptor } from '../descriptor.js';

export const UTILITY_DESCRIPTORS: readonly ConnectorDescriptor[] = Object.freeze([
  {
    id: 'browser-agents',
    name: 'Browser Agents Core',
    category: 'utility',
    npmPackage: '@blackunicorn/bonklm-browser-agents-core',
    summary: 'Normalised browser-agent event union + guardrail factory underpinning Stagehand and Eko.'
  },
  {
    id: 'document-ingest',
    name: 'Document Ingest',
    category: 'utility',
    npmPackage: '@blackunicorn/bonklm-document-ingest',
    peerPackages: ['@llamaindex/llama-cloud', 'unstructured-client', 'reductoai'],
    summary: 'LlamaParse / Unstructured / Reducto wrappers plus validateExtractedText for DIY parsers.'
  },
  {
    id: 'logger',
    name: 'Attack Logger',
    category: 'utility',
    npmPackage: '@blackunicorn/bonklm-logger',
    summary: 'Attack logger and awareness display for BonkLM.'
  },
  {
    id: 'memory-utils',
    name: 'Memory Utils',
    category: 'utility',
    npmPackage: '@blackunicorn/bonklm-memory-utils',
    summary: 'Shared memory-client wrapping primitives consumed by the Mem0, Zep and Letta connectors.'
  },
  {
    id: 'sandbox-utils',
    name: 'Sandbox Utils',
    category: 'utility',
    npmPackage: '@blackunicorn/bonklm-sandbox-utils',
    summary: 'Shared sandbox validation primitives — validateCode, validatePath, wrapStream.'
  },
  {
    id: 'web-middleware-utils',
    name: 'Web Middleware Utils',
    category: 'utility',
    npmPackage: '@blackunicorn/bonklm-web-middleware-utils',
    summary: 'Framework-agnostic runRequestValidation / runResponseValidation / getRequestBody helpers.'
  },
  {
    id: 'voice-webhooks',
    name: 'Voice Webhooks (Vapi / Retell)',
    category: 'utility',
    npmPackage: '@blackunicorn/bonklm-voice-webhooks',
    // The HMAC secret belongs to whichever voice provider you use, and the
    // wizard will not pick one for you. Both names are surfaced so an
    // already-configured deployment is recognised, and both are prompted as
    // OPTIONAL — a blank answer is skipped and never written to `.env`.
    detectEnvVars: ['VAPI_HMAC_SECRET', 'RETELL_HMAC_SECRET'],
    summary: 'Vapi (HTTP) and Retell (WebSocket) webhook validators with HMAC-SHA256 auth.'
  }
] as const);
