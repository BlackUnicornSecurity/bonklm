/**
 * @UseGuardrails() Decorator
 * ==========================
 * Decorator for marking controllers/methods to use guardrails validation.
 *
 * @package @blackunicorn/bonklm-nestjs
 */

import { SetMetadata } from '@nestjs/common';
import type { UseGuardrailsDecoratorOptions } from './types.js';
import { USE_GUARDRAILS_KEY } from './constants.js';

/**
 * Decorator to enable guardrails validation on a controller method.
 *
 * When applied, the GuardrailsInterceptor will validate the request
 * before it reaches the handler and optionally validate the response.
 *
 * @example
 * ```typescript
 * @Controller('chat')
 * export class ChatController {
 *   @Post()
 *   @UseGuardrails()
 *   async chat(@Body() body: { message: string }) {
 *     return { response: 'Hello!' };
 *   }
 * }
 * ```
 *
 * @example
 * ```typescript
 * // With options
 * @Post()
 * @UseGuardrails({
 *   validateInput: true,
 *   validateOutput: true,
 *   bodyField: 'prompt',
 * })
 * async generate(@Body() body: { prompt: string }) {
 *   return { text: 'Generated text' };
 * }
 * ```
 *
 * @param options - Optional configuration for this endpoint
 * @returns Decorator function
 */
export const UseGuardrails = (options: UseGuardrailsDecoratorOptions = {}): MethodDecorator & ClassDecorator => {
  return SetMetadata(USE_GUARDRAILS_KEY, options);
};

/**
 * Type guard to check if a value is a UseGuardrailsDecoratorOptions.
 */
export function isUseGuardrailsOptions(value: unknown): value is UseGuardrailsDecoratorOptions {
  return (
    typeof value === 'object' &&
    value !== null &&
    ('validateInput' in value ||
      'validateOutput' in value ||
      'bodyField' in value ||
      'responseField' in value ||
      'maxContentLength' in value ||
      'onError' in value)
  );
}
