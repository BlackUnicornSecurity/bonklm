/**
 * @blackunicorn/bonklm-eko — wrapEko
 * =================================
 *
 * Wraps an Eko v4 client so:
 *
 *   - `eko.run(task)` validates the task as `composed_context` BEFORE
 *     the planner kicks off (AC: "multi-agent planner output validated
 *     at task-creation boundary").
 *   - BrowserAgent-shaped entries in `eko.agents` are wrapped via
 *     `wrapEkoBrowserAgent` — same act/extract/observe gating as
 *     Stagehand.
 *   - FileAgent-shaped entries route through `file.{read,write,delete}`
 *     events on the shared browser-agents-core union (`tool_call` surface).
 *   - MCP-tool dispatches (`eko.mcp.callTool`) route through `mcp.tool`
 *     events; the returned tool result is ALSO validated as a
 *     `retrieved_doc` (AC: "MCP tool results flow through
 *     RetrievedDocValidator").
 *
 * CUA mode (computer-use, screenshot-driven) is refused by default;
 * pass `allowCuaMode: true` to acknowledge the screenshot-bypass risk.
 * Identical contract to `wrapStagehand`.
 *
 * Story 2.3 audit closures apply here transitively:
 *   - All sub-actions go through the validator (the agent methods we
 *     wrap REPLACE the originals so the planner can't bypass).
 *   - `BrowserAgentGuardrailBlockedError` is the shared base class;
 *     `EkoGuardrailBlockedError` extends it.
 *   - Error reason sanitization, CUA synonym regex, console.warn
 *     fallback, fail-closed mode detection — all inherited.
 *
 * @package @blackunicorn/bonklm-eko
 */
import type { GuardrailEngine } from '@blackunicorn/bonklm';
import {
  assertNonCuaMode,
  BrowserAgentGuardrailBlockedError,
  type BrowserAgentValidateResult,
  emitWarning,
  isUnsafeBinaryResult,
  normaliseActArg,
  withBrowserAgentGuardrails,
} from '@blackunicorn/bonklm-browser-agents-core';
import type {
  EkoBrowserAgentLike,
  EkoFileAgentLike,
  EkoLike,
  EkoMcpClientLike,
  EkoRunTask,
  WrapEkoOptions,
} from './types.js';

/**
 * Per-Eko BLOCKED error. Extends the shared base; consumers can
 * `catch (e) { if (e instanceof EkoGuardrailBlockedError) ... }`
 * OR catch the base for cross-connector handling.
 */
