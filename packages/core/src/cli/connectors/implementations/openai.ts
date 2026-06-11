/**
 * OpenAI Connector Definition
 *
 * Provides integration with OpenAI API for LLM guardrails.
 */

import type { ConnectorDefinition } from '../base.js';
import { z } from 'zod';
import { validateApiKeySecure } from '../../utils/validation.js';
import { DEFAULT_API_TIMEOUT } from '../registry.js';

export const openaiConnector: ConnectorDefinition = {
  id: 'openai',
  name: 'OpenAI',
  category: 'llm',
  detection: {
    envVars: ['OPENAI_API_KEY'],
    packageJson: ['openai']
  },

  // The CLI loaders key the credential bag by env-var name (OPENAI_API_KEY) for
  // .env persistence; test() below reads config.apiKey. This declares that
  // remap so the shared test/validate seams wire the value through (see
  // ConnectorDefinition.configKeyByEnvVar / applyConnectorConfigKeys).
  configKeyByEnvVar: {
    OPENAI_API_KEY: 'apiKey'
  },

  test: async (config, _signal) => {
    const apiKey = config.apiKey;
    if (!apiKey) {
      return {
        connection: false,
        validation: false,
        error: 'API key is required'
      };
    }

    try {
      const result = await validateApiKeySecure(apiKey, {
        method: 'GET',
        sendInHeader: true,
        testEndpoint: 'https://api.openai.com/v1/models',
        timeout: DEFAULT_API_TIMEOUT,
        logLevel: 'none'
      });

      return {
        connection: result,
        validation: result
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        connection: false,
        validation: false,
        error: message
      };
    }
  },

  generateSnippet: _config =>
    `
import { GuardrailEngine } from '@blackunicorn/bonklm';
import { openaiConnector } from '@blackunicorn/bonklm/openai-connector';

const engine = new GuardrailEngine({
  connectors: [
    openaiConnector({
      apiKey: process.env.OPENAI_API_KEY,
    }),
  ],
});
  `.trim(),

  configSchema: z.object({
    apiKey: z.string().startsWith('sk-', 'OpenAI API key must start with "sk-"')
  })
};
