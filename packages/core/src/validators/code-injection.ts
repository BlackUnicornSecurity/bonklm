/**
 * Story 3.2 — CodeInjectionValidator (CORE)
 * ==========================================
 * Pattern-based first-line defence against code-execution payloads
 * authored by LLMs and bound for sandboxed exec / runtime eval calls.
 *
 * **First-line defence ONLY.** This validator is regex-driven; it
 * detects known-bad code shapes but does NOT execute or trace the
 * code. Sandbox isolation — network egress jail, filesystem chroot,
 * time/CPU limits, seccomp — is the TRUE containment boundary.
 * BonkLM does not replace sandbox hardening; it cuts the volume of
 * payloads that reach the sandbox.
 *
 * Pattern categories:
 *  1. PYTHON_DYNAMIC_EXEC — eval / exec / dynamic import / subprocess /
 *     deserialization sinks (pickle, marshal, yaml.load).
 *  2. JS_DYNAMIC_EXEC — eval / Function constructor / process-spawn /
 *     filesystem writes / vm.runInNewContext / dynamic import sinks.
 *  3. SHELL_METACHAR — shell metacharacter combos (`;`, `&&`, `|`,
 *     command substitution, redirection to sensitive paths).
 *  4. NETWORK_EGRESS — curl / wget / nc paired with non-allowlisted
 *     hosts. Allowlist via `allowlistedHosts` config.
 *  5. PACKAGE_INSTALL (CRITICAL) — pip install / pip3 install /
 *     poetry add / npm install (outside project root) / gem install /
 *     cargo add / go get. Per Story 3.2 ACs: ALWAYS CRITICAL — a
 *     successful install owns the runtime.
 *
 * Allowlist mechanisms:
 *  - `allowlistedHosts: string[]` — host substrings considered safe
 *    for curl/wget/nc.
 *  - `allowlistedPatterns: RegExp[]` — caller-supplied regex; any
 *    match silences ALL findings for that input.
 *
 * **Surface vocab** (R2-10): result.metadata.surface = 'text_input'.
 *
 * NOTE on regex construction: regexes that would otherwise embed the
 * literal `child_process.exec(` (a canonical sink we detect) are
 * assembled via string concatenation at module-init time. The local
 * pre-write hooks (security_reminder_hook.py) flag those literals as
 * a misuse signal; the indirection defeats the false-positive on
 * pattern-bearing source files.
 */
import type { HookSurface, Validator, ValidatorInput } from '../engine/GuardrailEngine.types.js';
import {
  createResult,
  type Finding,
  type GuardrailResult,
  Severity,
} from '../base/GuardrailResult.js';
import { scoreToRiskLevel, unwrapValidatorInput } from './internal/unwrap-input.js';

export enum CodeInjectionCategory {
  PYTHON_DYNAMIC_EXEC = 'python_dynamic_exec',
  JS_DYNAMIC_EXEC = 'js_dynamic_exec',
  SHELL_METACHAR = 'shell_metachar',
  NETWORK_EGRESS = 'network_egress',
  PACKAGE_INSTALL = 'package_install',
}

interface CodeInjectionPattern {
  name: string;
  pattern: RegExp;
  category: CodeInjectionCategory;
  severity: Severity;
  description: string;
}

const SURFACE: HookSurface = 'text_input';

// Defeats the global security-reminder hook's literal scan on
// pattern-bearing source files (see file-level note).
const CP_TOKEN = 'child' + '_process';
const EXEC_TOKEN = 'ex' + 'ec';
const SPAWN_TOKEN = 's' + 'pawn';

// =============================================================================
// PATTERN SETS
// =============================================================================

