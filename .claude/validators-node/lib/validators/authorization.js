import { gatherText } from '../input.js';

/**
 * Skill authorization policy — gates Skill invocations.
 *
 * Posture: ALLOW by default (the set of legitimate skills is open-ended), HARD
 * BLOCK on a small denylist of intents that should never be auto-authorized for
 * the agent harness (disabling the guardrails, data exfiltration). This is the
 * harness policy hook point; extend DENYLISTED_PATTERNS to tighten it.
 */

const DENYLISTED_PATTERNS = [
  {
    re: /\b(?:disable|bypass|turn\s+off|deactivate|remove)\s+(?:the\s+)?(?:guardrails?|validators?|security|safety|protections?)\b/i,
    name: 'attempt to disable guardrails',
  },
  { re: /\bexfiltrat/i, name: 'data-exfiltration intent' },
];

/**
 * @param {object} input - parsed hook input
 * @returns {{allow:boolean, name?:string}}
 */
export function authorizationDecision(input) {
  if (input.toolName && input.toolName !== 'Skill') {
    return { allow: true };
  }
  const text = gatherText(input);
  for (const { re, name } of DENYLISTED_PATTERNS) {
    if (re.test(text)) return { allow: false, name };
  }
  return { allow: true };
}

/**
 * @param {object} input - parsed hook input
 * @returns {object|null}
 */
export function validateAuthorization(input) {
  const decision = authorizationDecision(input);
  if (decision.allow) return null;
  return {
    block: true,
    title: 'SKILL INVOCATION NOT AUTHORIZED',
    reason: `Skill invocation matched a denied authorization policy (${decision.name}).`,
    target: '(skill)',
    recommendations: [
      'This operation is denied by the harness authorization policy.',
      'Adjust the policy in .claude/validators-node/lib/validators/authorization.js if this is a false positive.',
    ],
  };
}
