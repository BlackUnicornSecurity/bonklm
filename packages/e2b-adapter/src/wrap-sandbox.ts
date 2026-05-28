/**
 * Story 3.5 — `wrapSandbox(sandbox, options)` for E2B
 * ====================================================
 *
 * Proxies the four E2B surface families:
 *   - `commands.run(command)` → validateCode (shell metachar / package
 *     install / network egress detection).
 *   - `runCode(code)` → validateCode (Python/JS dynamic exec detection).
 *   - `files.write(path, content)` → validatePath(path) +
 *     validateCode(content).
 *   - `files.read(path)` / `files.remove(path)` / `files.list(path)`
 *     → validatePath(path).
 *
 * **EXPERIMENTAL (Story 3.5)**: package.json carries
 * `experimental: true`. Recall-benchmark gate at v0.7 promotes to
 * stable contingent on Story 3.2 corpus.
 *
 * **Fail-CLOSED default**: on validator throw/timeout, blocks the
 * sandbox call. Opt-out via `onSandboxError: 'allow'`.
 */
import { validateCode, validatePath } from '@blackunicorn/bonklm-sandbox-utils';
import type { E2BSandboxLike, E2BSurface, E2BWrapOptions } from './types.js';

export class E2BGuardrailBlockedError extends Error {
  override readonly name = 'E2BGuardrailBlockedError';
  readonly surface: E2BSurface;
  readonly category?: string;

  constructor(message: string, surface: E2BSurface, category?: string) {
    super(message);
    this.surface = surface;
    this.category = category;
  }
}

// Sprint 24 Story 4.5 GRADUATED: experimental banner removed.
// R2-13 corpus gate passed (recall 100% / FPR 0% / precision 100%).
// See packages/core/benchmarks/sandbox-attack-corpus/graduation-report.json
// and packages/core/benchmarks/sandbox-attack-corpus/evidence.md.

/**
 * Returns a Proxy-style wrapped sandbox. The original sandbox object
 * is NOT mutated; we return a new wrapper with the same method
 * surface plus inline validators.
 */
