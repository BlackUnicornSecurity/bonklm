/**
 * @blackunicorn/bonklm-hono — Type Definitions
 * =============================================
 * Duck-typed shapes mirroring `hono ^4.12.x` so this connector compiles
 * without a hard compile-time dependency on the Hono SDK's exact types.
 * The real SDK is a peer dep; consumers wire via `app.use('*', honoGuardrails(...))`.
 *
 * Peer `hono ^4.12.34` is floored at the security override this project pins,
 * the lowest Hono the workspace can resolve. Hono 4.x is post-1.0 and stable
 * across minors, but the v5 ABI may break — we re-align this file when bumping
 * the peer range.
 */
import type { Logger, Validator } from '@blackunicorn/bonklm';

/**
 * Duck-typed Hono `Context` (subset). Hono's real type is generic on
 * the env/variables; we only touch `req`, `json`, and `text`.
 */
export interface HonoContextLike {
  req: {
    method: string;
    raw: Request;
    header: (name: string) => string | undefined;
  };
  json: (data: unknown, status?: number) => Response;
  text: (data: string, status?: number) => Response;
}

/**
 * Duck-typed Hono `Next` (no args, returns Promise<void>).
 */
export type HonoNext = () => Promise<void>;

/**
 * Duck-typed Hono MiddlewareHandler signature.
 */
export type HonoMiddlewareHandler = (c: HonoContextLike, next: HonoNext) => Promise<Response | void>;

/**
 * Configuration for {@link honoGuardrails}.
 */
export interface HonoGuardrailsOptions {
  /** Logger. @default `createLogger('console')` */
  logger?: Logger;

  /**
   * Override the validator chain. When omitted, the engine's
   * pre-configured validators are used.
   *
   * Use case: a route that requires DIFFERENT validators than the
   * engine's defaults. Pass an explicit list here.
   */
  validators?: Validator[];

  /**
   * Restrict body validation to specific JSON fields. When set, ONLY
   * these fields are extracted + validated; other fields pass through
   * untouched. Useful when a chat endpoint accepts both user input
   * (validate) and structured config (don't validate).
   *
   * When omitted (default): the full request body is validated as a
   * single concatenated text payload.
   */
  bodyFields?: string[];

  /**
   * HTTP methods that trigger body validation. Defaults to
   * `['POST', 'PUT', 'PATCH']`. GET / HEAD / OPTIONS / DELETE skip
   * validation by default (no body or idempotent).
   */
  validateMethods?: ReadonlyArray<string>;

  /**
   * Production-mode flag — when true, error responses flip to generic
   * strings (no leakage of validator internals).
   * @default `process.env.NODE_ENV === 'production'` on Node;
   *          `false` on edge runtimes where `process` is absent.
   */
  productionMode?: boolean;

  /**
   * Callback fired when validation blocks a request. Useful for
   * telemetry forwarding.
   */
  onBlocked?: (reason: string, category: string) => void;
}

/**
 * Shape of the JSON error response returned to the client when
 * validation blocks. Consumers of the middleware can rely on this
 * contract for client-side error handling.
 */
export interface HonoGuardrailsErrorResponse {
  /** Human-readable error message. */
  error: string;
  /** Error category (e.g. 'validation_failed'). */
  category: string;
  /** Optional risk-level enrichment. */
  severity?: string;
}
