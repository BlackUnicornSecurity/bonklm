/**
 * Connector Remove Command
 *
 * Removes a connector's credentials from the project `.env`. Registry-gated:
 * the id must resolve to a known connector, and only that connector's declared
 * env vars are removed. The user is shown the affected keys and prompted for
 * confirmation unless `--yes` is passed.
 *
 * `connector remove` has no dedicated upstream design doc, so it is built as the
 * inverse of `connector add` — same id-validation guard, same registry gating,
 * same audit trail — so the two behave consistently.
 *
 * As with `connector test`, the command surface is a thin shell over
 * {@link runConnectorRemove}, which holds all decision logic and accepts
 * injectable I/O (env read/write, audit, confirmation) for unit testing
 * without filesystem or prompt side effects.
 *
 * Exit codes: `0` on success, "nothing to remove", or a declined confirmation
 * (no harm done); `1` for an invalid id, unknown connector, or an aborted
 * (Ctrl-C) confirmation.
 *
 * @module commands/connector-remove
 */

import { Command } from 'commander';
import { EnvManager } from '../config/env.js';
import { getConnector } from '../connectors/registry.js';
import { type AuditEvent, AuditLogger, createAuditEvent, safeAudit } from '../utils/audit.js';
import { ExitCode, WizardError } from '../utils/error.js';
import { sanitizeLogString } from '../../common/index.js';
import { formatAvailableConnectors, isValidConnectorIdFormat } from './connector-id.js';

/**
 * Discriminator for the outcome of a connector removal.
 *
 * - `removed` — keys were removed and the `.env` was rewritten.
 * - `nothing-to-remove` — no matching keys were present.
 * - `invalid-id` — the id is structurally malformed.
 * - `unknown-connector` — the id is well-formed but not in the registry.
 * - `declined` — the user answered "no" at the confirmation prompt.
 * - `cancelled` — the user aborted the confirmation (Ctrl-C).
 * - `env-error` — the `.env` could not be read or written (permissions, non-UTF-8,
 *   or a retained entry the writer cannot round-trip).
 */
export type ConnectorRemoveStatus =
  | 'removed'
  | 'nothing-to-remove'
  | 'invalid-id'
  | 'unknown-connector'
  | 'declined'
  | 'cancelled'
  | 'env-error';

/**
 * Structured result of {@link runConnectorRemove}. Pure data — no side effects,
 * no `process.exit`.
 */
export interface ConnectorRemoveReport {
  /** Outcome discriminator. */
  readonly status: ConnectorRemoveStatus;
  /** The (sanitized-at-render) connector id that was requested. */
  readonly connectorId: string;
  /** The connector's display name, when the id resolved to a connector. */
  readonly connectorName?: string;
  /**
   * The connector's env-var keys that were present in `.env` — i.e. the keys
   * that were (or would have been) removed. Empty for `nothing-to-remove`.
   */
  readonly affectedKeys?: string[];
  /** Sanitized error detail, present when `status === 'env-error'`. */
  readonly error?: string;
  /** Suggested exit code: 0 success/no-op/declined, 1 user-error/cancelled/env-error. */
  readonly exitCode: 0 | 1;
}

/**
 * Context handed to the confirmation callback.
 */
export interface ConnectorRemoveConfirmContext {
  readonly connectorId: string;
  readonly connectorName: string;
  readonly keys: string[];
}

/**
 * Injectable dependencies for {@link runConnectorRemove}. All optional; the
 * defaults perform real I/O and an interactive prompt.
 */
export interface ConnectorRemoveDeps {
  /** Reads the current `.env` map. */
  readEnv?: () => Promise<Record<string, string>>;
  /** Writes the new `.env` map (atomic, non-merge replace). */
  writeEnv?: (entries: Record<string, string>) => Promise<void>;
  /** Audit sink (defaults to a real {@link AuditLogger}). */
  audit?: { log: (event: AuditEvent) => Promise<void> };
  /**
   * Confirmation prompt. Returns `true` to proceed, `false` to decline; throws
   * to signal an abort (Ctrl-C). Not called when `--yes` is set.
   */
  confirm?: (context: ConnectorRemoveConfirmContext) => Promise<boolean>;
}

/**
 * Default interactive confirmation via @clack/prompts. Shows the affected keys
 * (names only — never values), then asks to proceed. Throws a `WizardError` if
 * the user aborts (Ctrl-C), which {@link runConnectorRemove} maps to the
 * `cancelled` outcome.
 */
async function defaultConfirm(context: ConnectorRemoveConfirmContext): Promise<boolean> {
  const p = await import('@clack/prompts');
  p.log.warn(`The following keys will be removed from .env for ${context.connectorName}:`);
  for (const key of context.keys) {
    p.log.message(`  ${key}`);
  }
  const answer = await p.confirm({
    message: `Remove ${context.connectorName} (${context.connectorId})?`,
    initialValue: false
  });
  if (p.isCancel(answer)) {
    throw new WizardError('USER_CANCELLED', 'Removal cancelled', undefined, undefined, ExitCode.ERROR);
  }
  return answer === true;
}

/**
 * Remove a connector's credentials from the `.env`. Pure decision logic with
 * injectable I/O; never calls `process.exit`.
 *
 * @param id - The connector id from the CLI argument.
 * @param options - `{ yes }` skips the confirmation prompt.
 * @param deps - Injectable dependencies (see {@link ConnectorRemoveDeps}).
 * @returns A {@link ConnectorRemoveReport}.
 */
