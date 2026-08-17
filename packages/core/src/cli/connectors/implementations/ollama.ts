/**
 * Ollama Connector Definition
 *
 * Provides integration with Ollama (local LLM server) for LLM guardrails.
 * Ollama runs locally and does not require an API key.
 */

import type { ConnectorDefinition } from '../base.js';
import { z } from 'zod';
import { DEFAULT_LOCAL_TIMEOUT } from '../timeouts.js';

export const ollamaConnector: ConnectorDefinition = {
  id: 'ollama',
  name: 'Ollama',
  category: 'llm',
  npmPackage: '@blackunicorn/bonklm-ollama',
  detection: {
    envVars: ['OLLAMA_HOST'],
    packageJson: ['@blackunicorn/bonklm-ollama', 'ollama'],
    ports: [11434]
  },

  // OLLAMA_HOST points the connector at a non-default Ollama server. It has a
  // working default (http://localhost:11434), so the prompt is skippable.
  optionalEnvVars: ['OLLAMA_HOST'],
  configKeyByEnvVar: {
    OLLAMA_HOST: 'baseUrl'
  },

  test: async (config, signal) => {
    const baseUrl = config.baseUrl || 'http://localhost:11434';

    // Use the provided signal or create a local one for timeout
    const controller = new AbortController();
    const effectiveSignal = signal || controller.signal;
    const timeout = setTimeout(() => controller.abort(), DEFAULT_LOCAL_TIMEOUT);

    try {
      const response = await fetch(`${baseUrl}/api/tags`, {
        method: 'GET',
        signal: effectiveSignal
      });

      return {
        connection: response.ok,
        validation: response.ok,
        error: response.ok ? undefined : `HTTP ${response.status}`
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        connection: false,
        validation: false,
        error: message
      };
    } finally {
      // Always clear timeout to prevent resource leaks
      clearTimeout(timeout);
    }
  },

  generateSnippet: config =>
    `
import { ollamaConnector } from '@blackunicorn/bonklm/ollama-connector';

const connector = ollamaConnector({
  baseUrl: '${config.baseUrl || 'http://localhost:11434'}',
});
  `.trim(),

  configSchema: z.object({
    baseUrl: z.string().url().optional()
  })
};
