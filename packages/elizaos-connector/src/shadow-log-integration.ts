/**
 * Story 2.4a — Shadow log integration into the ElizaOS connector
 * ===============================================================
 *
 * Wires the Story 1.3b shadow log primitive into the ElizaOS
 * connector. Two key integration points:
 *
 *   1. **MESSAGE_RECEIVED hook**: writes a shadow log entry BEFORE
 *      any vendor persistence layer touches the memory. The
 *      `ToolCallArgsValidator` (Construct C) reads from the shadow
 *      log via `verifyAndReadAuthenticatedMessages`, NOT from
 *      `runtime.getMemories(...)`. Closes the Class-4 attack window
 *      where a PATCH against the unauthenticated /memories route
 *      mutates persisted memory between write and validator-read.
 *
 *   2. **`verifyChain` containment**: on a tamper detection, the
 *      `brokenAt` position is logged CRITICAL internally + emitted
 *      to per-tamper telemetry but MUST NOT propagate to public-
 *      facing error responses. The public error is generic. This
 *      function provides the containment wrapper.
 *
 * @package @blackunicorn/bonklm-elizaos
 */
import type {
  ShadowLog,
  ShadowLogEntry,
  ShadowLogSourceTrust,
  Logger,
} from '@blackunicorn/bonklm';
import { assertRoomAccess } from './shadow-log-adapter.js';

/**
 * Result of `verifyAndReadAuthenticatedMessages`. The CALLER receives
 * `{ ok: true, entries }` on success. On chain integrity failure the
 * caller receives `{ ok: false }` ONLY — no `brokenAt` field is
 * exposed in this public shape. Internal telemetry (logger + the
 * `onTamperDetected` callback) gets the full diagnostic.
 *
 * **brokenAt containment** (iter-1 security BLOCK-1 / plan AC):
 * the `brokenAt` position MUST NOT propagate to any HTTP response
 * body, hook metadata, error message, or other surface visible to
 * external callers. Public-facing error strings carry the generic
 * message "shadow log integrity check failed; admin review required"
 * without position information.
 */
export type AuthenticatedMessagesResult =
  | { ok: true; entries: ShadowLogEntry[] }
  | { ok: false };

/**
 * Options for `verifyAndReadAuthenticatedMessages`.
 */
export interface VerifyAndReadOptions {
  /** The shadow log instance. */
  shadowLog: ShadowLog;
  /** The room to read from. */
  roomId: string;
  /**
   * The authenticated session's room access set. The caller MUST
   * derive this from the trusted session context BEFORE invoking
   * this function. Pass `undefined` to fail-closed.
   */
  authenticatedRoomIds: Set<string> | undefined;
  /**
   * Source-trust filter for the read. Default
   * `['authenticated', 'agent_internal']` — excludes unauthenticated
   * HTTP entries so the recipient-gate corroboration set carries
   * only trusted entries.
   */
  sourceFilter?: ShadowLogSourceTrust | ShadowLogSourceTrust[];
  /** Logger for CRITICAL on tamper. */
  logger?: Logger;
  /**
   * Telemetry callback fired with `brokenAt` on tamper detection.
   * The callback receives the internal diagnostic. The public return
   * value is OPAQUE (`{ ok: false }`); `brokenAt` flows ONLY to this
   * callback and to the structured logger.
   *
   * Per the storage-isolation contract, telemetry MUST land in an
   * audit pipeline scoped separately from public HTTP responses.
   */
  onTamperDetected?: (diagnostic: {
    roomId: string;
    brokenAt: number;
  }) => void;
}

/**
 * Verify the shadow log chain for `roomId` and read its
 * authenticated entries. The order is critical: verify FIRST, then
 * read. If the chain is broken we refuse to return entries — a
 * tampered entry's text could be attacker-controlled, and serving
 * it to the validator would defeat the entire defence.
 */
