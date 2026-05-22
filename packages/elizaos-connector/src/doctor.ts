/**
 * Story 1.8 Construct D — `bonklm doctor` CLI core
 * ================================================
 *
 * Static analysis of an ElizaOS deployment:
 *  - Character file audit (presence of validators / system prompt
 *    issues / secrets in plaintext).
 *  - Plugin-list audit against {@link VERIFIED_PUBLISHER_ALLOWLIST}.
 *  - Phase-1 plugin-name check is exact-match against the frozen
 *    allowlist. The Levenshtein-distance ≤ 2 typo-squat layer
 *    (audit-loop BC6) defers to Phase-2.
 *
 * Out of scope for Phase-1 (deferred per the roadmap split):
 *  - `--runtime` mode probing the local agent's HTTP API for
 *    unauthenticated `/memories` routes.
 *  - `--quiet` / `--format=json` interaction with CRITICAL findings
 *    (Phase-1 prints findings unconditionally).
 *
 * **Unsuppressable CRITICAL contract (audit-loop BC4)**: even in
 * Phase-1, every CRITICAL finding produces a non-zero exit code that
 * a Phase-1 CLI wrapper MUST surface — `bonklm doctor` exiting 0 on a
 * CRITICAL finding is the documented anti-pattern this contract is
 * designed to prevent. CI docs explicitly warn against `|| true`.
 *
 * @package @blackunicorn/bonklm-elizaos
 */
import { ConnectorValidationError } from '@blackunicorn/bonklm/core/connector-utils';
import type { DoctorFinding, DoctorReport, PluginLike } from './types.js';
import { VERIFIED_PUBLISHER_ALLOWLIST } from './types.js';
import { detectTypoSquat } from './typo-squat.js';
import {
  applyProbeOutcome,
  runStartupProbe,
  type ProbeOutcome,
  type ProbeOptions,
} from './probe.js';
import { buildEolFindingV04 } from './shadow-log-integration.js';

/**
 * Story 2.4a Phase-2: regex matching installed
 * `@blackunicorn/bonklm-elizaos@0.4.x` versions. When the doctor's
 * plugin-list audit encounters a plugin whose `name` matches AND whose
 * `version` (if present) matches `0.4.x`, emits a HIGH EOL finding.
 */
const BONKLM_ELIZAOS_PACKAGE_NAME = '@blackunicorn/bonklm-elizaos';
const V04_VERSION_PATTERN = /^0\.4\.[0-9]+(-.*)?$/;

/**
 * Audit-loop HIGH fix #5 (adversarial): expanded credential-prefix
 * coverage. Previous pattern missed six real-world classes:
 *   - AWS STS temporary tokens (`ASIA...`)
 *   - Stripe restricted-key (`rk_live_`)
 *   - Stripe publishable-key (`pk_live_` — legitimately public but
 *     flags misconfigured secrets handler)
 *   - OpenAI legacy (`sk-` non-`proj-` orgs, still in wide pre-2024 use)
 *   - Anthropic (`sk-ant-`)
 *   - JWT signing tokens (`eyJ` header)
 */
const SECRET_PATTERN =
  /(sk-proj-|sk-ant-|sk-[a-zA-Z0-9]{10}|sk_live_|rk_live_|pk_live_|ghp_|xox[baprs]-|AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|AIzaSy|eyJ[a-zA-Z0-9]{10})/i;

/**
 * Run the character-file audit. The character file is opaque to this
 * function; consumers pass a parsed JSON object plus the file path
 * for finding attribution.
 */
export function auditCharacterFile(
  character: Record<string, unknown> | null | undefined,
  filePath: string | undefined
): DoctorFinding[] {
  const findings: DoctorFinding[] = [];
  if (!character) {
    findings.push({
      severity: 'HIGH',
      category: 'character_missing',
      description: 'No character object supplied — agent cannot identify itself.',
      file: filePath,
    });
    return findings;
  }

  // Plaintext secret in any character-field text.
  const walk = (node: unknown, path: string): void => {
    if (typeof node === 'string') {
      if (SECRET_PATTERN.test(node)) {
        findings.push({
          severity: 'CRITICAL',
          category: 'character_plaintext_secret',
          description: `Plaintext-looking secret in character field ${path}. Move to env var.`,
          file: filePath,
        });
      }
    } else if (Array.isArray(node)) {
      node.forEach((v, i) => walk(v, `${path}[${i}]`));
    } else if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        walk(v, path ? `${path}.${k}` : k);
      }
    }
  };
  walk(character, '');

  // System-prompt injection-vulnerable patterns.
  const systemPrompt = (character as { system?: unknown }).system;
  if (typeof systemPrompt === 'string' && systemPrompt.length > 0) {
    if (/you\s+are\s+(?:a\s+)?(?:helpful|assistant)/i.test(systemPrompt) === false) {
      // Heuristic: if the system prompt doesn't anchor identity, the
      // agent is more susceptible to role-hijacking.
      findings.push({
        severity: 'MEDIUM',
        category: 'character_weak_identity_anchor',
        description:
          'Character system prompt does not anchor a "you are a helpful assistant"-style identity. Role-hijacking injection is harder to detect.',
        file: filePath,
      });
    }
  } else {
    findings.push({
      severity: 'MEDIUM',
      category: 'character_no_system_prompt',
      description:
        'Character has no system prompt — agent has no identity anchor against role-hijacking.',
      file: filePath,
    });
  }

  return findings;
}

