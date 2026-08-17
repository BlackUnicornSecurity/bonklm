/**
 * Web framework and serving-surface connector descriptors.
 *
 * Express and LangChain are hand-written definitions under
 * `connectors/implementations/`; this file covers the remaining web packages.
 *
 * @module connectors/catalog/web
 */

import type { ConnectorDescriptor } from '../descriptor.js';

export const WEB_DESCRIPTORS: readonly ConnectorDescriptor[] = Object.freeze([
  {
    id: 'fastify',
    name: 'Fastify',
    category: 'framework',
    npmPackage: '@blackunicorn/bonklm-fastify',
    peerPackages: ['fastify'],
    summary: 'Fastify plugin applying BonkLM guardrails to request and response bodies.'
  },
  {
    id: 'hono',
    name: 'Hono',
    category: 'framework',
    npmPackage: '@blackunicorn/bonklm-hono',
    peerPackages: ['hono'],
    summary: 'Edge-targeted Hono middleware for LLM security guardrails.'
  },
  {
    id: 'elysia',
    name: 'Elysia',
    category: 'framework',
    npmPackage: '@blackunicorn/bonklm-elysia',
    peerPackages: ['elysia'],
    summary: 'Elysia plugin — bonklmGuardrails(opts) middleware.'
  },
  {
    id: 'nestjs',
    name: 'NestJS',
    category: 'framework',
    npmPackage: '@blackunicorn/bonklm-nestjs',
    peerPackages: ['@nestjs/core', '@nestjs/common'],
    summary: 'NestJS module providing request/response validation for NestJS applications.'
  },
  {
    id: 'nextjs',
    name: 'Next.js',
    category: 'framework',
    npmPackage: '@blackunicorn/bonklm-nextjs',
    peerPackages: ['next'],
    summary: 'Next.js helpers — withBonklm(action), bonklmRouteHandler, bonklmEdgeMiddleware.'
  },
  {
    id: 'copilotkit',
    name: 'CopilotKit',
    category: 'framework',
    npmPackage: '@blackunicorn/bonklm-copilotkit',
    peerPackages: ['@copilotkit/react-core'],
    summary: 'CopilotKit integration guarding copilot runtime requests.'
  },
  {
    id: 'server',
    name: 'BonkLM Server',
    category: 'framework',
    npmPackage: '@blackunicorn/bonklm-server',
    // Self-hosted gateway: it ships its own Fastify dependency, so the only
    // reliable package signal is the connector package itself (added
    // automatically by defineConnector).
    credentials: [
      {
        env: 'BONKLM_HMAC_SECRET',
        configKey: 'hmacSecret',
        label: 'HMAC secret'
      }
    ],
    summary: 'Self-hosted guardrail HTTP gateway exposing /litellm, /portkey and /openai-compatible endpoints.'
  }
] as const);
