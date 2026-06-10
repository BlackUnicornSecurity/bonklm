import { readFileSync } from 'node:fs';

/**
 * Settings integrity check for .claude/settings.json.
 *
 * Verifies the hook configuration has not been weakened: required events and
 * PreToolUse/PostToolUse matchers are present and the total hook count has not
 * dropped below the baseline. Unlike the PreToolUse guards this is a standalone
 * CLI control (invoked by team/scripts/security-regression.sh) and fails CLOSED
 * (exit 1) on a real integrity problem — it never blocks a tool call.
 *
 * De-BMAD'd from the original: no `_bmad` project marker, baselines match this
 * repo's tracked settings.json (63 hooks / 12 PreToolUse matchers).
 */

export const REQUIRED_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse'];
export const REQUIRED_PRETOOLUSE_MATCHERS = [
  'Skill', 'Task', 'Bash', 'Write', 'Edit', 'Read',
  'Glob', 'Grep', 'WebFetch', 'WebSearch', 'NotebookEdit', 'TodoWrite',
];
export const REQUIRED_POSTTOOLUSE_MATCHERS = ['WebFetch', 'Task', 'Skill', 'WebSearch'];
// Ratchet floor = the tracked .claude/settings.json hook count at the time of
// writing. Raise (never lower) it deliberately if hooks are added, with maintainer
// sign-off; a drop below this signals hooks were removed.
export const MIN_HOOK_COUNT = 63;

/**
 * Count every command hook across all events.
 * @param {Record<string, unknown>} hooks
 * @returns {number}
 */
export function countHooks(hooks) {
  let total = 0;
  for (const handlers of Object.values(hooks)) {
    const list = Array.isArray(handlers) ? handlers : [handlers];
    for (const handler of list) {
      if (handler && Array.isArray(handler.hooks)) {
        total += handler.hooks.length;
      }
    }
  }
  return total;
}

/**
 * Collect the set of matchers declared for an event.
 * @param {unknown} handlers
 * @returns {Set<string>}
 */
function matcherSet(handlers) {
  const list = Array.isArray(handlers) ? handlers : [];
  const set = new Set();
  for (const handler of list) {
    if (handler && typeof handler.matcher === 'string') {
      set.add(handler.matcher);
    }
  }
  return set;
}

/**
 * Validate a parsed settings object.
 * @param {unknown} settings
 * @returns {{valid:boolean, errors:string[], stats?:{totalHooks:number, matcherCount:number}}}
 */
export function validateSettings(settings) {
  const errors = [];
  if (!settings || typeof settings !== 'object' || !settings.hooks || typeof settings.hooks !== 'object') {
    errors.push('missing required top-level "hooks" object');
    return { valid: false, errors };
  }

  for (const event of REQUIRED_EVENTS) {
    if (!settings.hooks[event]) {
      errors.push(`missing required event: "${event}"`);
    }
  }

  const preMatchers = matcherSet(settings.hooks.PreToolUse);
  for (const matcher of REQUIRED_PRETOOLUSE_MATCHERS) {
    if (!preMatchers.has(matcher)) {
      errors.push(`missing required PreToolUse matcher: "${matcher}"`);
    }
  }

  const postMatchers = matcherSet(settings.hooks.PostToolUse);
  for (const matcher of REQUIRED_POSTTOOLUSE_MATCHERS) {
    if (!postMatchers.has(matcher)) {
      errors.push(`missing required PostToolUse matcher: "${matcher}"`);
    }
  }

  const totalHooks = countHooks(settings.hooks);
  if (totalHooks < MIN_HOOK_COUNT) {
    errors.push(`hook count ${totalHooks} < baseline ${MIN_HOOK_COUNT} (hooks may have been removed)`);
  }

  return {
    valid: errors.length === 0,
    errors,
    stats: { totalHooks, matcherCount: preMatchers.size },
  };
}

/**
 * Read + parse + validate the settings file at `settingsPath`.
 * @param {string} settingsPath
 * @returns {{valid:boolean, errors:string[], stats?:object}}
 */
export function loadAndValidate(settingsPath) {
  let raw;
  try {
    raw = readFileSync(settingsPath, 'utf8');
  } catch {
    return { valid: false, errors: [`settings file not found or unreadable: ${settingsPath}`] };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { valid: false, errors: [`invalid JSON: ${err}`] };
  }
  return validateSettings(parsed);
}
