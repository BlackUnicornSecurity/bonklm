/**
 * Story 3.9 — `withBonklm(action, opts)` Server Action wrapper.
 *
 * ```ts
 * 'use server';
 * import { withBonklm } from '@blackunicorn/bonklm-nextjs';
 *
 * export const submitMessage = withBonklm(
 *   async (formData: FormData) => {
 *     const msg = formData.get('msg') as string;
 *     // ... action logic
 *     return { ok: true };
 *   },
 *   { engine, onBlock: (event) => logger.warn('blocked', event) }
 * );
 * ```
 *
 * Validates serialized args BEFORE the action runs. On BLOCK,
 * throws `WebMiddlewareBlockedError` (Next.js surfaces it via
 * its Server Actions error boundary).
 */
import type { GuardrailEngine } from '@blackunicorn/bonklm';
import {
  runRequestValidation,
  type WebMiddlewareBlockEvent,
} from '@blackunicorn/bonklm-web-middleware-utils';

export type ServerAction<Args extends unknown[], Result> = (
  ...args: Args
) => Promise<Result>;

export interface WithBonklmOptions {
  engine: GuardrailEngine;
  /** Skip when this returns false. */
  shouldValidate?: (serializedArgs: string) => boolean;
  /** Fires on BLOCK. */
  onBlock?: (event: WebMiddlewareBlockEvent) => void;
  /** Error sink. */
  onError?: (err: unknown) => void;
}

export function withBonklm<Args extends unknown[], Result>(
  action: ServerAction<Args, Result>,
  options: WithBonklmOptions
): ServerAction<Args, Result> {
  if (!options?.engine) {
    throw new TypeError('withBonklm: options.engine is required.');
  }
  return async function wrappedAction(...args: Args): Promise<Result> {
    const serialized = serializeArgs(args);
    await runRequestValidation(
      {
        engine: options.engine,
        shouldValidate: options.shouldValidate,
        onBlock: options.onBlock,
        onError: options.onError,
      },
      serialized
    );
    return action(...args);
  };
}

function serializeArgs(args: unknown[]): string {
  if (args.length === 0) return '';
  // FormData is the common Server Action arg shape. Stringify each
  // arg + join with a separator that's unlikely to appear in benign
  // content (form-feed + newline).
  const parts: string[] = [];
  for (const arg of args) {
    parts.push(serializeSingleArg(arg));
  }
  return parts.join('\f\n');
}

function serializeSingleArg(arg: unknown): string {
  if (arg === null || arg === undefined) return '';
  if (typeof arg === 'string') return arg;
  if (typeof FormData !== 'undefined' && arg instanceof FormData) {
    // Sprint 41 portability fix — see web-middleware-utils equivalent.
    const entries: Array<[string, unknown]> = [];
    arg.forEach((value, key) => entries.push([key, value]));
    return safeStringify(Object.fromEntries(entries));
  }
  return safeStringify(arg);
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return `[unstringifiable:${typeof value}]`;
  }
}
