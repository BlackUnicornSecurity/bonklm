/**
 * `@blackunicorn/bonklm-inference-providers` — Groq + Cerebras +
 * Together wrappers for BonkLM. All 3 use the shared internal
 * `wrapOpenAICompatibleClient` helper.
 *
 * Three OPTIONAL peer deps: `groq-sdk`, `@cerebras/cerebras_cloud_sdk`,
 * `together-ai`. Install only the ones you use.
 */
import { wrapOpenAICompatibleClient } from './wrap-openai-compatible.js';
import type { OpenAICompatibleClient, WrapInferenceOptions } from './types.js';

/**
 * Wrap a Groq SDK client. Groq's SDK is OpenAI-compatible.
 *
 * ```ts
 * import Groq from 'groq-sdk';
 * import { wrapGroq } from '@blackunicorn/bonklm-inference-providers';
 *
 * const client = wrapGroq(new Groq({ apiKey }), { engine });
 * const response = await client.chat.completions.create({ ... });
 * ```
 */
export function wrapGroq<C extends OpenAICompatibleClient>(
  client: C,
  options: WrapInferenceOptions
): C {
  return wrapOpenAICompatibleClient(client, options, 'groq');
}

/**
 * Wrap a Cerebras SDK client.
 */
export function wrapCerebras<C extends OpenAICompatibleClient>(
  client: C,
  options: WrapInferenceOptions
): C {
  return wrapOpenAICompatibleClient(client, options, 'cerebras');
}

/**
 * Wrap a Together SDK client.
 */
export function wrapTogether<C extends OpenAICompatibleClient>(
  client: C,
  options: WrapInferenceOptions
): C {
  return wrapOpenAICompatibleClient(client, options, 'together');
}

export { wrapOpenAICompatibleClient } from './wrap-openai-compatible.js';
export {
  InferenceProviderBlockedError,
  type OpenAICompatibleClient,
  type OpenAIChatRequest,
  type OpenAIChatResponse,
  type OpenAIStreamChunk,
  type WrapInferenceOptions,
  type InferenceProviderName,
  type InferenceProviderBlockEvent,
} from './types.js';