export async function runConnectorRemove(
  id: string,
  options: { yes?: boolean } = {},
  deps: ConnectorRemoveDeps = {}
): Promise<ConnectorRemoveReport> {
  const {
    readEnv = () => new EnvManager().read(),
    writeEnv = entries => new EnvManager().write(entries, false),
    audit = new AuditLogger(),
    confirm = defaultConfirm
  } = deps;

  if (!isValidConnectorIdFormat(id)) {
    return { status: 'invalid-id', connectorId: id, exitCode: 1 };
  }

  const connector = getConnector(id);
  if (!connector) {
    return { status: 'unknown-connector', connectorId: id, exitCode: 1 };
  }

  let env: Record<string, string>;
  try {
    env = await readEnv();
  } catch (error) {
    // Unlike `connector test` (which can treat an unreadable .env as "no config"),
    // removal must NOT silently proceed on a read failure — surface it as a clean
    // exit-1 report rather than letting the WizardError escape as an unhandled
    // rejection (bin/run.ts has no catch around the async action).
    return {
      status: 'env-error',
      connectorId: id,
      connectorName: connector.name,
      error: sanitizeLogString(error instanceof Error ? error.message : 'unknown error'),
      exitCode: 1
    };
  }

  const envVars = connector.detection.envVars ?? [];
  const affectedKeys = envVars.filter(envVar => envVar in env);

  if (affectedKeys.length === 0) {
    return {
      status: 'nothing-to-remove',
      connectorId: id,
      connectorName: connector.name,
      affectedKeys: [],
      exitCode: 0
    };
  }

  if (!options.yes) {
    let proceed: boolean;
    try {
      proceed = await confirm({ connectorId: id, connectorName: connector.name, keys: affectedKeys });
    } catch {
      return { status: 'cancelled', connectorId: id, connectorName: connector.name, affectedKeys, exitCode: 1 };
    }
    if (!proceed) {
      return { status: 'declined', connectorId: id, connectorName: connector.name, affectedKeys, exitCode: 0 };
    }
  }

  // Atomic, non-merge write: the remaining entries fully replace the .env, so
  // the affected keys are dropped. (EnvManager.write(_, false) reformats to
  // KEY=value lines — the same normalisation `connector add` performs.)
  const remaining: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (!affectedKeys.includes(key)) {
      remaining[key] = value;
    }
  }
  try {
    await writeEnv(remaining);
  } catch (error) {
    // A retained entry the writer cannot round-trip (e.g. a multi-line value or a
    // non-`[A-Za-z_]`-keyed var in a hand-edited .env) makes EnvManager.write throw
    // AFTER the user confirmed. Report it cleanly; nothing was written (atomic).
    return {
      status: 'env-error',
      connectorId: id,
      connectorName: connector.name,
      affectedKeys,
      error: sanitizeLogString(error instanceof Error ? error.message : 'unknown error'),
      exitCode: 1
    };
  }
  // Only the destructive 'removed' path is audited: the nothing-to-remove,
  // declined, and cancelled outcomes change nothing on disk, so there is no
  // security-relevant event to record.
  await safeAudit(audit, createAuditEvent('connector_removed', id, true));

  return { status: 'removed', connectorId: id, connectorName: connector.name, affectedKeys, exitCode: 0 };
}

/**
 * Options accepted by the `connector remove` command.
 */
interface ConnectorRemoveOptions {
  yes?: boolean;
}

/**
 * Renders a removal report for the user. The echoed id is `sanitizeLogString`-
 * hardened; removed key names are connector-declared constants (not user input).
 */
export function renderConnectorRemoveHuman(report: ConnectorRemoveReport): void {
  const safeId = sanitizeLogString(report.connectorId);
  switch (report.status) {
    case 'removed':
      console.log(`✓ Removed ${report.connectorName} (${safeId}): ${(report.affectedKeys ?? []).join(', ')}`);
      return;
    case 'nothing-to-remove':
      console.log(`✓ Nothing to remove for ${report.connectorName} (${safeId}); no matching keys in .env.`);
      return;
    case 'declined':
      console.log('Removal cancelled — no changes made.');
      return;
    case 'cancelled':
      console.error('Removal aborted.');
      return;
    case 'env-error':
      console.error(`✗ Could not update .env for ${report.connectorName} (${safeId}): ${report.error}`);
      console.error('  Check the file exists, is readable/writable, and contains valid KEY=value lines.');
      return;
    case 'invalid-id':
      console.error(`✗ Invalid connector ID: ${safeId}`);
      console.error(`  Connector IDs must match [a-z][a-z0-9-]* (max 50 chars).`);
      console.error(`  Available connectors: ${formatAvailableConnectors()}`);
      return;
    case 'unknown-connector':
      console.error(`✗ Unknown connector: ${safeId}`);
      console.error(`  Available connectors: ${formatAvailableConnectors()}`);
      return;
  }
}

/**
 * Connector remove command implementation (thin shell over {@link runConnectorRemove}).
 */
export const connectorRemoveCommand = new Command('remove')
  .argument('<id>', 'Connector ID (e.g., openai, anthropic, ollama)')
  .description('Remove a connector configuration')
  .option('--yes', 'Skip confirmation prompt')
  .action(async (id: string, options: ConnectorRemoveOptions) => {
    const report = await runConnectorRemove(id, { yes: options.yes });
    renderConnectorRemoveHuman(report);
    if (report.exitCode !== 0) {
      process.exit(report.exitCode);
    }
  });
