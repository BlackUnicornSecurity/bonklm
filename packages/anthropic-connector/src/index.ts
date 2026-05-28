/**
 * @blackunicorn/bonklm-anthropic
 *
 * Anthropic SDK connector for LLM-Guardrails.
 *
 * Provides security guardrails for Anthropic/Claude API operations including:
 * - Input validation for prompt injection and jailbreak detection
 * - Output validation for content filtering
 * - Incremental stream validation for real-time protection
 * - Buffer size limits to prevent DoS
 *
 * @example
 * ```ts
 * import Anthropic from '@anthropic-ai/sdk';
 * import { createGuardedAnthropic } from '@blackunicorn/bonklm-anthropic';
 * import { PromptInjectionValidator } from '@blackunicorn/bonklm';
 *
 * const anthropic = new Anthropic();
 * const guarded = createGuardedAnthropic(anthropic, {
 *   validators: [new PromptInjectionValidator()],
 *   validateStreaming: true,
 * });
 *
 * const response = await guarded.messages.create({
 *   model: 'claude-3-opus-20240229',
 *   messages: [{ role: 'user', content: userInput }]
 * });
 * ```
 */

export { createGuardedAnthropic, messagesToText } from './guarded-anthropic.js';

export type { GuardedAnthropicOptions, GuardedMessageOptions, GuardedMessage } from './types.js';

export { StreamValidationError } from './types.js';
