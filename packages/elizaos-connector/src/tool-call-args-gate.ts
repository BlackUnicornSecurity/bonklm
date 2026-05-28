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
  normalizeText,
  PromptInjectionValidator,
  type ShadowLogEntry,
  type Validator
} from '@blackunicorn/bonklm';
import { ConnectorValidationError } from '@blackunicorn/bonklm/core/connector-utils';
import type { ActionLike, BonklmPluginOptions, IAgentRuntimeLike, MemoryLike } from './types.js';
import { shadowLogIntegrityFailureMessage, verifyAndReadAuthenticatedMessages } from './shadow-log-integration.js';

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
 *
 * Audit-loop CRITICAL fix #2 (adversarial): non-string recipient
 * values (number, BigInt, object, etc.) previously returned `null`
 * which SKIPPED the gate entirely. A crafted action invocation with
 * `{ recipient: 0xabc }` (decimal) defeated the check. We now throw
 * a `ConnectorValidationError` if any recipient-named field is
 * present but non-string, forcing the caller to fix the action
 * serialisation rather than allowing a silent bypass.
 */
function extractRecipient(args: unknown): string | null {
  if (!args || typeof args !== 'object') return null;
  const obj = args as { recipient?: unknown; to?: unknown; address?: unknown };
  for (const [fieldName, candidate] of [
    ['recipient', obj.recipient],
    ['to', obj.to],
    ['address', obj.address]
  ] as Array<[string, unknown]>) {
    if (candidate === undefined || candidate === null) continue;
    if (typeof candidate !== 'string') {
      throw new ConnectorValidationError(
        `args.${fieldName} must be a string; received ${typeof candidate}. Recipient validation cannot proceed on a non-string identifier.`,
        'validation_failed'
      );
    }
    if (candidate.length > 0) {
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
 *
 * Audit-loop HIGH fix #4 (adversarial): the direct-call path of
 * `detectPatterns` does NOT apply `normalizeText`. A Cyrillic-mangled
 * preference-setting message ("rememьer my wallet 0xabc" with U+044C
 * substituted for `b`) bypassed pattern detection, so the gate
 * mis-categorised it as a non-preference-setting message and used
 * the recipient as legitimate corroboration. Apply `normalizeText`
 * first to defeat homoglyph / zero-width / fullwidth confusable
 * obfuscation — mirrors the `PromptInjectionValidator.validate`
 * normalisation pass.
 */
function hasPreferenceSettingPattern(text: string): boolean {
  const normalised = normalizeText(text);
  for (const finding of detectPatterns(normalised)) {
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
  //
  // Audit-loop BLOCK #5 (historical-memory source-field collision):
  // legacy plugins or older deployments may have set `source:
  // 'authenticated'` on memories before BonkLM took over. Trusting the
  // source field alone would let attacker-pre-populated memories
  // bootstrap a recipient into the corroboration set. We require a
  // BonkLM-stamped `metadata.bonklmTrust === true` marker that ONLY the
  // sealed `wrapMemory` writer can set (closure-captured, not
  // arg-passable), AND a source value of 'authenticated'. Both
  // conditions must hold.
  const userAuthored = memories.filter(
    m =>
      m.source === 'authenticated' &&
      m.metadata !== undefined &&
      (m.metadata as { bonklmTrust?: unknown }).bonklmTrust === true
  );
  if (userAuthored.length === 0) {
    // No user-authored memories at all to corroborate the recipient.
    return { block: true, reason: 'Recipient has no user-authored corroboration' };
  }

  let prefMentionCount = 0;
  let nonPrefMentionCount = 0;
  // Audit-loop HIGH fix #4: apply `normalizeText` to BOTH the message
  // text and the recipient before substring matching so homoglyph /
  // zero-width / fullwidth confusables in either side cannot defeat
  // the corroboration check.
  const normalisedRecipient = normalizeText(recipient).toLowerCase();
  for (const m of userAuthored) {
    const text = m.content?.text;
    if (typeof text !== 'string' || text.length === 0) continue;
    const normalisedText = normalizeText(text).toLowerCase();
    if (!normalisedText.includes(normalisedRecipient)) continue;
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
      reason: 'Recipient mentioned ONLY in preference-setting messages'
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
      const args = (content as { args?: unknown }).args ?? (content as { params?: unknown }).params;

      // Run BonkLM's ToolCallArgsValidator on the args tree first.
      const argsResult = await toolCallValidator.validate({
        kind: 'tool_call',
        toolName: action.name,
        args
      });
      if (argsResult.blocked) {
        options.onActionBlocked?.(action.name, argsResult.reason ?? 'tool_args_blocked');
        throw new ConnectorValidationError(
          productionMode ? `Action blocked: ${action.name}` : `Action ${action.name} blocked: ${argsResult.reason}`,
          'validation_failed'
        );
      }

      // Two-condition recipient gate.
      const recipient = extractRecipient(args);
      if (recipient && message.roomId) {
        const memories = await readMemoriesForGate({
          runtime: r,
          message,
          roomId: message.roomId,
          options
        });
        // `null` signals shadow-log integrity failure — refuse the
        // action (fail-CLOSED) with a generic public error.
        if (memories === null) {
          options.onActionBlocked?.(action.name, 'shadow_log_integrity_failure');
          throw new ConnectorValidationError(
            productionMode
              ? `Action blocked: ${action.name}`
              : `Action ${action.name} blocked: ${shadowLogIntegrityFailureMessage()}`,
            'validation_failed'
          );
        }
        const gate = evaluateRecipientGate(recipient, memories);
        if (gate.block) {
          options.onActionBlocked?.(action.name, gate.reason ?? 'recipient_gate_blocked');
          throw new ConnectorValidationError(
            productionMode ? `Action blocked: ${action.name}` : `Action ${action.name} blocked: ${gate.reason}`,
            'validation_failed'
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
    }
  };
}

/**
 * Story 2.4a Phase-2 — gate-side memory read.
 *
 * When `options.shadowLog` is configured, reads memories from the
 * shadow log via `verifyAndReadAuthenticatedMessages`. This closes
 * the Class-4 attack window where an unauthenticated HTTP PATCH
 * mutates the memories table between write and validator-read.
 *
 * When shadow log is NOT configured, falls back to v0.4.x behaviour
 * — reads from `runtime.getMemories(...)`.
 *
 * Returns:
 *  - `MemoryLike[]` — entries safe to pass to `evaluateRecipientGate`.
 *  - `null` — shadow log integrity check failed; caller MUST block
 *    the action (fail-CLOSED).
 *
 * @internal
 */
async function readMemoriesForGate(args: {
  runtime: IAgentRuntimeLike;
  message: MemoryLike;
  roomId: string;
  options: BonklmPluginOptions;
}): Promise<MemoryLike[] | null> {
  const { runtime, message, roomId, options } = args;

  if (options.shadowLog !== undefined) {
    // Resolve the authenticated room IDs. Default trusts the message's
    // own roomId (single-room agent — the common case). Multi-room
    // deployments supply their own resolver.
    const resolver =
      options.getAuthenticatedRoomIds ??
      ((_runtime, msg: MemoryLike) => new Set<string>(msg.roomId !== undefined ? [msg.roomId] : []));
    const authenticatedRoomIds = await resolver(runtime, message);

    const result = await verifyAndReadAuthenticatedMessages({
      shadowLog: options.shadowLog,
      roomId,
      authenticatedRoomIds,
      logger: options.logger
    });
    if (result.ok === false) {
      return null; // chain-integrity failure → fail-CLOSED
    }
    return result.entries.map(shadowEntryToMemoryLike);
  }

  // v0.4.x backward-compat fallback.
  if (typeof runtime.getMemories === 'function') {
    return (
      (await runtime.getMemories({
        roomId,
        tableName: 'messages'
      })) ?? []
    );
  }
  return [];
}

/**
 * Convert a `ShadowLogEntry` to the `MemoryLike` shape that
 * `evaluateRecipientGate` consumes.
 *
 * **Iter-1 security BLOCK-Q10a (data-integrity fix)**: the source
 * field PRESERVES the entry's actual `sourceTrust`. Previously this
 * hardcoded `'authenticated'`, which silently re-stamped
 * `'agent_internal'` entries as user-authored — defeating the
 * `evaluateRecipientGate` filter `m.source === 'authenticated'`.
 * Now `evaluateRecipientGate` correctly excludes agent-internal
 * entries from the corroboration set.
 *
 * `bonklmTrust: true` IS stamped — by construction these entries
 * flow out of `verifyAndReadAuthenticatedMessages` which has
 * passed chain integrity verification AND filtered through the
 * source-trust allowlist.
 *
 * @internal
 */
function shadowEntryToMemoryLike(entry: ShadowLogEntry): MemoryLike {
  return {
    id: entry.messageId,
    entityId: entry.entityId,
    roomId: entry.roomId,
    content: { text: entry.text },
    tableName: 'messages',
    source: entry.sourceTrust, // preserve actual trust tag
    metadata: { bonklmTrust: true }
  };
}
