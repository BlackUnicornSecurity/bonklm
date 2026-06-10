import { getCommand } from '../input.js';
import { isPathInRepo, resolvePath } from '../paths.js';

/**
 * Bash safety guard — blocks catastrophic, effectively-irreversible shell commands.
 *
 * Posture: HARD BLOCK on (a) a small set of always-dangerous command patterns and
 * (b) tree-destroying verbs (`rm -rf`, `find ... -delete|-exec rm`, `shred`) whose
 * target is unverifiable (a shell variable / command substitution) or resolves
 * outside the repository. `cd` is tracked across `&&`/`;`/`|` segments so that
 * `cd /etc && rm -rf .` resolves the `.` against `/etc` (outside the repo) and is
 * blocked. The verb token is normalized (`\rm`, `'rm'`, `/bin/rm`) before matching.
 *
 * This is a best-effort guard, not a shell sandbox: regex/tokenization cannot model
 * every shell construct. It is one defense-in-depth layer; the env/sentinel
 * kill-switch is the single documented escape hatch (no override tokens are ported).
 */

const SHELL_OPERATORS = new Set(['|', '||', '&&', ';', '>', '>>', '2>', '2>>', '&>', '<', '&']);

/** Dangerous patterns checked against the full command string. */
const DANGEROUS_PATTERNS = [
  { re: /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, msg: 'fork bomb' },
  { re: /\bmkfs\.[a-z0-9]+/i, msg: 'filesystem format (mkfs)' },
  { re: /\bdd\b[^\n]{0,200}?\bof=\/dev\/[a-z]/i, msg: 'dd writing directly to a device' },
  { re: />\s*\/dev\/(?:sd|nvme|disk|hd)[a-z0-9]/i, msg: 'redirect to a raw block device' },
  { re: /\b(?:curl|wget)\b[^\n|]{0,400}\|\s*(?:sudo\s+)?(?:ba|z|k)?sh\b/i, msg: 'piping a download into a shell' },
  { re: /\bchmod\s+(?:-[a-zA-Z]+\s+)*0?777\s+\/(?:etc|usr|bin|sbin|var|\s|$)/i, msg: 'chmod 777 on a system path' },
];

