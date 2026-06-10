/**
 * Pure parsing/extraction helpers for Claude Code hook payloads. Reading stdin
 * (the only I/O) lives in run-hook.js; everything here is deterministic and
 * unit-tested without mocks.
 */

/**
 * Parse a Claude Code hook payload into a normalized shape with safe defaults.
 *
 * Claude Code delivers JSON such as:
 *   PreToolUse:      { hook_event_name, tool_name, tool_input, cwd, ... }
 *   UserPromptSubmit:{ hook_event_name, prompt, cwd, ... }
 *
 * @param {string} raw - Raw stdin text.
 * @param {string} [fallbackCwd] - Used when the payload omits `cwd`.
 * @returns {{eventName:string, toolName:string, toolInput:Record<string,unknown>, prompt:string, cwd:string, raw:Record<string,unknown>}}
 */
export function parseHookInput(raw, fallbackCwd) {
  let data = {};
  if (raw && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        data = parsed;
      }
    } catch {
      data = {};
    }
  }
  const toolInput =
    data.tool_input && typeof data.tool_input === 'object' ? data.tool_input : {};
  return {
    eventName: typeof data.hook_event_name === 'string' ? data.hook_event_name : '',
    toolName: typeof data.tool_name === 'string' ? data.tool_name : '',
    toolInput,
    prompt: typeof data.prompt === 'string' ? data.prompt : '',
    cwd: typeof data.cwd === 'string' && data.cwd ? data.cwd : fallbackCwd || '',
    raw: data,
  };
}

/**
 * First file-path-like field from a tool input (Write/Edit/Read/NotebookEdit/Glob/Grep).
 * @param {{toolInput:Record<string,unknown>}} input
 * @returns {string}
 */
export function getFilePath(input) {
  const ti = input.toolInput || {};
  if (typeof ti.file_path === 'string' && ti.file_path) return ti.file_path;
  if (typeof ti.notebook_path === 'string' && ti.notebook_path) return ti.notebook_path;
  if (typeof ti.path === 'string' && ti.path) return ti.path;
  return '';
}

/**
 * The shell command from a Bash tool input.
 * @param {{toolInput:Record<string,unknown>}} input
 * @returns {string}
 */
export function getCommand(input) {
  const ti = input.toolInput || {};
  return typeof ti.command === 'string' ? ti.command : '';
}

/**
 * The content being written by a Write/Edit/NotebookEdit tool input.
 * @param {{toolInput:Record<string,unknown>}} input
 * @returns {string}
 */
export function getWriteContent(input) {
  const ti = input.toolInput || {};
  const parts = [];
  if (typeof ti.content === 'string') parts.push(ti.content);
  if (typeof ti.new_string === 'string') parts.push(ti.new_string);
  if (typeof ti.new_source === 'string') parts.push(ti.new_source);
  // MultiEdit delivers an edits[] array of {old_string, new_string}.
  if (Array.isArray(ti.edits)) {
    for (const edit of ti.edits) {
      if (edit && typeof edit.new_string === 'string') parts.push(edit.new_string);
    }
  }
  return parts.join('\n');
}

/**
 * Recursively collect all string values from a value, depth-bounded.
 * @param {unknown} value
 * @param {string[]} out
 * @param {number} depth
 */
function collectStrings(value, out, depth) {
  if (depth > 6 || value === null || value === undefined) return;
  if (typeof value === 'string') {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectStrings(v, out, depth + 1);
    return;
  }
  if (typeof value === 'object') {
    for (const key of Object.keys(value)) collectStrings(value[key], out, depth + 1);
  }
}

/**
 * Gather all scannable text from a hook payload (prompt + every string in tool_input).
 * Used by the content guards (jailbreak / prompt-injection / pii / secret-in-text).
 * @param {{prompt:string, toolInput:Record<string,unknown>}} input
 * @returns {string}
 */
export function gatherText(input) {
  const parts = [];
  if (input.prompt) parts.push(input.prompt);
  collectStrings(input.toolInput, parts, 0);
  return parts.join('\n');
}
