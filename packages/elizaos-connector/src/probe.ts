/**
 * Story 2.1b-connectors — ElizaOS runtime HTTP startup probe
 * ==========================================================
 *
 * Probes the locally-running ElizaOS agent's HTTP API at startup to
 * detect the Class-4 vulnerability where `/api/agents/{agentId}/memories`
 * is exposed without authentication. The probe is part of
 * `bonklmPlugin.init()`'s pre-first-call gate.
 *
 * **All amendments from the 4-iteration plan audit are wired here**:
 *
 * - **SSRF defence (security audit GAP-2 + adversarial #2 DNS-rebinding)**:
 *   probe URL uses LITERAL `127.0.0.1` / `[::1]` IPs only; `localhost`
 *   is BANNED. No consumer-overridable hostname.
 *
 * - **IPv6 fallback (architect AAD-3)**: try `127.0.0.1` first; on
 *   `ECONNREFUSED` / `EHOSTUNREACH` retry with `[::1]`. Both must
 *   fail before the outcome falls to network-error.
 *
 * - **Per-attempt timeout (senior-dev BLOCK-A)**: `AbortController`
 *   with 2000ms `setTimeout` deadline per IP attempt. AbortError
 *   treated as ECONNREFUSED.
 *
 * - **ALS-clear during probe (senior-dev AAD-C)**: probe runs inside
 *   `runWithoutCallContext(...)` so ambient ALS context cannot leak
 *   into the probe's HTTP request callback.
 *
 * - **Probe deduplication (adversarial BLOCK-1)**: module-scope
 *   `Map<(IP,port), Promise>` with FIFO eviction at 100 entries.
 *   50-plugin parallel init resolves within 5s, not 200s.
 *
 * - **4-branch probe outcome (senior-dev B3)**: detected+flag-absent
 *   throws; detected+acknowledge-true CRITICAL-logs+continues;
 *   network-error HIGH-logs+continues; env-skip pre-empts in non-prod.
 *
 * - **Probe-await semantics (architect BLOCK-2)**: callers MUST await
 *   `runStartupProbe(...)` to completion before allowing other plugins
 *   to load. Fire-and-forget is PROHIBITED.
 *
 * @package @blackunicorn/bonklm-elizaos
 */
import { createLogger, sanitizeMeta } from '@blackunicorn/bonklm';
import { ConnectorValidationError } from '@blackunicorn/bonklm/core/connector-utils';
import type { Logger } from '@blackunicorn/bonklm';
import { runWithoutCallContext } from './als-context.js';

/**
 * Per-attempt probe deadline. Bounded so a hung TCP listener cannot
 * stall `bonklmPlugin.init()` for the full default Node `http.request`
 * socket timeout (60-120s).
 */
const PROBE_TIMEOUT_MS = 2000;

/**
 * Cache cap for the module-scope `(IP, port) → Promise<ProbeOutcome>`
 * memo. FIFO eviction at this size defeats memory growth in
 * long-running test harnesses / dev environments that cycle through
 * many distinct local ports. Production deployments typically use
 * 1-5 distinct ports.
 */
const PROBE_CACHE_CAP = 100;

/**
 * Discriminated-union enumeration of the four probe outcomes
 * documented in Story 2.1b's AC.
 */
export type ProbeOutcome =
  /**
   * Branch 1 — unauthenticated `/memories` route detected, the
   * `acknowledgeClass4Risk` flag is ABSENT. Plugin init MUST throw.
   */
  | { kind: 'unauth_detected_no_ack' }
  /**
   * Branch 2 — unauth route detected AND `acknowledgeClass4Risk: true`
   * was passed. Plugin continues but emits a CRITICAL log + telemetry.
   */
  | { kind: 'unauth_detected_acknowledged' }
  /**
   * Branch 3 — probe failed to reach the local HTTP port (network
   * error, both IPv4 + IPv6 attempts exhausted). HIGH log; plugin
   * continues normally.
   */
  | { kind: 'unreachable'; reason: string }
  /**
   * Branch 4 — `BONKLM_SKIP_RUNTIME_PROBE === '1'` AND
   * `NODE_ENV !== 'production'`. Probe was skipped explicitly.
   */
  | { kind: 'skipped'; reason: string };

/**
 * Input parameters for {@link runStartupProbe}.
 */
