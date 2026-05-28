/**
 * @blackunicorn/bonklm-server — types
 * ==================================
 *
 * @package @blackunicorn/bonklm-server
 */
import type { GuardrailEngine, Logger, Validator } from '@blackunicorn/bonklm';

/**
 * Configuration for `createBonklmGuardrailServer`.
 *
 * Story 2.13 AC: `createBonklmGuardrailServer({ validators, port,
 * hmacSecret })`.
 */
export interface BonklmServerOptions {
  /**
   * Validator pipeline. The server constructs an internal
   * `GuardrailEngine` from this array. Mutually-exclusive with
   * `engine`.
   */
  validators?: Validator[];

  /**
   * Pre-built engine (alternative to `validators`). When supplied,
   * the server uses this engine directly. Useful for consumers who
   * wire `engine.onIntercept(...)` for audit telemetry before
   * passing the engine in.
   */
  engine?: GuardrailEngine;

  /** Port to listen on. @default 0 (assign dynamically) */
  port?: number;

  /** Host to bind to. @default '0.0.0.0' */
  host?: string;

  /**
   * HMAC shared secret for `X-Bonklm-Signature` verification.
   * REQUIRED — Story 2.13 AC mandates HMAC auth on every route.
   *
   * @security MUST be at least 32 bytes of entropy. The server
   *   refuses to start with a shorter secret.
   */
  hmacSecret: string;

  /**
   * Replay-window in ms. @default 300000 (5 minutes per AC).
   *
   * @security Lowering this below 60_000 (1 min) increases
   *   spurious-rejection rate on clock-skewed clients.
   */
  replayWindowMs?: number;

  /**
   * Production-mode flag. When true, validation-failure responses
   * carry generic strings; when false, the validator's `reason`
   * AND per-finding `description` are included for debugging.
   *
   * Story 2.13 audit sec S8 closure: default is `true` (safe-by-
   * default). The previous `false` default leaked validator internals
   * to consumers using the programmatic API without explicit opt-out.
   * Set explicitly to `false` for dev / debugging environments.
   *
   * @default true
   */
  productionMode?: boolean;

  /**
   * Maximum HTTP request body size in bytes. Story 2.13 audit sec S6
   * closure: 512KB default (Fastify's 1MB default left a wider DoS
   * surface). Consumers expecting longer conversation histories
   * should override.
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
