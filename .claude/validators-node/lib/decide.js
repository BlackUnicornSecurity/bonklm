import { EXIT_ALLOW, EXIT_BLOCK } from './constants.js';
import { isDisabled } from './disable.js';
import { formatBlockMessage } from './report.js';
import { sanitizeForLog } from './sanitize.js';

/**
 * Pure hook decision. Never throws, never calls process.exit.
 *
 * Failure posture (load-bearing — see ADR-0005):
 *   - kill-switch active        => ALLOW (exit 0), no output
 *   - validate() throws         => ALLOW (exit 0) + diagnostic on stderr (FAIL OPEN)
 *   - decision.block === true   => BLOCK (exit 2) + formatted block message
 *   - decision.warn === true    => ALLOW (exit 0) + one-line advisory (non-blocking)
 *   - otherwise                 => ALLOW (exit 0)
 *
 * @param {object} input - Parsed hook input (see parseHookInput).
 * @param {(input:object, ctx:{projectDir:string}) => (object|null|undefined)} validate
 *   Returns a decision: {block?, warn?, title?, reason?, target?, recommendations?}.
 * @param {object} [options]
 * @param {string} [options.name] - Validator name (for messages).
 * @param {string} [options.projectDir]
 * @param {(dir:string)=>boolean} [options.isDisabled] - Injectable for tests.
 * @returns {{exitCode:number, stderr:string}}
 */
export function decide(input, validate, options = {}) {
  const name = options.name || 'validator';
  const projectDir = options.projectDir || (input && input.cwd) || '';
  const disabledCheck = options.isDisabled || isDisabled;

  if (disabledCheck(projectDir)) {
    return { exitCode: EXIT_ALLOW, stderr: '' };
  }

  let decision;
  try {
    decision = validate(input, { projectDir });
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    return {
      exitCode: EXIT_ALLOW,
      stderr: `[bonklm:${sanitizeForLog(name, 40)}] internal error (fail-open): ${sanitizeForLog(msg)}\n`,
    };
  }

  if (decision && decision.block) {
    return {
      exitCode: EXIT_BLOCK,
      stderr: `${formatBlockMessage({ validator: name, ...decision })}\n`,
    };
  }
  if (decision && decision.warn) {
    return {
      exitCode: EXIT_ALLOW,
      stderr: `[bonklm:${sanitizeForLog(name, 40)}] warning: ${sanitizeForLog(decision.reason || 'advisory')}\n`,
    };
  }
  return { exitCode: EXIT_ALLOW, stderr: '' };
}
