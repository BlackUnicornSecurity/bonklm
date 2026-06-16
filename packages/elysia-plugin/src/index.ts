// SPDX-License-Identifier: Apache-2.0
/**
 * `@blackunicorn/bonklm-elysia` — Elysia plugin for BonkLM (Story 3.9).
 *
 * ```ts
 * import { Elysia } from 'elysia';
 * import { bonklmGuardrails } from '@blackunicorn/bonklm-elysia';
 * import { GuardrailEngine, PromptInjectionValidator } from '@blackunicorn/bonklm';
 *
 * const engine = new GuardrailEngine({ validators: [new PromptInjectionValidator()] });
 *
 * new Elysia()
 *   .use(bonklmGuardrails({ engine }))
 *   .post('/chat', ({ body }) => `you said: ${body}`)
 *   .listen(3000);
 * ```
 *
 * The plugin intercepts `beforeHandle` to run `runRequestValidation`
 * on the incoming body. On BLOCK it returns a 403 JSON response
 * (overridable via `onBlock`).
 */
export { bonklmGuardrails, type BonklmElysiaOptions } from './plugin.js';