/**
 * Run the plugin-list audit. Each loaded plugin's package name is
 * compared against {@link VERIFIED_PUBLISHER_ALLOWLIST}.
 *
 * Phase-2 (Story 2.1b-connectors): exact-match check is augmented
 * with a Levenshtein-distance ≤ 2 typo-squat layer. A plugin name
 * that is distance ≤ 2 from any allowlist entry (and not exact-match)
 * produces a CRITICAL `plugin_typo_squat` finding — these are
 * impersonation attempts that the wrap-memory closure refuses.
 *
 * Plugins distant > 2 from every allowlist entry produce the Phase-1
 * MEDIUM `plugin_not_in_allowlist` finding.
 */
export function auditPlugins(plugins: ReadonlyArray<PluginLike>): DoctorFinding[] {
  const findings: DoctorFinding[] = [];
  for (const plugin of plugins) {
    if (!plugin.name) continue;
    const typoCheck = detectTypoSquat(plugin.name, VERIFIED_PUBLISHER_ALLOWLIST);
    if (typoCheck.exactMatch) continue;
    if (typoCheck.nearestTypoSquat !== undefined) {
      // CRITICAL — typo-squat impersonation.
      findings.push({
        severity: 'CRITICAL',
        category: 'plugin_typo_squat',
        description:
          `Plugin "${plugin.name}" is distance-${typoCheck.nearestTypoSquat.distance} from ` +
          `verified publisher "${typoCheck.nearestTypoSquat.target}". This is a likely typo-squat ` +
          `impersonation — Provider-source 'messages' writes from this plugin will be refused with ` +
          `CRITICAL diagnostic by the sealed wrapMemory closure.`,
        pluginName: plugin.name,
      });
      continue;
    }
    // Unknown-distant plugin — Phase-1 MEDIUM behaviour preserved.
    findings.push({
      severity: 'MEDIUM',
      category: 'plugin_not_in_allowlist',
      description: `Plugin ${plugin.name} is not in the verified-publisher allowlist. Provider-source 'messages' writes from this plugin will be refused.`,
      pluginName: plugin.name,
    });
  }
  return findings;
}

/**
 * Build a {@link DoctorReport} from a set of {@link DoctorFinding}s.
 * `exitCode` is non-zero when any CRITICAL finding is present (per
 * the unsuppressable-CRITICAL contract).
 */
export function buildReport(findings: DoctorFinding[]): DoctorReport {
  const criticalCount = findings.filter((f) => f.severity === 'CRITICAL').length;
  return {
    findings,
    criticalCount,
    exitCode: criticalCount > 0 ? 1 : 0,
  };
}

/**
 * Story 2.4a Phase-2 EOL finding helper. Audits the consumer-supplied
 * `installedVersions` record (`{ '@blackunicorn/bonklm-elizaos': '0.4.1' }`)
 * for known-EOL versions and returns matching findings.
 *
 * Consumers pass this from their npm/pnpm-lock parse pipeline.
 */
export function auditInstalledVersions(
  installedVersions: Record<string, string> | undefined
): DoctorFinding[] {
  const findings: DoctorFinding[] = [];
  if (installedVersions === undefined) return findings;
  const bonklmElizaosVersion = installedVersions[BONKLM_ELIZAOS_PACKAGE_NAME];
  if (
    typeof bonklmElizaosVersion === 'string' &&
    V04_VERSION_PATTERN.test(bonklmElizaosVersion)
  ) {
    findings.push(buildEolFindingV04(bonklmElizaosVersion));
  }
  return findings;
}

/**
 * Combined doctor pass over a character + plugin list.
 *
 * Story 2.4a Phase-2: accepts an optional `installedVersions` record
 * for the EOL audit. Consumers parse their lockfile and pass the
 * record; doctor adds HIGH findings for known-EOL versions.
 */
