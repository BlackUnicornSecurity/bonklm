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
import type { DoctorFinding, DoctorReport, PluginLike } from './types.js';
import { VERIFIED_PUBLISHER_ALLOWLIST } from './types.js';

const SECRET_PATTERN = /(sk-proj-|sk_live_|ghp_|xoxb-|AKIA[0-9A-Z]{16}|AIzaSy)/i;

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
 * compared against {@link VERIFIED_PUBLISHER_ALLOWLIST}. Phase-1 is
 * exact-match only; the Levenshtein-distance pass (typo-squat
 * defence) lands in Phase-2.
 */
export function auditPlugins(plugins: ReadonlyArray<PluginLike>): DoctorFinding[] {
  const findings: DoctorFinding[] = [];
  for (const plugin of plugins) {
    if (!plugin.name) continue;
    if (VERIFIED_PUBLISHER_ALLOWLIST.includes(plugin.name)) continue;
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
 * Combined doctor pass over a character + plugin list.
 */
export function runDoctor(input: {
  character?: Record<string, unknown> | null;
  characterFilePath?: string;
  plugins?: ReadonlyArray<PluginLike>;
}): DoctorReport {
  const characterFindings = auditCharacterFile(input.character, input.characterFilePath);
  const pluginFindings = auditPlugins(input.plugins ?? []);
  return buildReport([...characterFindings, ...pluginFindings]);
}
