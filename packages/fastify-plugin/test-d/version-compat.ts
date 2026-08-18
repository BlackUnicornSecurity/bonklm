import Fastify from 'fastify';
import guardrailsPlugin, { type GuardrailsPluginOptions } from '@blackunicorn/bonklm-fastify';

const app = Fastify({ logger: false });
const options: GuardrailsPluginOptions = { productionMode: true };

await app.register(guardrailsPlugin, options);
await app.close();