/** Split a command into pipeline/chain segments so each is analyzed independently. */
function splitSegments(cmd) {
  return cmd
    .split(/\s*(?:\|\||&&|[|;&])\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Strip one surrounding quote pair from a token. */
function stripQuotes(value) {
  return value.replace(/^['"]/, '').replace(/['"]$/, '');
}

/** Normalize a command verb token: drop a leading backslash / group-opener / quotes, take the basename. */
function baseVerb(token) {
  const cleaned = stripQuotes(token.replace(/^[\\({]+/, ''));
  const slash = cleaned.lastIndexOf('/');
  return slash >= 0 ? cleaned.slice(slash + 1) : cleaned;
}

/** A target a static check cannot verify (shell variable / command substitution). */
function isUnverifiableTarget(target) {
  return (
    target.startsWith('$') ||
    target.includes('${') ||
    target.includes('$(') ||
    target.includes('`')
  );
}

/** The meaningful tokens of a segment, skipping leading `sudo`, VAR=val, and group-opener tokens. */
function meaningfulTokens(segment) {
  const tokens = segment.split(/\s+/).filter(Boolean);
  let i = 0;
  while (
    i < tokens.length &&
    (tokens[i] === 'sudo' ||
      tokens[i] === '(' ||
      tokens[i] === '{' ||
      tokens[i] === '((' ||
      /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i]))
  ) {
    i += 1;
  }
  return tokens.slice(i);
}

/** Parse an `rm` invocation; returns flags + targets, or null if the segment is not rm. */
function parseRm(tokens) {
  const rmIndex = tokens.findIndex((t) => baseVerb(t) === 'rm');
  if (rmIndex === -1) return null;
  let hasR = false;
  let hasF = false;
  const targets = [];
  for (let i = rmIndex + 1; i < tokens.length; i += 1) {
    const part = tokens[i];
    if (SHELL_OPERATORS.has(part)) break;
    if (part.startsWith('--')) {
      if (part === '--recursive') hasR = true;
      if (part === '--force') hasF = true;
      continue;
    }
    if (part.startsWith('-')) {
      if (/r/i.test(part)) hasR = true;
      if (/f/i.test(part)) hasF = true;
      continue;
    }
    targets.push(part);
  }
  return { recursiveForce: hasR && hasF, targets };
}

/** Reason a single destructive target should be blocked, or null. */
function unsafeTargetReason(rawTarget, currentDir, projectDir, verb) {
  const target = stripQuotes(rawTarget);
  if (isUnverifiableTarget(target)) {
    return `'${verb}' uses an unverified shell variable / command substitution (${target}).`;
  }
  if (!isPathInRepo(target, currentDir, projectDir)) {
    return `'${verb}' targets a path outside the repository (${target}).`;
  }
  return null;
}

/** Detect a destructive `find` (… -delete | -exec rm | -execdir rm …). */
function findDestroysOutsideRepo(tokens, currentDir, projectDir) {
  if (baseVerb(tokens[0]) !== 'find') return null;
  const hasDelete = tokens.includes('-delete');
  const execIdx = tokens.findIndex((t) => t === '-exec' || t === '-execdir');
  const execRm = execIdx !== -1 && tokens.slice(execIdx + 1).some((t) => baseVerb(t) === 'rm');
  if (!hasDelete && !execRm) return null;
  // The search root is the first non-flag token after `find`.
  const root = tokens.slice(1).find((t) => !t.startsWith('-')) || '.';
  if (isUnverifiableTarget(stripQuotes(root))) {
    return `'find -delete/-exec rm' uses an unverified search root (${root}).`;
  }
  if (!isPathInRepo(stripQuotes(root), currentDir, projectDir)) {
    return `'find -delete/-exec rm' targets a path outside the repository (${root}).`;
  }
  return null;
}

function block(reason, command) {
  return {
    block: true,
    title: 'DANGEROUS COMMAND BLOCKED',
    reason,
    target: command,
    recommendations: [
      'Use an explicit in-repository path, or a non-recursive delete.',
      'If this is genuinely intended, use the kill-switch (see .claude/validators-node/README.md).',
    ],
  };
}

/**
 * @param {object} input - parsed hook input
 * @param {{projectDir:string}} ctx
 * @returns {object|null}
 */
export function validateBashSafety(input, ctx) {
  const cmd = getCommand(input);
  if (!cmd) return null;

  for (const { re, msg } of DANGEROUS_PATTERNS) {
    if (re.test(cmd)) {
      return block(`Command matches a dangerous pattern: ${msg}.`, cmd);
    }
  }

  let currentDir = input.cwd || ctx.projectDir;

  for (const segment of splitSegments(cmd)) {
    const tokens = meaningfulTokens(segment);
    if (tokens.length === 0) continue;

    // Track `cd`/`pushd` so a later relative delete resolves against the right directory.
    const verb = baseVerb(tokens[0]);
    if (verb === 'cd' || verb === 'pushd') {
      const dest = tokens[1];
      if (dest && !isUnverifiableTarget(stripQuotes(dest))) {
        currentDir = resolvePath(stripQuotes(dest), currentDir);
      }
      continue;
    }

    // find ... -delete / -exec rm
    const findReason = findDestroysOutsideRepo(tokens, currentDir, ctx.projectDir);
    if (findReason) return block(findReason, cmd);

    // shred <targets> (irreversible single-file destruction)
    if (baseVerb(tokens[0]) === 'shred') {
      for (const t of tokens.slice(1)) {
        if (t.startsWith('-')) continue;
        const reason = unsafeTargetReason(t, currentDir, ctx.projectDir, 'shred');
        if (reason) return block(reason, cmd);
      }
      continue;
    }

    // rm -rf <targets>
    const rm = parseRm(tokens);
    if (!rm || !rm.recursiveForce) continue;
    if (rm.targets.length === 0) {
      return block("'rm -rf' has no explicit target (e.g. piped via xargs) — unverifiable.", cmd);
    }
    for (const rawTarget of rm.targets) {
      const reason = unsafeTargetReason(rawTarget, currentDir, ctx.projectDir, 'rm -rf');
      if (reason) return block(reason, cmd);
    }
  }
  return null;
}
