/**
 * Claude Code hook exit-code contract.
 *
 * For PreToolUse and UserPromptSubmit hooks:
 *   - exit 0  => ALLOW the operation
 *   - exit 2  => BLOCK the operation (stderr is surfaced to the model/user)
 *   - any other non-zero => non-blocking error (operation proceeds)
 *
 * These validators only ever use 0 (allow) or 2 (block). A crash exits non-2 and
 * therefore fails OPEN — see lib/run-hook.js and lib/decide.js.
 */
export const EXIT_ALLOW = 0;
export const EXIT_BLOCK = 2;
