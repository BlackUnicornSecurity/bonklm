/**
 * Story 1.8 Construct C — `ToolCallArgsValidator` integration
 * ===========================================================
 *
 * Reads user-authored messages from `runtime.getMemories(...)` and
 * blocks when `args.recipient` does not appear in any user-authored
 * message for the current room — i.e. the agent invented a recipient
 * that the user never named.
 *
 * Composed with Story 1.1c's preference-setting WARNING patterns as a
 * TWO-CONDITION gate: BLOCK iff
 *   (a) preference-setting pattern fires on a recent message AND
 *   (b) `args.recipient` appears ONLY in messages that match the
 *       preference-setting pattern.
 *
 * **Documented Class-4 limitation**: if the persistence layer is
 * mutated via an unauthenticated upstream PATCH route, this validator
 * reads attacker-controlled data. Story 2.4a (Sprint 12, v0.5.0)
 * closes the gap via shadow-log read.
 *
 * @package @blackunicorn/bonklm-elizaos
 */
import {
  createToolCallArgsValidator,
  detectPatterns,
  PromptInjectionValidator,
  type Validator,
} from '@blackunicorn/bonklm';
import type {
  ActionLike,
  BonklmPluginOptions,
  IAgentRuntimeLike,
  MemoryLike,
} from './types.js';

/**
 * Build the ToolCallArgsValidator chain used by Construct C. The
 * validator is reused across every wrapped action; the chain reads
 * user-authored memories per call.
 */
function buildToolCallValidator(validators: Validator[]): ReturnType<typeof createToolCallArgsValidator> {
  return createToolCallArgsValidator({ validators });
}

/**
 * Extract `args.recipient` from a tool-call args object. Returns the
 * canonical lowercase form for case-insensitive comparison against
 * memory text.
 */
function extractRecipient(args: unknown): string | null {
  if (!args || typeof args !== 'object') return null;
  const obj = args as { recipient?: unknown; to?: unknown; address?: unknown };
  for (const candidate of [obj.recipient, obj.to, obj.address]) {
    if (typeof candidate === 'string' && candidate.length > 0) {
      return candidate.toLowerCase();
    }
  }
  return null;
}

/**
 * Test whether any preference-setting pattern (Story 1.1c) fires on
 * the supplied message text. Uses `detectPatterns` directly so the
 * gate doesn't trip the `PromptInjectionValidator.analyze` block path
 * (those patterns are WARNING + `blockEligible: false`).
 */
function hasPreferenceSettingPattern(text: string): boolean {
  for (const finding of detectPatterns(text)) {
    if (finding.category === 'web3_preference_setting') return true;
  }
  return false;
}

/**
 * Two-condition gate. Returns `true` if the args should BLOCK.
 *
 * @internal exported for tests.
 */
export function evaluateRecipientGate(
  recipient: string,
  memories: ReadonlyArray<MemoryLike>
): { block: boolean; reason?: string } {
  // Bucket user-authored messages into preference-setting vs not.
  // Memories without an explicit `source` are treated as
  // `agent_internal` (least-privileged for this check — they cannot
  // attest to where the recipient came from).
  const userAuthored = memories.filter((m) => m.source === 'authenticated');
  if (userAuthored.length === 0) {
    // No user-authored memories at all to corroborate the recipient.
    return { block: true, reason: 'Recipient has no user-authored corroboration' };
  }

  let prefMentionCount = 0;
  let nonPrefMentionCount = 0;
  for (const m of userAuthored) {
    const text = m.content?.text;
    if (typeof text !== 'string' || text.length === 0) continue;
    if (!text.toLowerCase().includes(recipient)) continue;
    if (hasPreferenceSettingPattern(text)) {
      prefMentionCount++;
    } else {
      nonPrefMentionCount++;
    }
  }

  // Block ONLY when both conditions hold: a preference-setting message
  // mentioned the recipient AND no non-preference-setting message ever
  // mentioned it.
  if (prefMentionCount > 0 && nonPrefMentionCount === 0) {
    return {
      block: true,
      reason: 'Recipient mentioned ONLY in preference-setting messages',
    };
  }
  // If no user-authored message mentions the recipient at all, also
  // block — the agent invented an address the user never named.
  if (prefMentionCount === 0 && nonPrefMentionCount === 0) {
    return { block: true, reason: 'Recipient not mentioned in any user-authored message' };
  }

  return { block: false };
}

/**
 * Wrap a single action's `handler` so each invocation runs
 * `ToolCallArgsValidator` on the args AND the two-condition recipient
 * gate against the room's user-authored memories.
 *
 * Returns a new `ActionLike` (does not mutate the input).
 */
export function wrapSigningAction(
  action: ActionLike,
  _runtime: IAgentRuntimeLike,
  options: BonklmPluginOptions
): ActionLike {
  const validators = options.validators ?? [new PromptInjectionValidator()];
  const toolCallValidator = buildToolCallValidator(validators);
  const productionMode = options.productionMode ?? process.env.NODE_ENV === 'production';
  const originalHandler = action.handler;

  return {
    ...action,
    async handler(
      r: IAgentRuntimeLike,
      message: MemoryLike,
      state?: unknown,
      opts?: unknown,
      callback?: unknown
    ): Promise<unknown> {
      // Extract the tool-call args from the message content. ElizaOS
      // serialises action invocations under `message.content.args`
      // (or `message.content.params`). Duck-typed read.
      const content = message.content ?? {};
      const args =
        (content as { args?: unknown }).args ?? (content as { params?: unknown }).params;

      // Run BonkLM's ToolCallArgsValidator on the args tree first.
      const argsResult = await toolCallValidator.validate({
        kind: 'tool_call',
        toolName: action.name,
        args,
      });
      if (argsResult.blocked) {
        options.onActionBlocked?.(action.name, argsResult.reason ?? 'tool_args_blocked');
        throw new Error(
          productionMode
            ? `Action blocked: ${action.name}`
            : `Action ${action.name} blocked: ${argsResult.reason}`
        );
      }

      // Two-condition recipient gate.
      const recipient = extractRecipient(args);
      if (recipient && message.roomId && typeof r.getMemories === 'function') {
        const memories = (await r.getMemories({
          roomId: message.roomId,
          tableName: 'messages',
        })) ?? [];
        const gate = evaluateRecipientGate(recipient, memories);
        if (gate.block) {
          options.onActionBlocked?.(action.name, gate.reason ?? 'recipient_gate_blocked');
          throw new Error(
            productionMode
              ? `Action blocked: ${action.name}`
              : `Action ${action.name} blocked: ${gate.reason}`
          );
        }
      }

      // Validation passed — defer to the wrapped action's original
      // handler. If there's no original handler the action is
      // declaration-only and we return undefined.
      if (typeof originalHandler === 'function') {
        return originalHandler.call(r, r, message, state, opts, callback);
      }
      return undefined;
    },
  };
}
