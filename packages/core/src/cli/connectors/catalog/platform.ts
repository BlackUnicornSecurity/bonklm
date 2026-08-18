/**
 * Sandbox, durable-workflow and observability connector descriptors.
 *
 * @module connectors/catalog/platform
 */

import type { ConnectorDescriptor } from '../descriptor.js';

export const PLATFORM_DESCRIPTORS: readonly ConnectorDescriptor[] = Object.freeze([
  {
    id: 'e2b',
    name: 'E2B',
    category: 'sandbox',
    npmPackage: '@blackunicorn/bonklm-e2b',
    peerPackages: ['@e2b/code-interpreter'],
    summary: 'E2B sandbox wrapper — code-injection and path-traversal validation on run/runCode/files.'
  },
  {
    id: 'daytona',
    name: 'Daytona',
    category: 'sandbox',
    npmPackage: '@blackunicorn/bonklm-daytona',
    peerPackages: ['@daytonaio/sdk'],
    credentials: [{ env: 'DAYTONA_API_KEY', configKey: 'apiKey' }],
    summary: 'Daytona workspace wrapper — code-injection and path-traversal validation on process and fs.'
  },
  {
    id: 'inngest',
    name: 'Inngest',
    category: 'workflow',
    npmPackage: '@blackunicorn/bonklm-inngest',
    peerPackages: ['inngest'],
    summary: 'Inngest middleware — replay-safe guardrails via cachedValidate.'
  },
  {
    id: 'temporal',
    name: 'Temporal',
    category: 'workflow',
    npmPackage: '@blackunicorn/bonklm-temporal',
    peerPackages: ['@temporalio/worker', '@temporalio/workflow'],
    summary: 'Temporal middleware — validators run as activities so workflows stay deterministic.'
  },
  {
    id: 'trigger',
    name: 'Trigger.dev',
    category: 'workflow',
    npmPackage: '@blackunicorn/bonklm-trigger',
    peerPackages: ['@trigger.dev/sdk'],
    summary: 'Trigger.dev v3/v4 middleware — CRIU-safe guardrails via cachedValidate and locals.'
  },
  {
    id: 'restate',
    name: 'Restate',
    category: 'workflow',
    npmPackage: '@blackunicorn/bonklm-restate',
    peerPackages: ['@restatedev/restate-sdk'],
    summary: 'Restate SDK middleware — idempotent validation across durable-execution retries.'
  },
  {
    id: 'voltops-otel',
    name: 'VoltOps OTel',
    category: 'observability',
    npmPackage: '@blackunicorn/bonklm-voltops-otel',
    peerPackages: ['@opentelemetry/api'],
    summary: 'Emits OpenTelemetry spans carrying bonklm.scanner / severity / action / category attributes.'
  }
] as const);