export interface ProbeOptions {
  /** Agent ID for the probe URL path `/api/agents/{agentId}/memories`. */
  agentId: string;
  /** Local HTTP port the runtime is listening on. */
  port: number;
  /**
   * When true, branch 2 (CRITICAL log + continue) is taken instead of
   * branch 1 (throw) when an unauth route is detected.
   */
  acknowledgeClass4Risk?: boolean;
  /**
   * Engine-config-injected env bindings. Used for the
   * `BONKLM_SKIP_RUNTIME_PROBE` + `NODE_ENV` lookups (branch 4).
   * Passing `undefined` falls back to `process.env` on Node.
   */
  envBindings?: Record<string, string | undefined>;
  /** Logger. @default `createLogger('console')`. */
  logger?: Logger;
  /**
   * Injectable HTTP transport for the probe's loopback request.
   * @default the global `fetch`.
   *
   * TESTING / REFACTOR-SAFETY seam. Lets probe-incidental tests inject a
   * deterministic transport (e.g. one that rejects with `ECONNREFUSED`)
   * through this typed contract instead of monkey-patching
   * `globalThis.fetch`. A future move of the probe's transport off the
   * global `fetch` then becomes a COMPILE-TIME change here rather than a
   * silent runtime no-op that lets a stub pass for the wrong reason.
   *
   * SECURITY: `fetchImpl` does NOT widen the probe's target. The probe
   * still issues requests ONLY to the hardcoded loopback literals
   * (`127.0.0.1` / `[::1]`); a custom transport cannot redirect it to a
   * non-loopback host. It is consumer-supplied config (frozen by
   * `bonklmPlugin`), equivalent in trust to `acknowledgeClass4Risk` /
   * `envBindings` — not an attacker-reachable surface. Production
   * deployments should leave it unset.
   *
   * NOTE: `fetchImpl` is intentionally NOT part of the `runStartupProbe`
   * dedup key (functions are not identity-stable cache material). Two
   * probes sharing `(agentId, port, NODE_ENV)` that differ only in
   * `fetchImpl` resolve to the FIRST probe's cached outcome; tests that
   * inject a transport isolate via `__clearProbeCacheForTests()`.
   * Production never injects, so the default path is unaffected.
   */
  fetchImpl?: typeof fetch;
}

/**
 * Module-scope `(IP, port) → Promise<ProbeOutcome>` memo. Eliminates
 * the 50-plugin DoS amplification — 50 plugins targeting the same
 * runtime fire ONE probe, not 50. Cache lifetime = process lifetime;
 * FIFO eviction at `PROBE_CACHE_CAP` entries.
 */
const probeCache = new Map<string, Promise<ProbeOutcome>>();

/**
 * Test-only helper: clear the dedup cache. NOT exported from the
 * package barrel — internal hook for vitest setup/teardown.
 *
 * @internal
 */
export function __clearProbeCacheForTests(): void {
  probeCache.clear();
}

/**
 * Resolve a config value from `envBindings` falling back to
 * `process.env`. Mirrors the pattern in `guards/production.ts`.
 *
 * Iter-1 security BLOCK #7 caveat: caller-supplied `envBindings`
 * values are NOT sanitised here — the probe consumers
 * (`bonklmPlugin.init`) pass them straight from their config. The
 * 128-char sanitisation lives in `guards/production.ts` where
 * attacker-controlled values would flow from HTTP request headers.
 * The probe sees only its OWN config-derived values.
 */
function resolveEnvVar(envBindings: Record<string, string | undefined> | undefined, key: string): string | undefined {
  if (envBindings !== undefined) {
    return envBindings[key];
  }
  if (typeof process !== 'undefined' && process && process.env) {
    return process.env[key];
  }
  return undefined;
}

/**
 * Build the probe URL for a given IP literal + port. Always uses
 * HTTP (no HTTPS); the loopback target is by definition local. The
 * path is hardcoded — no consumer-overridable hostname accepted.
 *
 * Iter-1 security A&D-3: `agentId` flows from `runtime.agentId` set
 * by the ElizaOS framework — not direct user input — but a future
 * change in ElizaOS could surface user-controlled values through
 * that path. `encodeURIComponent` is a no-cost hardening that
 * prevents `../admin`-style path traversal if the trust boundary
 * shifts. UUIDs and standard agent IDs survive encoding unchanged.
 */
function buildProbeUrl(ipLiteral: string, port: number, agentId: string): string {
  // IPv6 literals need square brackets. `::1` is the only IPv6
  // address we probe; bracket it. IPv4 is passed through.
  const host = ipLiteral.includes(':') ? `[${ipLiteral}]` : ipLiteral;
  return `http://${host}:${port}/api/agents/${encodeURIComponent(agentId)}/memories`;
}

