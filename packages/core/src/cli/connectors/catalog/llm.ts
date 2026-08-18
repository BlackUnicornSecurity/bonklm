/**
 * LLM provider connector descriptors.
 *
 * OpenAI, Anthropic and Ollama are hand-written definitions under
 * `connectors/implementations/` (they carry tuned code snippets and live API
 * probes); this file covers the remaining provider packages.
 *
 * Credential env-var names are taken from each connector package's own README —
 * the wizard writes that exact name into the user's `.env`, so a name we cannot
 * source from the package is left undeclared rather than guessed.
 *
 * @module connectors/catalog/llm
 */

import type { ConnectorDescriptor } from '../descriptor.js';

export const LLM_DESCRIPTORS: readonly ConnectorDescriptor[] = Object.freeze([
  {
    id: 'google-genai',
    name: 'Google GenAI',
    category: 'llm',
    npmPackage: '@blackunicorn/bonklm-google-genai',
    peerPackages: ['@google/genai'],
    credentials: [{ env: 'GEMINI_API_KEY', configKey: 'apiKey' }],
    summary: 'Guardrails for the Google GenAI SDK — Gemini Developer API, Vertex AI, and the Live API.'
  },
  {
    id: 'huggingface',
    name: 'Hugging Face',
    category: 'llm',
    npmPackage: '@blackunicorn/bonklm-huggingface',
    peerPackages: ['@huggingface/inference'],
    credentials: [{ env: 'HF_API_KEY', configKey: 'apiKey' }],
    summary: 'Model input/output validation for the Hugging Face Inference API.'
  },
  {
    id: 'inference-providers',
    name: 'Inference Providers (Groq / Cerebras / Together)',
    category: 'llm',
    npmPackage: '@blackunicorn/bonklm-inference-providers',
    peerPackages: ['groq-sdk', '@cerebras/cerebras_cloud_sdk', 'together-ai'],
    credentials: [{ env: 'GROQ_API_KEY', configKey: 'apiKey' }],
    summary: 'Guardrails for the OpenAI-compatible Groq, Cerebras and Together clients.'
  },
  {
    id: 'mistral',
    name: 'Mistral',
    category: 'llm',
    npmPackage: '@blackunicorn/bonklm-mistral',
    peerPackages: ['@mistralai/mistralai'],
    credentials: [{ env: 'MISTRAL_API_KEY', configKey: 'apiKey' }],
    summary: 'Mistral SDK v2 guardrails across chat, agents, FIM, embeddings and classifiers.'
  }
] as const);