export async function verifyAndReadAuthenticatedMessages(
  opts: VerifyAndReadOptions
): Promise<AuthenticatedMessagesResult> {
  // Cross-room authorization — connector layer responsibility per
  // Story 1.3b. Throws when the room is not in the session's set.
  assertRoomAccess(opts.authenticatedRoomIds, opts.roomId);

  // Verify chain integrity FIRST.
  const verification = await opts.shadowLog.verifyChain(opts.roomId);
  if (verification.ok === false) {
    // CRITICAL containment — log + telemetry get brokenAt; public
    // return shape does NOT.
    const logger = opts.logger;
    if (logger !== undefined) {
      logger.error(
        '[bonklm-elizaos] CRITICAL — shadow log integrity check failed; admin review required.',
        { roomId: opts.roomId, brokenAt: verification.brokenAt }
      );
    }
    try {
      opts.onTamperDetected?.({
        roomId: opts.roomId,
        brokenAt: verification.brokenAt,
      });
    } catch {
      // Callback throws are swallowed — they MUST NOT crash the
      // integrity-check path.
    }
    return { ok: false };
  }

  // Read entries with the source-trust filter applied. Default
  // excludes 'unauthenticated_http' so the connector's two-condition
  // gate reads ONLY trusted entries.
  const sourceFilter =
    opts.sourceFilter ?? ['authenticated', 'agent_internal'];
  const entries = await opts.shadowLog.readByRoom(opts.roomId, {
    sourceTrust: sourceFilter,
    limit: Number.MAX_SAFE_INTEGER,
  });

  return { ok: true, entries };
}

/**
 * Build the generic public-facing error message for a shadow log
 * integrity failure. ALWAYS returns the same string — no position
 * info, no roomId, no entity context. Iter-1 security BLOCK-1
 * containment.
 *
 * Use at every HTTP-response site / hook-metadata site / error
 * message site where a chain failure surfaces to external callers.
 */
export function shadowLogIntegrityFailureMessage(): string {
  return 'Shadow log integrity check failed; admin review required.';
}

/**
 * `bonklm doctor` finding emitted when 2.4a ships and the doctor
 * detects an installed `@blackunicorn/bonklm-elizaos@0.4.x`. Per the
 * plan AC + scope-update v2 § v0.4.x EOL commitment, the v0.4.x
 * connector lacks the structural Class-4 defence and is
 * scheduled for EOL 30 days post-v0.5.0 release.
 */
export function buildEolFindingV04(installedVersion: string): {
  severity: 'HIGH';
  category: string;
  description: string;
  pluginName: string;
} {
  return {
    severity: 'HIGH',
    category: 'elizaos_connector_eol_v04',
    description:
      `Installed @blackunicorn/bonklm-elizaos@${installedVersion} is the v0.4.x line — ` +
      `Class-4 structural defence (shadow log integration) ships in v0.5.0 via Story 2.4a. ` +
      `Upgrade to v0.5.x for full Construct-A + Construct-B coverage. The v0.4.x line is ` +
      `scheduled for EOL 30 days post-v0.5.0.`,
    pluginName: '@blackunicorn/bonklm-elizaos',
  };
}

/**
 * Story 2.4a backwards-compat: emit a WARNING when
 * `acknowledgeClass4Risk: true` is set after Story 2.4a ships. The
 * flag is still ACCEPTED for one minor cycle for backward compat,
 * but the structural defence (shadow log) is now the canonical
 * mitigation — the deploy-time acknowledgement is no longer needed.
 */
export function warnAcknowledgeClass4RiskDeprecated(logger: Logger | undefined): void {
  logger?.warn(
    '[bonklm-elizaos] `acknowledgeClass4Risk: true` is no longer needed in v0.5+ — Story 2.4a ' +
    'ships shadow-log structural defence (Construct A). The flag is accepted for one minor ' +
    'cycle for backward compat and will throw in v0.6.'
  );
}
