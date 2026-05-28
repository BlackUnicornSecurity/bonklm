/**
 * Express Framework Connector Definition
 *
 * Provides integration with Express.js for middleware-based guardrails.
 * This is a framework connector that doesn't require external API testing.
 */

import type { ConnectorDefinition } from '../base.js';
import { z } from 'zod';

export const expressConnector: ConnectorDefinition = {
  id: 'express',
  name: 'Express',
  category: 'framework',
  detection: {
    packageJson: ['express']
  },

  test: async (_config, _signal) => {
    // Framework connectors don't need external testing
    // They are detected through package.json
    return {
      connection: true,
      validation: true
    };
  },

  generateSnippet: () =>
    `
import { GuardrailEngine } from '@blackunicorn/bonklm';
import { expressMiddleware } from '@blackunicorn/bonklm/express-middleware';
import express from 'express';

const app = express();
const guardrails = new GuardrailEngine({
  validators: [
    // ... your validators
  ],
});

app.use(express.json());
app.use(expressMiddleware(guardrails));

app.post('/api/chat', async (req, res) => {
  const result = await guardrails.validate(req.body.message);
  if (result.flagged) {
    return res.status(400).json({ error: 'Content flagged' });
  }
  // ... handle request
});

app.listen(3000);
  `.trim(),

  configSchema: z.object({
    validateOnRequest: z.boolean().optional()
  })
};