export function wrapSandbox<S extends E2BSandboxLike>(
  sandbox: S,
  options: E2BWrapOptions = {}
): S {
  if (!sandbox || typeof sandbox !== 'object') {
    throw new TypeError('wrapSandbox: sandbox is required.');
  }

  const cwd = options.cwd ?? '/';
  // Sprint 19 audit closure (architect B1 + security B-1 + code-reviewer
  // BLOCK): wrapper-scoped key for AAD-4 WARN suppression. ALL
  // validator calls from THIS wrapped sandbox share suppression; calls
  // from a different wrapped sandbox get their own group.
  const wrapperKey: object = {};
  const validatorOpts = {
    onSandboxError: options.onSandboxError ?? 'block',
    timeoutMs: options.timeoutMs,
    nodeEnv: options.nodeEnv,
    warn: options.warn,
    wrapperKey,
  };

  const wrapped: E2BSandboxLike = {
    commands: {
      run: async (
        commandOrBinary: string,
        argsOrOpts?: string[] | unknown,
        opts?: unknown
      ) => {
        // Sprint 19 audit security C-1 closure: detect E2B's
        // `commands.run(binary, args[], opts)` overload + validate the
        // combined command string. Single-string overload validates as-is.
        let combinedCommand: string;
        let actualOpts: unknown;
        if (Array.isArray(argsOrOpts)) {
          combinedCommand = `${commandOrBinary} ${argsOrOpts.join(' ')}`;
          actualOpts = opts;
        } else {
          combinedCommand = commandOrBinary;
          actualOpts = argsOrOpts;
        }
        const result = await validateCode(combinedCommand, validatorOpts);
        if (result.blocked) {
          fireBlock(options, 'commands.run', result, combinedCommand);
          throw new E2BGuardrailBlockedError(
            `E2B commands.run blocked: ${result.reason ?? 'unknown'}`,
            'commands.run',
            result.category
          );
        }
        if (Array.isArray(argsOrOpts)) {
          return (sandbox.commands.run as (binary: string, args: string[], opts?: unknown) => Promise<unknown>)(
            commandOrBinary,
            argsOrOpts,
            actualOpts
          );
        }
        return sandbox.commands.run(commandOrBinary, actualOpts);
      },
    },
    files: {
      write: async (path: string, content: string | Uint8Array, opts?: unknown) => {
        // 1. Path validation
        const pathResult = await validatePath(path, cwd, validatorOpts);
        if (pathResult.blocked) {
          fireBlock(options, 'files.write', pathResult, path);
          throw new E2BGuardrailBlockedError(
            `E2B files.write path blocked: ${pathResult.reason ?? 'unknown'}`,
            'files.write',
            pathResult.category
          );
        }
        // 2. Content validation (only when string — raw bytes pass
        //    per Story 3.1 audio-stream precedent).
        if (typeof content === 'string') {
          const contentResult = await validateCode(content, validatorOpts);
          if (contentResult.blocked) {
            fireBlock(options, 'files.write', contentResult, content);
            throw new E2BGuardrailBlockedError(
              `E2B files.write content blocked: ${contentResult.reason ?? 'unknown'}`,
              'files.write',
              contentResult.category
            );
          }
        }
        return sandbox.files.write(path, content, opts);
      },
      read: async (path: string, opts?: unknown) => {
        const pathResult = await validatePath(path, cwd, validatorOpts);
        if (pathResult.blocked) {
          fireBlock(options, 'files.read', pathResult, path);
          throw new E2BGuardrailBlockedError(
            `E2B files.read blocked: ${pathResult.reason ?? 'unknown'}`,
            'files.read',
            pathResult.category
          );
        }
        return sandbox.files.read(path, opts);
      },
      remove: async (path: string, opts?: unknown) => {
        const pathResult = await validatePath(path, cwd, validatorOpts);
        if (pathResult.blocked) {
          fireBlock(options, 'files.remove', pathResult, path);
          throw new E2BGuardrailBlockedError(
            `E2B files.remove blocked: ${pathResult.reason ?? 'unknown'}`,
            'files.remove',
            pathResult.category
          );
        }
        return sandbox.files.remove(path, opts);
      },
      list: async (path: string, opts?: unknown) => {
        const pathResult = await validatePath(path, cwd, validatorOpts);
        if (pathResult.blocked) {
          fireBlock(options, 'files.list', pathResult, path);
          throw new E2BGuardrailBlockedError(
            `E2B files.list blocked: ${pathResult.reason ?? 'unknown'}`,
            'files.list',
            pathResult.category
          );
        }
        return sandbox.files.list?.(path, opts);
      },
    },
  };

  // runCode is optional in the E2B SDK; only proxy if present.
  if (typeof sandbox.runCode === 'function') {
    (wrapped).runCode = async (code: string, opts?: unknown) => {
      const result = await validateCode(code, validatorOpts);
      if (result.blocked) {
        fireBlock(options, 'runCode', result, code);
        throw new E2BGuardrailBlockedError(
          `E2B runCode blocked: ${result.reason ?? 'unknown'}`,
          'runCode',
          result.category
        );
      }
      return sandbox.runCode!(code, opts);
    };
  }

  return wrapped as S;
}

function fireBlock(
  options: E2BWrapOptions,
  surface: E2BSurface,
  result: { reason?: string; category?: string },
  payload: string | Uint8Array
): void {
  if (!options.onBlock) return;
  try {
    options.onBlock({
      surface,
      reason: result.reason ?? 'unknown',
      category: result.category,
      payload: typeof payload === 'string' ? payload : '[binary]',
    });
  } catch (err) {
    // Sprint 19 audit security C-2 closure: route telemetry failures
    // through onError so operators are notified rather than silent
    // swallow.
    if (options.onError) {
      try {
        options.onError(err);
      } catch {
        /* nothing more we can do */
      }
    }
  }
}