export class EkoGuardrailBlockedError extends BrowserAgentGuardrailBlockedError {
  constructor(
    action: string,
    surface: BrowserAgentValidateResult['surface'],
    reason: string | undefined
  ) {
    super('eko', action, surface, reason);
    this.name = 'EkoGuardrailBlockedError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// CUA detection hoisted to `@blackunicorn/bonklm-browser-agents-core`
// (sprint-13 cumulative-audit arch X4 + sec CS2 closure). Single
// source of truth for the synonym regex + mode-field walk.
// Note: Story 2.4 audit-rev-B4 removed an unused ALREADY_VALIDATED_SENTINEL
// here — wrapEko replaces methods in place so re-entry is a
// programming error, not a planner path that needs short-circuiting.

/**
 * Wrap an Eko v4 client. Returns the same instance with `run` +
 * agent registry + MCP dispatch all intercepted.
 *
 * @example
 * ```ts
 * import { Eko } from '@eko-ai/eko';
 * import { wrapEko, EkoGuardrailBlockedError } from '@blackunicorn/bonklm-eko';
 *
 * const eko = new Eko({ llms, agents });
 * const guarded = wrapEko(eko, engine);
 *
 * try {
 *   const result = await guarded.run({ task: 'Book a flight to NYC' });
 * } catch (err) {
 *   if (err instanceof EkoGuardrailBlockedError) { ... }
 * }
 * ```
 */
export function wrapEko<T extends EkoLike>(
  client: T,
  engine: GuardrailEngine,
  options: WrapEkoOptions = {}
): T {
  if (client === null || typeof client !== 'object') {
    throw new Error('wrapEko: client must be a non-null object.');
  }
  if (engine === undefined || typeof engine.validate !== 'function') {
    throw new Error('wrapEko: engine must be a GuardrailEngine instance.');
  }

  const { allowCuaMode = false, logger, ekoConfig, skipAgents = [] } = options;

  // Fail-closed CUA preflight via shared helper (single source of
  // truth in browser-agents-core/shared-helpers.ts).
  assertNonCuaMode('wrapEko', client as object, {
    allowCuaMode,
    configOverride: ekoConfig,
  });

  const guarded = withBrowserAgentGuardrails(client as object, {
    engine,
    allowCuaMode,
    logger,
  });

  // ── Intercept eko.run — composed_context at task-creation boundary.
  const originalRun = client.run.bind(client);
  const validatedRun = async (task: EkoRunTask): Promise<unknown> => {
    const taskString = typeof task === 'string' ? task : task.task;
    if (typeof taskString !== 'string' || taskString.length === 0) {
      throw new EkoGuardrailBlockedError(
        'run',
        'composed_context',
        'eko.run: task MUST be a non-empty string'
      );
    }
    const r = await (
      guarded as { bonklm: { validateEvent: typeof guarded.bonklm.validateEvent } }
    ).bonklm.validateEvent({ kind: 'agent.execute', task: taskString });
    if (r.blocked) {
      throw new EkoGuardrailBlockedError('run', r.surface, r.reason);
    }
    return originalRun(task);
  };
  (client as { run: T['run'] }).run = validatedRun as T['run'];
  (guarded as unknown as { run: T['run'] }).run = validatedRun as T['run'];

  // ── Intercept the agent registry. Each entry gets shape-detected
  // ── and wrapped in place.
  //
  // **Construction-order doc (sec B7)**: `wrapEko` MUST be called
  // BEFORE the Eko planner starts (or before any caller captures a
  // reference to an agent method). After `wrapEko` returns, the
  // agents in `client.agents` have their methods REPLACED. Any code
  // holding a captured `agent.act` reference from BEFORE this call
  // bypasses validation.
  //
  // **Runtime-registration limitation (sec B6)**: agents added to
  // `client.agents` AFTER `wrapEko` returns are NOT wrapped. If your
  // Eko deployment supports `eko.registerAgent(...)` at runtime, you
  // MUST call `wrapEkoBrowserAgent` / `wrapEkoFileAgent` on the new
  // agent before any planner dispatch.
  //
  // **Hybrid-agent dual-wrap (rev B1)**: an agent exposing BOTH
  // `act` and `read`/`write`/`delete` is wrapped by BOTH branches.
  // The two wrappers touch disjoint method names so they don't
  // collide today; any future wrapper expanding to a shared method
  // name MUST be added to the disjoint-set invariant tests below.
  if (client.agents !== undefined && typeof client.agents === 'object' && client.agents !== null) {
    const skipSet = new Set(skipAgents);
    const allNames = Object.keys(client.agents);

    // sec B4 closure: warn if skipAgents covers ALL discovered
    // agents — silent total bypass.
    if (allNames.length > 0 && allNames.every((n) => skipSet.has(n))) {
      emitWarning(
        logger,
        '[bonklm-eko] skipAgents covers ALL registered agents — sub-action ' +
          'guardrails are entirely disabled. Only the eko.run boundary is gated.'
      );
    }

    for (const [name, raw] of Object.entries(client.agents)) {
      if (skipSet.has(name)) continue;
      if (raw === null || typeof raw !== 'object') continue;
      const agent = raw as EkoBrowserAgentLike & EkoFileAgentLike;
      // BrowserAgent shape: has act / extract / observe.
      if (typeof agent.act === 'function') {
        wrapBrowserAgentInPlace(agent, guarded as unknown as { bonklm: typeof guarded.bonklm });
      }
      // FileAgent shape: has read / write / delete on path.
      if (
        typeof agent.read === 'function' ||
        typeof agent.write === 'function' ||
        typeof agent.delete === 'function'
      ) {
        wrapFileAgentInPlace(agent, guarded as unknown as { bonklm: typeof guarded.bonklm });
      }
    }
  }

  // ── Intercept eko.mcp.callTool — validates args BEFORE dispatch +
  // ── validates the tool RESULT as a retrieved_doc.
  if (client.mcp !== undefined && typeof client.mcp.callTool === 'function') {
    wrapMcpInPlace(
      client.mcp,
      guarded as unknown as { bonklm: typeof guarded.bonklm }
    );
  }

  return guarded as unknown as T;
}

/**
 * Wrap a single BrowserAgent in place. Internal helper used by
 * `wrapEko` when walking the agent registry; ALSO exported for
 * consumers who want to wrap an agent directly outside the Eko
 * client (e.g. testing fixtures).
 */
export function wrapEkoBrowserAgent<A extends EkoBrowserAgentLike>(
  agent: A,
  engine: GuardrailEngine,
  options: WrapEkoOptions = {}
): A {
  const stub: EkoLike = {
    run: async () => undefined,
  };
  const guardedStub = withBrowserAgentGuardrails(stub as object, {
    engine,
    allowCuaMode: options.allowCuaMode ?? false,
    logger: options.logger,
  });
  wrapBrowserAgentInPlace(agent, guardedStub as unknown as { bonklm: typeof guardedStub.bonklm });
  return agent;
}

/**
 * Wrap a single FileAgent in place. Same intent as
 * `wrapEkoBrowserAgent`, but for file-op surfaces.
 */
export function wrapEkoFileAgent<A extends EkoFileAgentLike>(
  agent: A,
  engine: GuardrailEngine,
  options: WrapEkoOptions = {}
): A {
  const stub: EkoLike = {
    run: async () => undefined,
  };
  const guardedStub = withBrowserAgentGuardrails(stub as object, {
    engine,
    allowCuaMode: options.allowCuaMode ?? false,
    logger: options.logger,
  });
  wrapFileAgentInPlace(agent, guardedStub as unknown as { bonklm: typeof guardedStub.bonklm });
  return agent;
}

// ─────────────────────────────────────────────────────────────────────
// Internal helpers — in-place wrappers.
// ─────────────────────────────────────────────────────────────────────

function wrapBrowserAgentInPlace(
  agent: EkoBrowserAgentLike,
  guarded: { bonklm: { validateEvent: (event: import('@blackunicorn/bonklm-browser-agents-core').BrowserAgentEvent) => Promise<BrowserAgentValidateResult> } }
): void {
  if (typeof agent.act === 'function') {
    const originalAct = agent.act.bind(agent);
    agent.act = async (
      actionArg: string | { action: string; [k: string]: unknown }
    ): Promise<unknown> => {
      const { actionString, args } = normaliseActArg(actionArg);
      const r = await guarded.bonklm.validateEvent({
        kind: 'act',
        action: actionString,
        args,
      });
      if (r.blocked) throw new EkoGuardrailBlockedError('act', r.surface, r.reason);
      return originalAct(actionArg);
    };
  }
  if (typeof agent.extract === 'function') {
    const originalExtract = agent.extract.bind(agent);
    agent.extract = (async <U = unknown>(
      opts: string | { instruction: string; schema?: unknown; [k: string]: unknown }
    ): Promise<U> => {
      const schema =
        typeof opts === 'object' && opts !== null && 'schema' in opts
          ? (opts as { schema?: unknown }).schema
          : undefined;
      let result: U;
      try {
        result = (await originalExtract(opts as never)) as U;
      } catch (sdkErr) {
        const errText = sdkErr instanceof Error ? sdkErr.message : String(sdkErr);
        try {
          const r = await guarded.bonklm.validateEvent({
            kind: 'extract',
            schema,
            result: errText,
          });
          if (r.blocked) {
            throw new EkoGuardrailBlockedError('extract', r.surface, r.reason);
          }
        } catch (validatorErr) {
          if (validatorErr instanceof EkoGuardrailBlockedError) throw validatorErr;
        }
        throw sdkErr;
      }
      const r = await guarded.bonklm.validateEvent({
        kind: 'extract',
        schema,
        result,
      });
      if (r.blocked) {
        throw new EkoGuardrailBlockedError('extract', r.surface, r.reason);
      }
      return result;
    }) as typeof agent.extract;
  }
  if (typeof agent.observe === 'function') {
    const originalObserve = agent.observe.bind(agent);
    agent.observe = async (
      opts: string | { instruction: string; [k: string]: unknown }
    ): Promise<unknown> => {
      const prompt = typeof opts === 'string' ? opts : opts.instruction;
      const r = await guarded.bonklm.validateEvent({ kind: 'observe', prompt });
      if (r.blocked) {
        throw new EkoGuardrailBlockedError('observe', r.surface, r.reason);
      }
      return originalObserve(opts);
    };
  }
}

function wrapFileAgentInPlace(
  agent: EkoFileAgentLike,
  guarded: { bonklm: { validateEvent: (event: import('@blackunicorn/bonklm-browser-agents-core').BrowserAgentEvent) => Promise<BrowserAgentValidateResult> } }
): void {
  // file.read — validate the PATH before dispatch (path traversal /
  // tool_call surface). Result validation OPTIONAL — many file
  // contents would force a retrieved_doc check on every read which
  // is heavy; v0.5 ships with path-only validation and a doc note.
  if (typeof agent.read === 'function') {
    const originalRead = agent.read.bind(agent);
    agent.read = async (path: string): Promise<string> => {
      const normalised = canonicalisePath(path);
      const r = await guarded.bonklm.validateEvent({
        kind: 'file',
        op: 'read',
        path: normalised,
      });
      if (r.blocked) throw new EkoGuardrailBlockedError('file.read', r.surface, r.reason);
      return originalRead(path);
    };
  }
  if (typeof agent.write === 'function') {
    const originalWrite = agent.write.bind(agent);
    agent.write = async (path: string, content: string): Promise<unknown> => {
      const normalised = canonicalisePath(path);
      const r = await guarded.bonklm.validateEvent({
        kind: 'file',
        op: 'write',
        path: normalised,
        content,
      });
      if (r.blocked) throw new EkoGuardrailBlockedError('file.write', r.surface, r.reason);
      return originalWrite(path, content);
    };
  }
  if (typeof agent.delete === 'function') {
    const originalDelete = agent.delete.bind(agent);
    agent.delete = async (path: string): Promise<unknown> => {
      const normalised = canonicalisePath(path);
      const r = await guarded.bonklm.validateEvent({
        kind: 'file',
        op: 'delete',
        path: normalised,
      });
      if (r.blocked) throw new EkoGuardrailBlockedError('file.delete', r.surface, r.reason);
      return originalDelete(path);
    };
  }
}

/**
 * sec B5 closure: normalise a file path to a canonical form BEFORE
 * the validator sees it. Without this, a path like `..//../etc/passwd`
 * may normalise differently in the validator vs the underlying file
 * agent (TOCTOU) — bypass risk.
 *
 * We use POSIX-style collapsing (`/`-delimited). For non-string or
 * empty input we BLOCK by returning a sentinel that any path
 * validator should refuse.
 */
function canonicalisePath(p: unknown): string {
  if (typeof p !== 'string' || p.length === 0) {
    return '[bonklm:invalid-path]';
  }
  // Replace any sequence of `\` with `/` then collapse `//+` to `/`.
  let normalised = p.replace(/\\+/g, '/').replace(/\/+/g, '/');
  // Resolve `.` and `..` segments without `node:path` (edge-runtime safe).
  const parts = normalised.split('/');
  const resolved: string[] = [];
  for (const seg of parts) {
    if (seg === '' || seg === '.') {
      if (resolved.length === 0 && seg === '') resolved.push(''); // preserve absolute leading slash
      continue;
    }
    if (seg === '..') {
      // Pop unless we're at root (preserves attacker intent in the
      // canonical form so PathTraversalValidator can match on
      // explicit `..` ascent signals).
      if (resolved.length > 0 && resolved[resolved.length - 1] !== '') {
        resolved.pop();
      } else {
        // Below root — preserve as explicit `..` marker.
        resolved.push('..');
      }
      continue;
    }
    resolved.push(seg);
  }
  normalised = resolved.join('/');
  if (normalised === '') normalised = '/';
  return normalised;
}

function wrapMcpInPlace(
  mcp: EkoMcpClientLike,
  guarded: { bonklm: { validateEvent: (event: import('@blackunicorn/bonklm-browser-agents-core').BrowserAgentEvent) => Promise<BrowserAgentValidateResult> } }
): void {
  if (typeof mcp.callTool !== 'function') return;
  const originalCallTool = mcp.callTool.bind(mcp);
  mcp.callTool = async (
    server: string,
    tool: string,
    args?: Record<string, unknown>
  ): Promise<unknown> => {
    // ── B3-sec closure: reject server/tool names that would corrupt
    // the canonical `toolName` key. `${server}/${tool}` is used by
    // validator allow-list / deny-list rules; if either contains a
    // `/`, an attacker can shift the boundary and bypass per-server
    // rules (e.g. `server: 'admin/rm-rf', tool: 'innocuous'`).
    if (typeof server !== 'string' || server.length === 0 || server.includes('/')) {
      throw new EkoGuardrailBlockedError(
        'mcp.tool',
        'tool_call',
        'MCP server name must be a non-empty string and MUST NOT contain "/"'
      );
    }
    if (typeof tool !== 'string' || tool.length === 0 || tool.includes('/')) {
      throw new EkoGuardrailBlockedError(
        'mcp.tool',
        'tool_call',
        'MCP tool name must be a non-empty string and MUST NOT contain "/"'
      );
    }

    // Validate the args BEFORE dispatch (tool_call surface).
    const preCall = await guarded.bonklm.validateEvent({
      kind: 'mcp.tool',
      server,
      tool,
      args,
    });
    if (preCall.blocked) {
      throw new EkoGuardrailBlockedError(
        `mcp.tool:${server}/${tool}`,
        preCall.surface,
        preCall.reason
      );
    }
    // Dispatch.
    const result = await originalCallTool(server, tool, args);

    // ── B2-sec closure: binary / async-iterable results bypass
    // text-based validators. Detect Buffer / Uint8Array / async
    // iterator and BLOCK with a clear reason rather than feeding a
    // lossy JSON.stringify into a content validator. Consumers who
    // need binary-validation in v0.5+ can wire a dedicated adapter.
    if (isUnsafeBinaryResult(result)) {
      throw new EkoGuardrailBlockedError(
        `mcp.tool:${server}/${tool}/result`,
        'retrieved_doc',
        'binary or streaming MCP result cannot be inspected — BonkLM v0.4 ' +
          'validators are text-only. Convert to UTF-8 string upstream or ' +
          'use a dedicated binary-content validator.'
      );
    }

    // Validate the RESULT as retrieved_doc (AC: "MCP tool results
    // flow through RetrievedDocValidator").
    const postCall = await guarded.bonklm.validateEvent({
      kind: 'extract',
      schema: { server, tool },
      result,
    });
    if (postCall.blocked) {
      throw new EkoGuardrailBlockedError(
        `mcp.tool:${server}/${tool}/result`,
        postCall.surface,
        postCall.reason
      );
    }
    return result;
  };
}

// (isUnsafeMcpResult, detectEkoMode, normaliseActArg removed — all
// hoisted to `@blackunicorn/bonklm-browser-agents-core`. See
// `shared-helpers.ts` for the single source of truth.)