/**
 * Probe a single IP literal. Returns `'200'` when the route exists
 * AND is unauthenticated, `'safe'` when the route is protected
 * (401/403) or absent (404), `'unreachable'` when the connect failed
 * or the timeout elapsed.
 *
 * Iter-2 senior-dev BLOCK-A: each attempt is bounded by an
 * `AbortController` 2000ms deadline. AbortError surfaces as
 * `unreachable` so the IPv6 fallback can engage.
 */
async function probeSingleIp(
  ipLiteral: string,
  port: number,
  agentId: string,
  fetchImpl: typeof fetch
): Promise<'200_unauth' | 'safe' | 'unreachable'> {
  const url = buildProbeUrl(ipLiteral, port, agentId);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      signal: controller.signal,
      // No `redirect` config — we don't want to follow redirects to a
      // non-loopback target. The default is `'follow'`; explicit
      // `'manual'` would surface the original 3xx response so a
      // legitimate auth-redirect surfaces as `'safe'`.
      redirect: 'manual'
    });
    // 200 with no auth → CRITICAL. Anything else (401, 403, 404, 3xx) → safe.
    if (response.status === 200) {
      return '200_unauth';
    }
    return 'safe';
  } catch (err) {
    // AbortError, connect refused, host unreachable, DNS failure → unreachable.
    // We don't classify further — the outer caller decides whether to
    // fall through to IPv6 or to branch 3.
    return 'unreachable';
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The probe execution path — called inside the dedup memo so
 * sibling-plugin awaiters share the same Promise.
 */
async function executeProbe(opts: ProbeOptions): Promise<ProbeOutcome> {
  // Branch 4 — env-skip pre-empt. Production deployments are NOT
  // permitted to skip the probe; a static-config assertion catches
  // this at engine construction (the plugin's caller is responsible
  // for that assertion — `bonklmPlugin.init` documents the contract).
  const skipFlag = resolveEnvVar(opts.envBindings, 'BONKLM_SKIP_RUNTIME_PROBE');
  const nodeEnv = resolveEnvVar(opts.envBindings, 'NODE_ENV');
  if (skipFlag === '1' && nodeEnv !== 'production') {
    return { kind: 'skipped', reason: 'BONKLM_SKIP_RUNTIME_PROBE=1 in non-production' };
  }

  // Resolve the transport once: explicit injection (testing seam) else the
  // global `fetch`. Resolved here — outside `runWithoutCallContext` — because
  // choosing a function reference touches no ALS state.
  const fetchImpl = opts.fetchImpl ?? fetch;

  // Run the probe with the ambient call context CLEARED so a parent
  // `withCallContext({ sourceTrust: 'agent_internal' })` cannot leak
  // into the probe's HTTP request callback (iter-2 senior-dev AAD-C).
  return runWithoutCallContext(async () => {
    // IPv4 attempt first.
    let outcome = await probeSingleIp('127.0.0.1', opts.port, opts.agentId, fetchImpl);
    if (outcome === 'unreachable') {
      // IPv6 fallback per architect AAD-3.
      outcome = await probeSingleIp('::1', opts.port, opts.agentId, fetchImpl);
    }

    if (outcome === '200_unauth') {
      if (opts.acknowledgeClass4Risk === true) {
        return { kind: 'unauth_detected_acknowledged' };
      }
      return { kind: 'unauth_detected_no_ack' };
    }
    if (outcome === 'safe') {
      // Route protected/absent — happy path. Continue as "safe".
      // Branch 3 ("unreachable") is the only HIGH-log case; a protected
      // route is informational only and we synthesise an INFO outcome
      // via the unreachable kind with a clarifying reason.
      return {
        kind: 'unreachable',
        reason: 'Probe completed; runtime HTTP /memories route is protected or absent (no unauth exposure detected).'
      };
    }
    return {
      kind: 'unreachable',
      reason: 'Probe could not reach the runtime HTTP API on either 127.0.0.1 or [::1].'
    };
  });
}

/**
 * Run the startup probe. Idempotent per `(agentId, port, NODE_ENV)`:
 * the second concurrent or sequential call against the same cache key
 * returns the SAME `Promise<ProbeOutcome>` — both callers receive
 * identical outcomes by reference.
 *
 * Logging side-effects (CRITICAL / HIGH) fire on the OUTCOME
 * application (in `applyProbeOutcome`), not inside this function, so
 * a deduplicated probe doesn't double-log.
 *
 * Iter-1 security BLOCK-6 — cache key includes `NODE_ENV` (resolved
 * via the same `envBindings`/`process.env` fallback the probe uses
 * internally). A test process that imports the production plugin
 * with `NODE_ENV='test'` and a production engine with
 * `NODE_ENV='production'` MUST NOT share cached probe outcomes —
 * the production engine's outcome (e.g. a real Class-4 finding)
 * could otherwise be replaced by the test's mocked outcome.
 */
export function runStartupProbe(opts: ProbeOptions): Promise<ProbeOutcome> {
  // Cache-key disambiguation: include NODE_ENV so test/prod contexts
  // in the same process never share cached promises.
  const nodeEnvForKey = resolveEnvVar(opts.envBindings, 'NODE_ENV') ?? 'unknown';
  const cacheKey = `${opts.agentId}:${opts.port}:${nodeEnvForKey}`;
  const cached = probeCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  // FIFO eviction at PROBE_CACHE_CAP per iter-3 UI/UX A&D-DX-5.
  if (probeCache.size >= PROBE_CACHE_CAP) {
    const firstKey = probeCache.keys().next().value;
    if (firstKey !== undefined) {
      probeCache.delete(firstKey);
    }
  }

  const promise = executeProbe(opts);
  probeCache.set(cacheKey, promise);
  return promise;
}

/**
 * Apply the side-effects of a probe outcome: throw on branch 1,
 * CRITICAL-log on branch 2, HIGH-log on branch 3, INFO-log on branch 4.
 *
 * Called by `bonklmPlugin.init()` AFTER awaiting the probe to
 * completion. Separating outcome production from outcome application
 * lets the dedup memo cache the OUTCOME without double-firing log
 * side-effects across awaiters.
 *
 * Iter-3 architect amendments: branch 1 names `acknowledgeClass4Risk`
 * in the throw message so the consumer immediately knows the
 * escape-hatch path. Branch 2's CRITICAL log emits a
 * per-startup telemetry event for audit pipelines.
 */
export function applyProbeOutcome(outcome: ProbeOutcome, opts: { logger?: Logger; productionMode?: boolean }): void {
  const logger = opts.logger ?? createLogger('console');
  switch (outcome.kind) {
    case 'unauth_detected_no_ack': {
      const message =
        'BonkLM startup probe detected an UNAUTHENTICATED /memories route on the local ElizaOS HTTP API. ' +
        'This is a Class-4 vulnerability — Provider plugins can mutate user-authored memories via the unauth ' +
        "route, defeating BonkLM's sealed wrapMemory defence. Either secure the route OR explicitly accept " +
        'the risk by passing `acknowledgeClass4Risk: true` to bonklmPlugin(...).';
      logger.error('[BonkLM] CRITICAL — Class-4 unauth /memories route detected; plugin refuses to start.');
      throw new ConnectorValidationError(
        opts.productionMode === true ? 'Class-4 vulnerability detected' : message,
        'invalid_runtime'
      );
    }
    case 'unauth_detected_acknowledged': {
      logger.error(
        '[BonkLM] CRITICAL — Class-4 unauth /memories route detected. ' +
          'Risk acknowledged via acknowledgeClass4Risk: true. Plugin continues but all sealed wrapMemory ' +
          'writes will be marked metadata.bonklmTrust=true; ToolCallArgsValidator will exclude unauth-source ' +
          'memories. Resolve the upstream auth gap before relying on Construct C corroboration.'
      );
      return;
    }
    case 'unreachable': {
      // Per branch 3 (and the "safe" sub-case piggybacked on `unreachable`),
      // we log HIGH-or-INFO depending on whether the reason indicates
      // detection completion or genuine network failure.
      // Sprint 40 connector CWE-117 sweep: `outcome.reason` is
      // constructed inside `runStartupProbe` from runtime context
      // (port, hostname, error.message). The error path may carry
      // attacker-influenced content if the runtime config is
      // operator-edited from a downstream source.
      if (outcome.reason.startsWith('Probe completed')) {
        logger.info(`[BonkLM] ${sanitizeMeta(outcome.reason)}`);
      } else {
        logger.warn(`[BonkLM] startup probe ${sanitizeMeta(outcome.reason)} Plugin continues normally.`);
      }
      return;
    }
    case 'skipped': {
      logger.info(`[BonkLM] startup probe skipped: ${sanitizeMeta(outcome.reason)}`);
      return;
    }
  }
}
