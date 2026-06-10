import { sanitizeForLog } from './sanitize.js';

/**
 * Format a standardized BLOCK message for stderr. All interpolated (untrusted)
 * fields pass through sanitizeForLog (CWE-117). Pure — returns a string.
 *
 * @param {object} opts
 * @param {string} opts.validator - Validator name.
 * @param {string} [opts.title] - Short block title.
 * @param {string} [opts.reason] - Why it was blocked.
 * @param {string} [opts.target] - The command/file/text that triggered the block.
 * @param {string[]} [opts.recommendations] - Optional remediation hints.
 * @returns {string}
 */
export function formatBlockMessage(opts) {
  const { validator, title, reason, target, recommendations } = opts || {};
  const bar = '='.repeat(60);
  const lines = [
    '',
    bar,
    `BONKLM GUARDRAIL: ${sanitizeForLog(title || 'BLOCKED', 80)}`,
    bar,
    '',
    sanitizeForLog(reason || 'Operation blocked by a local-harness validator.', 500),
  ];
  if (target) {
    lines.push('', `Target: ${sanitizeForLog(target, 200)}`);
  }
  if (Array.isArray(recommendations) && recommendations.length > 0) {
    lines.push('', 'Recommendations:');
    for (const rec of recommendations) {
      lines.push(`  - ${sanitizeForLog(rec, 200)}`);
    }
  }
  lines.push(
    '',
    `Validator: ${sanitizeForLog(validator || 'unknown', 40)} (local harness).`,
    'To disable all validators see .claude/validators-node/README.md (kill-switch).',
    bar,
    '',
  );
  return lines.join('\n');
}
