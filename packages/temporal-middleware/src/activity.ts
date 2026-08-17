/**
 * Temporal validator ACTIVITY
 * ===============================================
 *
 * Temporal workflows are deterministic — they MUST NOT call non-
 * deterministic APIs (Date.now, Math.random, network I/O, etc.).
 * BonkLM validators read patterns from regex caches + Aho-Corasick
 * automata + (optionally) network-backed LLM moderators. ALL of
 * these are non-deterministic from Temporal's perspective.
 *
 * Solution per Story 4.4 AC: validators run as ACTIVITIES. The
 * workflow `proxyActivities` this activity + awaits the result. The
 * activity itself routes through `cachedValidate` so retries return
 * the cached decision (Temporal already journals activity completion;
 * cachedValidate is belt-and-braces for cross-activity caching when
 * the same payload appears in multiple workflows).
 */
import {
  cachedValidate,
  createUnsaltedKeyFn,
  InMemoryLRUCache,
  type Validator,
  type ValidatorCache,
  type ValidatorInput
} from '@blackunicorn/bonklm';
import { adaptValidatorToUniversalInput } from '@blackunicorn/bonklm/core/connector-utils';

export interface ValidateInputActivityArgs {
  /** The text content to validate. */
  content: string;
  /**
   * Optional per-call cache key namespace (mixed into the cache key).
   * Use to scope per-workflow-type if shared cache backend.
   */
  cacheNamespace?: string;
}

export interface ValidateInputActivityResult {
  blocked: boolean;
  reason?: string;
  validatorName?: string;
  category?: string;
  severity?: string;
}

export interface ValidatorActivityConfig {
  validators: Validator[];
  cache?: ValidatorCache;
}

let _experimentalWarned = false;
function emitExperimentalWarnOnce(): void {
  if (_experimentalWarned) return;
  _experimentalWarned = true;

  console.warn(
    '[bonklm-temporal] EXPERIMENTAL: Story 4.4 Sprint 20 scaffold. ' +
      'Full SDK integration + worker integration tests land Sprint 21.'
  );
}

/**
 * Build the activity implementation. Returns an async function that
 * Temporal's worker registers and the workflow calls via
 * `proxyActivities`.
 *
 * **Multi-tenant warning**:
 * the default per-factory cache is shared across activity executions
 * INSIDE this factory but isolated between factories. For multi-
 * tenant workers, pass `args.cacheNamespace` per-activity-call OR
 * supply a tenant-scoped `config.cache` adapter. Default cache key
 * is `(content, validatorName, namespace?)` — without namespace,
 * two tenants submitting identical strings share cached decisions.
 *
 * Usage in worker:
 *   const activities = {
 *     validateInput: createValidateInputActivity({ validators }),
 *   };
 *   const worker = await Worker.create({ activities, ... });
 *
 * Usage in workflow:
 *   const { validateInput } = proxyActivities<typeof activities>({...});
 *   const r = await validateInput({ content: input });
 *   guardrailGate(r); // on BLOCK: throws a terminal ApplicationFailure
 */
export function createValidateInputActivity(
  config: ValidatorActivityConfig
): (args: ValidateInputActivityArgs) => Promise<ValidateInputActivityResult> {
  if (!config || !Array.isArray(config.validators) || config.validators.length === 0) {
    throw new TypeError('createValidateInputActivity: config.validators (non-empty Validator[]) is required.');
  }
  emitExperimentalWarnOnce();
  // per-factory cache rather
  // than module-singleton. Each `createValidateInputActivity` call gets
  // an isolated LRU; supply `config.cache` for shared caching.
  const cache = config.cache ?? new InMemoryLRUCache({ maxEntries: 1000 });
  // shared
  // helper + capability-detect (no try-catch-TypeError mask).
  const adapted = config.validators.map(v => adaptValidatorToUniversalInput(v, 'createValidateInputActivity'));

  return async function validateInputActivity(args: ValidateInputActivityArgs): Promise<ValidateInputActivityResult> {
    const input: ValidatorInput = { kind: 'text', content: args.content };
    const results = await cachedValidate(adapted, input, {
      cache,
      keyFn: createUnsaltedKeyFn(),
      cacheNamespace: args.cacheNamespace
    });

    for (const r of results) {
      if (r.blocked) {
        const finding = r.findings[0];
        return {
          blocked: true,
          reason: finding?.description ?? 'unknown',
          validatorName: r.validatorName,
          category: finding?.category,
          severity: String(r.severity)
        };
      }
    }
    return { blocked: false };
  };
}

// `adaptValidator` removed — superseded by shared
// `adaptValidatorToUniversalInput` from `@blackunicorn/bonklm/core/connector-utils`
// (Sprint 20 audit convergent BLOCK closure).
