/**
 * LangChain Framework Connector Definition
 *
 * Provides integration with LangChain for callback-based guardrails.
 * This is a framework connector that implements LangChain's callback pattern.
 */

import type { ConnectorDefinition } from '../base.js';
import { z } from 'zod';

export const langchainConnector: ConnectorDefinition = {
  id: 'langchain',
  name: 'LangChain',
  category: 'framework',
  npmPackage: '@blackunicorn/bonklm-langchain',
  detection: {
    packageJson: ['@blackunicorn/bonklm-langchain', 'langchain', '@langchain/core']
  },

  test: async (_config, _signal) => {
    // Framework connectors don't need external testing
    return {
      connection: true,
      validation: true
    };
  },

  generateSnippet: () =>
    `
import { GuardrailEngine } from '@blackunicorn/bonklm';
import { BaseCallbackHandler } from '@langchain/core/callbacks/base';

const guardrails = new GuardrailEngine({
  validators: [
    // ... your validators
  ],
});

class GuardrailCallbackHandler extends BaseCallbackHandler {
  name = 'guardrail-handler';

  async handleLLMStart(_llm: string, prompts: string[]) {
    for (const prompt of prompts) {
      const result = await guardrails.validate(prompt);
      if (result.flagged) {
        throw new Error(\`Content flagged: \${result.reason}\`);
      }
    }
  }
}

// Use with LangChain
import { ChatOpenAI } from '@langchain/openai';

const llm = new ChatOpenAI({
  callbacks: [new GuardrailCallbackHandler()],
});
  `.trim(),

  configSchema: z.object({
    blockOnFlag: z.boolean().optional()
  })
};
