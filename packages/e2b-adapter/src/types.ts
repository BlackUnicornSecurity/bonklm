/**
 * e2b-adapter types
 * ==============================
 *
 * Structural type for E2B Sandbox (peer-optional). We do NOT import
 * `@e2b/code-interpreter` to keep the connector installable without
 * the SDK present.
 */
import type { OnSandboxErrorAction, SandboxValidationResult } from '@blackunicorn/bonklm-sandbox-utils';

/**
 * E2B surface tags emitted in `onBlock` events + `E2BGuardrailBlockedError.surface`.
 * Exported so consumers writing `if (err.surface === 'commands.run')`
 * get IDE completion (Sprint 19 audit code-reviewer C-2 + N closure).
 */
export type E2BSurface = 'commands.run' | 'runCode' | 'files.write' | 'files.read' | 'files.remove' | 'files.list';

/**
 * Subset of the E2B Sandbox surface we proxy.
 *
 * `commands.run` now exposes
 * BOTH overloads (single command string AND `(binary, args[])`). The
 * runtime in `wrap-sandbox.ts` detects array-args and validates each
 * arg + the binary as a combined string.
 *
 * the wrapped object
 * exposes ONLY the surfaces listed here. Methods E2B may add in
 * future SDK versions (`sandbox.process`, `sandbox.terminal`, etc.)
 * are NOT proxied; the wrapped object returns `undefined` for them.
 * Document explicitly in README so operators who spread or destructure
 * the wrapped object understand the surface contract.
 */
export interface E2BSandboxLike {
  commands: {
    run(command: string, opts?: unknown): Promise<unknown>;
    run(binary: string, args: string[], opts?: unknown): Promise<unknown>;
  };
  runCode?(code: string, opts?: unknown): Promise<unknown>;
  files: {
    write(path: string, content: string | Uint8Array, opts?: unknown): Promise<unknown>;
    read(path: string, opts?: unknown): Promise<unknown>;
    remove(path: string, opts?: unknown): Promise<unknown>;
    list?(path: string, opts?: unknown): Promise<unknown>;
  };
}

export interface E2BBlockEvent {
  surface: E2BSurface;
  reason: string;
  category?: string;
  payload?: string;
}

export interface E2BWrapOptions {
  /**
   * Sandbox cwd. Required for PathTraversal validation. Default: `/`.
   */
  cwd?: string;
  /**
   * Fail-CLOSED default. See sandbox-utils.OnSandboxErrorAction docs.
   * @default 'block'
   */
  onSandboxError?: OnSandboxErrorAction;
  /** Per-call validator timeout. */
  timeoutMs?: number;
  /** NODE_ENV override (tests). */
  nodeEnv?: string;
  /** Fires on every BLOCK (code or path). */
  onBlock?: (event: E2BBlockEvent) => void;
  /** Logger sink for the AAD-4 fail-open WARN. */
  warn?: (label: string, context: Record<string, unknown>) => void;
  /**
   * error sink for telemetry
   * failures (`onBlock` throw, `warn` throw, etc.). When unset, errors
   * are silently swallowed.
   */
  onError?: (err: unknown) => void;
}

export type { OnSandboxErrorAction, SandboxValidationResult };
