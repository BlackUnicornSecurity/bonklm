/**
 * @blackunicorn/bonklm-server — types
 * ==================================
 *
 * @package @blackunicorn/bonklm-server
 */
import type { Guard, GuardrailEngine, Logger, Validator } from '@blackunicorn/bonklm';

/**
 * Configuration for `createBonklmGuardrailServer`.
 *
 * `createBonklmGuardrailServer({ validators, hmacSecret })`.
 */
export interface BonklmServerOptions {
  /**
   * Validator pipeline. The server constructs an internal
   * `GuardrailEngine` from this array. Mutually-exclusive with
   * `engine`.
   */
  validators?: Validator[];

  /**
   * Guard pipeline (e.g. `SecretGuard`, `BashSafetyGuard`) added to
   * the internal engine alongside `validators`. Ignored when `engine`
   * is supplied.
   */
  guards?: Guard[];

  /**
   * Pre-built engine (alternative to `validators`). When supplied,
   * the server uses this engine directly. Useful for consumers who
   * wire `engine.onIntercept(...)` for audit telemetry before
   * passing the engine in.
   */
  engine?: GuardrailEngine;

  /**
   * HMAC shared secret for `X-Bonklm-Signature` verification.
   * REQUIRED — mandates HMAC auth on every route.
   *
   * @security MUST be at least 32 bytes of entropy. The server
   *   refuses to start with a shorter secret.
   */
  hmacSecret: string;

  /**
   * Static bearer secret configured in Portkey's webhook headers.
   * When set, `/portkey` uses this credential instead of HMAC.
   * @security Use at least 32 random characters and HTTPS.
   */
  portkeyWebhookSecret?: string;

  /**
   * Replay-window in ms. @default 300000 (5 minutes per AC).
   *
   * @security Lowering this below 60_000 (1 min) increases
   *   spurious-rejection rate on clock-skewed clients.
   */
  replayWindowMs?: number;

  /**
   * Maximum number of recently accepted signatures remembered for
   * replay rejection. At capacity the server fails closed
   * (`replay_cache_exhausted`, HTTP 503) rather than evicting
   * unexpired entries — size to window × peak accepted requests/second.
   * Ignored when {@link replayCache} is supplied. @default 100000
   */
  replayCacheSize?: number;

  /**
   * Injectable seen-signature cache (structural interface — e.g. a
   * Redis-backed implementation for multi-replica deployments where the
   * default per-process cache cannot provide a cross-instance
   * guarantee). Must return `'first'` exactly once per signature within
   * the retention window, `'replay'` for duplicates, and `'full'` when
   * at capacity (the server then fails closed).
   */
  replayCache?: { claim(signature: string): 'first' | 'replay' | 'full' };

  /**
   * Production-mode flag. When true, validation-failure responses
   * carry generic strings; when false, the validator's `reason`
   * AND per-finding `description` are included for debugging.
   *
   * default is `true` (safe-by-
   * default). The previous `false` default leaked validator internals
   * to consumers using the programmatic API without explicit opt-out.
   * Set explicitly to `false` for dev / debugging environments.
   *
   * @default true
   */
  productionMode?: boolean;

  /**
   * Maximum HTTP request body size in bytes. Consumers expecting
   * longer conversation histories should override the bounded default.
   * @default 524288 (512 KB)
   */
  bodyLimit?: number;

  /**
   * Optional logger. @default Fastify's built-in pino logger.
   */
  logger?: Logger;
}

/**
 * Discriminated response shape returned by all three guardrail
 * routes. Consumers (LiteLLM custom-guardrail Python plugin, Portkey
 * webhook, OpenAI-compat upstream) translate this into their host
 * protocol's verdict shape — see the per-route README for the
 * mapping.
 */
export interface GuardrailDecision {
  /** True when the validator pipeline allowed the request. */
  allowed: boolean;
  /** True when blocked. Mutually exclusive with `allowed`. */
  blocked: boolean;
  /** Sanitized reason when blocked; undefined on allow. */
  reason?: string;
  /** Surface tag (`litellm`, `portkey`, `openai-compatible`). */
  surface: string;
  /** Optional per-finding detail for telemetry. */
  findings?: Array<{
    category?: string;
    severity?: string;
    description?: string;
  }>;
  /** Server-side request id for log correlation. */
  requestId: string;
}

/** Portkey webhook response contract. */
export interface PortkeyWebhookDecision {
  /** `true` passes the Portkey guardrail; `false` fails it. */
  verdict: boolean;
}