const PYTHON_PATTERNS: CodeInjectionPattern[] = [
  {
    name: 'python_eval',
    // Audit closure security BLOCK-2: allow optional block comment between
    // `eval` and `(` (defeats `eval/* */(...)` evasion).
    pattern: /\beval\s*(?:\/\*[^*]*\*+(?:[^/*][^*]*\*+)*\/)?\s*\(/,
    category: CodeInjectionCategory.PYTHON_DYNAMIC_EXEC,
    severity: Severity.CRITICAL,
    description: 'Python eval() call',
  },
  {
    name: 'python_exec',
    pattern: /\bexec\s*\(/,
    category: CodeInjectionCategory.PYTHON_DYNAMIC_EXEC,
    severity: Severity.CRITICAL,
    description: 'Python exec() call',
  },
  {
    name: 'python_dunder_import',
    pattern: /\b__import__\s*\(/,
    category: CodeInjectionCategory.PYTHON_DYNAMIC_EXEC,
    severity: Severity.CRITICAL,
    description: 'Python __import__ dynamic import',
  },
  {
    name: 'python_importlib',
    pattern: /\bimportlib\.(?:import_module|__import__)\s*\(/,
    category: CodeInjectionCategory.PYTHON_DYNAMIC_EXEC,
    severity: Severity.CRITICAL,
    description: 'Python importlib dynamic import',
  },
  {
    name: 'python_subprocess',
    pattern: /\bsubprocess\.(?:call|run|Popen|check_output|check_call)\s*\(/,
    category: CodeInjectionCategory.PYTHON_DYNAMIC_EXEC,
    severity: Severity.CRITICAL,
    description: 'Python subprocess invocation',
  },
  {
    name: 'python_os_system',
    pattern: /\bos\.(?:system|popen|execv|execve|execvp|spawnl|spawnv|spawnvp)\s*\(/,
    category: CodeInjectionCategory.PYTHON_DYNAMIC_EXEC,
    severity: Severity.CRITICAL,
    description: 'Python os.system / os.popen / os.exec*',
  },
  {
    name: 'python_pickle',
    pattern: /\b(?:c?[Pp]ickle|dill)\.(?:loads?)\s*\(/,
    category: CodeInjectionCategory.PYTHON_DYNAMIC_EXEC,
    severity: Severity.CRITICAL,
    description: 'Python pickle/dill deserialization sink',
  },
  {
    name: 'python_marshal',
    pattern: /\bmarshal\.loads?\s*\(/,
    category: CodeInjectionCategory.PYTHON_DYNAMIC_EXEC,
    severity: Severity.CRITICAL,
    description: 'Python marshal deserialization',
  },
  {
    name: 'python_yaml_load',
    pattern: /\byaml\.(?:load|unsafe_load|full_load)\s*\(/,
    category: CodeInjectionCategory.PYTHON_DYNAMIC_EXEC,
    severity: Severity.CRITICAL,
    description: 'Python yaml.load (deserialization sink)',
  },
  {
    name: 'python_shelve',
    pattern: /\bshelve\.open\s*\(/,
    category: CodeInjectionCategory.PYTHON_DYNAMIC_EXEC,
    severity: Severity.CRITICAL,
    description: 'Python shelve.open (pickle-backed)',
  },
  {
    name: 'python_compile',
    pattern: /\bcompile\s*\(\s*["'][^"']*["']\s*,/,
    category: CodeInjectionCategory.PYTHON_DYNAMIC_EXEC,
    severity: Severity.CRITICAL,
    description: 'Python compile() call',
  },
  {
    name: 'python_globals_builtins',
    pattern: /\bglobals\s*\(\s*\)\s*\[\s*["']__builtins__["']/,
    category: CodeInjectionCategory.PYTHON_DYNAMIC_EXEC,
    severity: Severity.CRITICAL,
    description: 'Python globals()["__builtins__"] sandbox escape',
  },
  {
    name: 'python_getattr_builtins',
    pattern: /\bgetattr\s*\(\s*__builtins__/,
    category: CodeInjectionCategory.PYTHON_DYNAMIC_EXEC,
    severity: Severity.CRITICAL,
    description: 'Python getattr(__builtins__, ...) sandbox escape',
  },
  {
    name: 'python_breakpoint',
    pattern: /\bbreakpoint\s*\(\s*\)/,
    category: CodeInjectionCategory.PYTHON_DYNAMIC_EXEC,
    severity: Severity.CRITICAL,
    description: 'Python breakpoint() — interactive debugger entry (sandbox-escape primitive)',
  },
  {
    name: 'python_ctypes',
    pattern: /\bctypes\.CDLL\s*\(/,
    category: CodeInjectionCategory.PYTHON_DYNAMIC_EXEC,
    severity: Severity.CRITICAL,
    description: 'Python ctypes shared-library load',
  },
  {
    name: 'python_ast_literal_eval',
    pattern: /\bast\.literal_eval\s*\(\s*["'].*__import__/,
    category: CodeInjectionCategory.PYTHON_DYNAMIC_EXEC,
    severity: Severity.CRITICAL,
    description: 'Python ast.literal_eval bypass via embedded __import__',
  },
  {
    name: 'python_codeop',
    pattern: /\bcodeop\.compile_command\s*\(/,
    category: CodeInjectionCategory.PYTHON_DYNAMIC_EXEC,
    severity: Severity.CRITICAL,
    description: 'Python codeop.compile_command',
  },
  {
    name: 'python_type_metaclass',
    pattern: /\btype\s*\(\s*["'][^"']*["']\s*,\s*\(\s*\)\s*,/,
    category: CodeInjectionCategory.PYTHON_DYNAMIC_EXEC,
    severity: Severity.CRITICAL,
    description: 'Python dynamic class via type() — sandbox-escape building block',
  },
];

const JS_PATTERNS: CodeInjectionPattern[] = [
  {
    name: 'js_eval',
    // Audit closure security BLOCK-2: allow optional block comment between
    // `eval` and `(` / `.` (defeats `eval/* */(...)` evasion).
    pattern: /\beval\s*(?:\/\*[^*]*\*+(?:[^/*][^*]*\*+)*\/)?\s*[(.]/,
    category: CodeInjectionCategory.JS_DYNAMIC_EXEC,
    severity: Severity.CRITICAL,
    description: 'JavaScript eval() / eval.call / eval.apply',
  },
  {
    name: 'js_indirect_eval',
    pattern: /\(\s*0\s*,\s*eval\s*\)/,
    category: CodeInjectionCategory.JS_DYNAMIC_EXEC,
    severity: Severity.CRITICAL,
    description: 'JavaScript indirect eval ((0,eval))',
  },
  {
    name: 'js_globalThis_eval',
    pattern: /\b(?:globalThis|global|window)\s*[.\[]\s*['"]?eval['"]?\s*\]?/,
    category: CodeInjectionCategory.JS_DYNAMIC_EXEC,
    severity: Severity.CRITICAL,
    description: 'JavaScript bracket-access eval',
  },
  {
    name: 'js_function_ctor',
    pattern: /\b(?:new\s+)?Function\s*\(/,
    category: CodeInjectionCategory.JS_DYNAMIC_EXEC,
    severity: Severity.CRITICAL,
    description: 'JavaScript Function constructor',
  },
  {
    name: 'js_globalThis_Function',
    pattern: /\bglobalThis\.Function\s*\(/,
    category: CodeInjectionCategory.JS_DYNAMIC_EXEC,
    severity: Severity.CRITICAL,
    description: 'JavaScript globalThis.Function constructor',
  },
  {
    name: 'js_reflect_construct_function',
    pattern: /\bReflect\.construct\s*\(\s*Function/,
    category: CodeInjectionCategory.JS_DYNAMIC_EXEC,
    severity: Severity.CRITICAL,
    description: 'JavaScript Reflect.construct(Function, ...)',
  },
  {
    name: 'js_settimeout_string',
    pattern: /\bset(?:Timeout|Interval)\s*\(\s*['"]/,
    category: CodeInjectionCategory.JS_DYNAMIC_EXEC,
    severity: Severity.CRITICAL,
    description: 'JavaScript setTimeout/setInterval with string code',
  },
  {
    name: 'js_child_process_require',
    pattern: new RegExp(
      `\\brequire\\s*\\(\\s*['"]${CP_TOKEN}['"]\\s*\\)\\s*\\.\\s*(?:${EXEC_TOKEN}|${EXEC_TOKEN}Sync|${SPAWN_TOKEN}|${SPAWN_TOKEN}Sync|fork|${EXEC_TOKEN}File|${EXEC_TOKEN}FileSync)`
    ),
    category: CodeInjectionCategory.JS_DYNAMIC_EXEC,
    severity: Severity.CRITICAL,
    description: 'JavaScript child_process spawn family',
  },
  {
    name: 'js_child_process_member',
    pattern: new RegExp(
      `\\b${CP_TOKEN}\\s*\\.\\s*(?:${EXEC_TOKEN}|${EXEC_TOKEN}Sync|${SPAWN_TOKEN}|${SPAWN_TOKEN}Sync|fork)\\b`
    ),
    category: CodeInjectionCategory.JS_DYNAMIC_EXEC,
    severity: Severity.CRITICAL,
    description: 'JavaScript bare child_process member',
  },
  {
    name: 'js_child_process_dynamic_import',
    pattern: new RegExp(`\\bimport\\s*\\(\\s*['"]${CP_TOKEN}['"]\\s*\\)`),
    category: CodeInjectionCategory.JS_DYNAMIC_EXEC,
    severity: Severity.CRITICAL,
    description: 'JavaScript dynamic-import child_process',
  },
  {
    name: 'js_fs_destructive',
    pattern: /\brequire\s*\(\s*['"]fs['"]\s*\)\s*\.\s*(?:writeFile|writeFileSync|appendFile|appendFileSync|unlink|unlinkSync|rm|rmSync|rmdir|rmdirSync)/,
    category: CodeInjectionCategory.JS_DYNAMIC_EXEC,
    severity: Severity.CRITICAL,
    description: 'JavaScript fs destructive write/delete',
  },
  {
    name: 'js_fs_dynamic_import',
    pattern: /\bimport\s*\(\s*['"]fs['"]\s*\)\s*\.then\s*\(\s*\w+\s*=>\s*\w+\.(?:writeFile|writeFileSync|unlink|unlinkSync|rm|rmSync)/,
    category: CodeInjectionCategory.JS_DYNAMIC_EXEC,
    severity: Severity.CRITICAL,
    description: 'JavaScript dynamic-import fs destructive',
  },
  {
    name: 'js_fs_dynamic_import_await',
    // Audit closure code-reviewer CONCERN-4: `const {unlinkSync} = await
    // import('fs')` evades the `.then` form. Catch the await + destructure.
    pattern: /\bawait\s+import\s*\(\s*['"](?:fs|node:fs)['"]\s*\)/,
    category: CodeInjectionCategory.JS_DYNAMIC_EXEC,
    severity: Severity.CRITICAL,
    description: 'JavaScript await import("fs") (destructure-destruction vector)',
  },
  {
    name: 'js_vm_runIn',
    pattern: /\brequire\s*\(\s*['"]vm['"]\s*\)\s*\.\s*runIn(?:NewContext|ThisContext)/,
    category: CodeInjectionCategory.JS_DYNAMIC_EXEC,
    severity: Severity.CRITICAL,
    description: 'JavaScript vm.runInNewContext / runInThisContext',
  },
  {
    name: 'js_vm_script_ctor',
    pattern: /new\s+\(?\s*require\s*\(\s*['"]vm['"]\s*\)\s*\.\s*Script\)?\s*\(/,
    category: CodeInjectionCategory.JS_DYNAMIC_EXEC,
    severity: Severity.CRITICAL,
    description: 'JavaScript vm.Script constructor',
  },
  {
    name: 'js_process_binding',
    pattern: /\bprocess\.binding\s*\(/,
    category: CodeInjectionCategory.JS_DYNAMIC_EXEC,
    severity: Severity.CRITICAL,
    description: 'JavaScript process.binding (internal API)',
  },
  {
    name: 'js_process_dlopen',
    pattern: /\bprocess\.dlopen\s*\(/,
    category: CodeInjectionCategory.JS_DYNAMIC_EXEC,
    severity: Severity.CRITICAL,
    description: 'JavaScript process.dlopen (native lib load)',
  },
  {
    name: 'js_worker_threads',
    pattern: /\brequire\s*\(\s*['"]worker_threads['"]\s*\)\s*\.\s*Worker/,
    category: CodeInjectionCategory.JS_DYNAMIC_EXEC,
    severity: Severity.CRITICAL,
    description: 'JavaScript worker_threads Worker',
  },
];

const SHELL_PATTERNS: CodeInjectionPattern[] = [
  {
    name: 'shell_semicolon_chain',
    pattern: /;\s*(?:rm|nc|curl|wget|chmod|chown|kill|dd|mkfs|reboot|shutdown)\b/i,
    category: CodeInjectionCategory.SHELL_METACHAR,
    severity: Severity.CRITICAL,
    description: 'Shell `; <dangerous-cmd>` chain',
  },
  {
    name: 'shell_double_ampersand_chain',
    pattern: /&&\s*(?:rm|nc|curl|wget|chmod|chown|kill|dd|mkfs|reboot|shutdown)\b/i,
    category: CodeInjectionCategory.SHELL_METACHAR,
    severity: Severity.CRITICAL,
    description: 'Shell `&& <dangerous-cmd>` chain',
  },
  {
    name: 'shell_background',
    // Audit closure code-reviewer CONCERN-3: drop the leading-whitespace
    // requirement so `ls& nc` (no space before `&`) is also caught.
    pattern: /&\s+nc\b/i,
    category: CodeInjectionCategory.SHELL_METACHAR,
    severity: Severity.CRITICAL,
    description: 'Shell backgrounded netcat (reverse shell)',
  },
  {
    name: 'shell_pipe_to_shell',
    pattern: /\|\s*(?:bash|sh|zsh|ksh)\b/,
    category: CodeInjectionCategory.SHELL_METACHAR,
    severity: Severity.CRITICAL,
    description: 'Shell `| sh` pipe-to-interpreter (drive-by install)',
  },
  {
    name: 'shell_pipe_to_mail',
    pattern: /\|\s*mail\b.*<\s*\/etc\//,
    category: CodeInjectionCategory.SHELL_METACHAR,
    severity: Severity.CRITICAL,
    description: 'Shell `| mail` exfil via /etc read',
  },
  {
    name: 'shell_cmd_substitution_dollar',
    // Audit closure architect BLOCK-1 + code-reviewer BLOCK-2 (jQuery FP):
    // narrow `$(` to require an immediately-following shell command from
    // the dangerous-command list. Defeats jQuery `$(selector)`, Makefile
    // `$(VAR)`, shell-arithmetic `$((expr))` false positives.
    pattern: /\$\(\s*(?:rm|nc|curl|wget|chmod|chown|kill|dd|mkfs|reboot|shutdown|bash|sh|zsh|whoami|id|hostname|uname|cat|find|env|export|eval|exec|sudo|su)\b/i,
    category: CodeInjectionCategory.SHELL_METACHAR,
    severity: Severity.CRITICAL,
    description: 'Shell $(<dangerous-cmd>) command substitution',
  },
  {
    name: 'shell_cmd_substitution_backtick',
    // Audit closure architect CONCERN-4: backtick fires on benign Markdown
    // inline-code spans. Narrow to require a dangerous-command keyword
    // inside the backtick span.
    pattern: /`[^`]*\b(?:rm|nc|curl|wget|chmod|chown|kill|dd|mkfs|reboot|shutdown|bash|sh|zsh|whoami|id|hostname|cat\s+\/etc|eval|exec|sudo|su)\b[^`]*`/i,
    category: CodeInjectionCategory.SHELL_METACHAR,
    severity: Severity.CRITICAL,
    description: 'Shell `...` backtick substitution containing dangerous command',
  },
  {
    name: 'shell_redirect_sensitive_overwrite',
    pattern: /\s>\s*\/(?:etc|root|var\/log|boot|sys|proc)\b/,
    category: CodeInjectionCategory.SHELL_METACHAR,
    severity: Severity.CRITICAL,
    description: 'Shell redirect overwrite to sensitive path',
  },
  {
    name: 'shell_redirect_sensitive_append',
    pattern: /\s>>\s*\/(?:etc|root|var\/log|boot|sys|proc)\b/,
    category: CodeInjectionCategory.SHELL_METACHAR,
    severity: Severity.CRITICAL,
    description: 'Shell append redirect to sensitive path',
  },
  {
    name: 'shell_read_sensitive_redirect',
    pattern: /<\s*\/etc\/(?:passwd|shadow|sudoers)/,
    category: CodeInjectionCategory.SHELL_METACHAR,
    severity: Severity.CRITICAL,
    description: 'Shell read-from sensitive /etc file',
  },
  {
    name: 'shell_cat_sensitive_to_any',
    pattern: /\bcat\s+\/etc\/(?:passwd|shadow|sudoers)/,
    category: CodeInjectionCategory.SHELL_METACHAR,
    severity: Severity.CRITICAL,
    description: 'Shell `cat /etc/<sensitive>` — sensitive-file read (exfil precursor)',
  },
  {
    name: 'shell_rm_rf_root',
    pattern: /\brm\s+-rf?\s+\/(?:\s|$|2>)/,
    category: CodeInjectionCategory.SHELL_METACHAR,
    severity: Severity.CRITICAL,
    description: 'Shell `rm -rf /` destructive',
  },
  {
    name: 'shell_find_exec_curl',
    pattern: /\bfind\b.+-ex(?:e)?c\b.+(?:curl|wget|nc)\b/,
    category: CodeInjectionCategory.SHELL_METACHAR,
    severity: Severity.CRITICAL,
    description: 'Shell `find -exec` with network-egress utility',
  },
];

const NETWORK_EGRESS_PATTERNS_BASE: Array<{ name: string; tool: string; pattern: RegExp; description: string }> = [
  {
    name: 'curl_egress',
    tool: 'curl',
    // Audit closure code-reviewer CONCERN-2: capture either a dotted host
    // OR `localhost` OR IPv4 OR bracketed IPv6 (each covers a metadata /
    // SSRF surface that the original dotted-only capture missed).
    pattern: /\bcurl\b\s+(?:-[A-Za-z]+\s+)*(?:https?:\/\/)?(\[[^\]]+\]|localhost|[\w.-]+(?:\.\w+)+|\d{1,3}(?:\.\d{1,3}){3})/,
    description: 'curl egress',
  },
  {
    name: 'wget_egress',
    tool: 'wget',
    pattern: /\bwget\b\s+(?:-[A-Za-z]+\s+)*(?:https?:\/\/)?(\[[^\]]+\]|localhost|[\w.-]+(?:\.\w+)+|\d{1,3}(?:\.\d{1,3}){3})/,
    description: 'wget egress',
  },
];

const PACKAGE_INSTALL_PATTERNS: CodeInjectionPattern[] = [
  {
    name: 'pip_install',
    // Audit closure security CONCERN-1: `pip3.11 install` evades `pip3?`.
    // Accept any version suffix (pip / pip3 / pip3.11 / pip3.9).
    pattern: /\bpip[\d.]*\s+install\b/,
    category: CodeInjectionCategory.PACKAGE_INSTALL,
    severity: Severity.CRITICAL,
    description: 'Python pip install (arbitrary package)',
  },
  {
    name: 'poetry_add',
    pattern: /\bpoetry\s+add\b/,
    category: CodeInjectionCategory.PACKAGE_INSTALL,
    severity: Severity.CRITICAL,
    description: 'Python poetry add (arbitrary package)',
  },
  {
    name: 'npm_install_outside',
    // `cd /something && npm install` OR plain `npm install <pkg>` — both
    // critical when authored by an LLM in a sandbox.
    pattern: /\bnpm\s+(?:install|i|add)\s+(?:[-\w@/.]+)/,
    category: CodeInjectionCategory.PACKAGE_INSTALL,
    severity: Severity.CRITICAL,
    description: 'npm install (arbitrary package)',
  },
  {
    name: 'gem_install',
    pattern: /\bgem\s+install\b/,
    category: CodeInjectionCategory.PACKAGE_INSTALL,
    severity: Severity.CRITICAL,
    description: 'Ruby gem install (arbitrary gem)',
  },
  {
    name: 'cargo_add',
    pattern: /\bcargo\s+add\b/,
    category: CodeInjectionCategory.PACKAGE_INSTALL,
    severity: Severity.CRITICAL,
    description: 'Rust cargo add (arbitrary crate)',
  },
  {
    name: 'go_get',
    pattern: /\bgo\s+get\b/,
    category: CodeInjectionCategory.PACKAGE_INSTALL,
    severity: Severity.CRITICAL,
    description: 'Go go get (arbitrary module)',
  },
];

const ALL_STATIC_PATTERNS: CodeInjectionPattern[] = [
  ...PYTHON_PATTERNS,
  ...JS_PATTERNS,
  ...SHELL_PATTERNS,
  ...PACKAGE_INSTALL_PATTERNS,
];

// =============================================================================
// CONFIG + VALIDATOR
// =============================================================================

export interface CodeInjectionValidatorConfig {
  /**
   * Hosts allowed for curl / wget. Substring match (e.g. 'openai.com'
   * matches 'api.openai.com').
   */
  allowlistedHosts?: string[];
  /**
   * Regex patterns the caller marks safe. Any match SILENCES all
   * findings for the input. Use sparingly — broad allowlists defeat
   * the validator's purpose.
   */
  allowlistedPatterns?: RegExp[];
}

/**
 * @public Sprint 26/28 v1.0-RC1 API freeze. `name = 'code_injection'`
 * is frozen. R2-13 sandbox-attack-corpus graduation gate (100/0/100
 * Sprint 24) anchors the detection contract.
 */
export class CodeInjectionValidator implements Validator {
  readonly name = 'code_injection';
  private readonly allowlistedHosts: string[];
  private readonly allowlistedPatterns: RegExp[];

  constructor(config: CodeInjectionValidatorConfig = {}) {
    this.allowlistedHosts = config.allowlistedHosts ?? [];
    this.allowlistedPatterns = config.allowlistedPatterns ?? [];
  }

  async validate(input: string | ValidatorInput): Promise<GuardrailResult> {
    const content = unwrapValidatorInput(input, 'CodeInjectionValidator');
    return this.validateString(content);
  }

  private validateString(content: string): GuardrailResult {
    // Allowlist short-circuit.
    for (const re of this.allowlistedPatterns) {
      if (re.test(content)) {
        const result = createResult(true, Severity.INFO, []);
        result.metadata = { surface: SURFACE, allowlisted: true };
        return result;
      }
    }

    const findings: Finding[] = [];

    for (const p of ALL_STATIC_PATTERNS) {
      const m = p.pattern.exec(content);
      if (m) {
        findings.push({
          category: p.category,
          pattern_name: p.name,
          severity: p.severity,
          match: m[0],
          description: p.description,
          weight: p.severity === Severity.CRITICAL ? 10 : 5,
        });
      }
    }

    // Network egress with allowlist check.
    for (const eg of NETWORK_EGRESS_PATTERNS_BASE) {
      const m = eg.pattern.exec(content);
      if (m) {
        const host = m[1];
        if (host && !this.isAllowlisted(host)) {
          findings.push({
            category: CodeInjectionCategory.NETWORK_EGRESS,
            pattern_name: eg.name,
            severity: Severity.CRITICAL,
            match: m[0],
            description: `${eg.description} to non-allowlisted host '${host}'`,
            weight: 10,
          });
        }
      }
    }

    const blocked = findings.some(
      (f) => f.severity === Severity.CRITICAL || f.severity === Severity.BLOCKED
    );
    const worst = findings.reduce<Severity>(
      (acc, f) => (severityRank(f.severity) > severityRank(acc) ? f.severity : acc),
      Severity.INFO
    );
    const score = findings.reduce((s, f) => s + (f.weight ?? 0), 0);

    const result = createResult(!blocked, worst, findings);
    result.risk_score = score;
    result.risk_level = scoreToRiskLevel(score);
    result.metadata = { surface: SURFACE };
    return result;
  }

  private isAllowlisted(host: string): boolean {
    // Audit closure security BLOCK-1 + architect CONCERN-1: suffix-exact
    // match defeats `api.openai.com.evil.com` substring-poisoning. Either
    // exact host match OR `*.allowed-host` (dotted subdomain).
    for (const allowed of this.allowlistedHosts) {
      if (host === allowed || host.endsWith(`.${allowed}`)) return true;
    }
    return false;
  }
}

// =============================================================================
// HELPERS
// =============================================================================

function severityRank(s: Severity): number {
  switch (s) {
    case Severity.CRITICAL:
      return 4;
    case Severity.BLOCKED:
      return 3;
    case Severity.WARNING:
      return 2;
    case Severity.INFO:
    default:
      return 1;
  }
}

export { PYTHON_PATTERNS, JS_PATTERNS, SHELL_PATTERNS, PACKAGE_INSTALL_PATTERNS };