export function runDoctor(input: {
  character?: Record<string, unknown> | null;
  characterFilePath?: string;
  plugins?: ReadonlyArray<PluginLike>;
  installedVersions?: Record<string, string>;
}): DoctorReport {
  const characterFindings = auditCharacterFile(input.character, input.characterFilePath);
  const pluginFindings = auditPlugins(input.plugins ?? []);
  const versionFindings = auditInstalledVersions(input.installedVersions);
  return buildReport([...characterFindings, ...pluginFindings, ...versionFindings]);
}

/**
 * Translate a probe outcome into doctor findings. Used by both
 * `bonklm doctor --runtime` (CLI) and library consumers that want to
 * run the probe outside of `bonklmPlugin.init()`.
 *
 * Mapping:
 * - `unauth_detected_no_ack` → CRITICAL `runtime_unauth_memories`.
 * - `unauth_detected_acknowledged` → HIGH `runtime_unauth_memories_acknowledged`.
 * - `unreachable` (probe completed, route protected) → INFO.
 * - `unreachable` (network failure) → MEDIUM `runtime_probe_unreachable`.
 * - `skipped` → INFO.
 */
export function probeOutcomeToFindings(outcome: ProbeOutcome): DoctorFinding[] {
  switch (outcome.kind) {
    case 'unauth_detected_no_ack':
      return [
        {
          severity: 'CRITICAL',
          category: 'runtime_unauth_memories',
          description:
            'ElizaOS runtime exposes /api/agents/{agentId}/memories WITHOUT authentication. ' +
            'Provider plugins can mutate user-authored memories via this route, defeating BonkLM\'s ' +
            'sealed wrapMemory defence (Class-4 vulnerability). Secure the route or pass ' +
            '`acknowledgeClass4Risk: true` to bonklmPlugin(...).',
        },
      ];
    case 'unauth_detected_acknowledged':
      return [
        {
          severity: 'HIGH',
          category: 'runtime_unauth_memories_acknowledged',
          description:
            'Unauthenticated /memories route detected; risk acknowledged via acknowledgeClass4Risk. ' +
            'Plugin continues but Construct C corroboration excludes unauth-source memories. ' +
            'Resolve the upstream auth gap to restore full Construct B+C coverage.',
        },
      ];
    case 'unreachable':
      if (outcome.reason.startsWith('Probe completed')) {
        return [
          {
            severity: 'INFO',
            category: 'runtime_probe_safe',
            description: outcome.reason,
          },
        ];
      }
      return [
        {
          severity: 'MEDIUM',
          category: 'runtime_probe_unreachable',
          description: outcome.reason,
        },
      ];
    case 'skipped':
      return [
        {
          severity: 'INFO',
          category: 'runtime_probe_skipped',
          description: outcome.reason,
        },
      ];
  }
}

/**
 * Run the runtime probe + translate to doctor findings.
 *
 * `bonklm doctor --runtime` (the CLI mode) invokes this; library
 * consumers can call it directly to bundle the probe outcome with
 * the static-audit findings produced by {@link runDoctor}.
 *
 * Probe-await semantics (iter-2 architect BLOCK-2) and side-effect
 * application (iter-2 senior-dev BLOCK-A timeout, AAD-C ALS-clear,
 * etc.) are honoured by the underlying {@link runStartupProbe} +
 * {@link applyProbeOutcome} pair. Logging is the caller's choice:
 * passing `logger` triggers the structured warn/error/info logs that
 * `bonklmPlugin.init` emits; omitting it produces findings only.
 */
export async function runDoctorRuntime(
  opts: ProbeOptions & { applyLogSideEffects?: boolean }
): Promise<DoctorReport> {
  const outcome = await runStartupProbe(opts);
  if (opts.applyLogSideEffects === true) {
    try {
      applyProbeOutcome(outcome, { logger: opts.logger });
    } catch (err) {
      // Iter-1 code-reviewer HIGH-2 + security A&D-10: narrow swallow
      // to ConnectorValidationError ONLY — the doctor's contract is
      // "report, not halt" for the CRITICAL Class-4 throw, but any
      // OTHER error (TypeError from malformed outcome, RangeError, etc.)
      // is a programming error and MUST propagate. The CRITICAL
      // finding is already in the report (via probeOutcomeToFindings
      // below) so swallowing the ConnectorValidationError specifically
      // is safe; programming errors above must surface so future
      // regressions in applyProbeOutcome are debuggable.
      if (!(err instanceof ConnectorValidationError)) {
        throw err;
      }
      // Expected throw — fall through to report build.
    }
  }
  return buildReport(probeOutcomeToFindings(outcome));
}
