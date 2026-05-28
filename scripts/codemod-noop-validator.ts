/**
 * Codemod: replace empty-engine constructions in connector tests with
 * explicit `noOpValidator()` calls.
 *
 * Story 0.1 corrections — PR 2/3.
 *
 * Invariants this codemod enforces, for each `new GuardrailEngine(...)`,
 * `createGuardedX(...)`, `new GuardrailsCallbackHandler(...)`, etc. call
 * encountered in test files listed in scripts/codemod-targets.txt:
 *
 * 1. If the call has NO options argument at all
 *      → insert `{ validators: [noOpValidator()] }` as the second arg.
 * 2. If the options arg is `{}`
 *      → replace with `{ validators: [noOpValidator()] }`.
 * 3. If options has `validators: []` (empty array literal)
 *      → rewrite to `validators: [noOpValidator()]`.
 * 4. If options has NO `validators` property AND no `allowEmptyForTesting: true`
 *      → insert `validators: [noOpValidator()]` as the first property.
 * 5. If options has `allowEmptyForTesting: true` (per D-E "strip and substitute")
 *      → REMOVE the `allowEmptyForTesting` property AND ensure
 *        `validators: [noOpValidator()]` is present (substituting an empty
 *        array, or inserting if no `validators` key).
 * 6. If options has `validators: [<non-empty-real-validators>]`
 *      → LEAVE THE CALL UNTOUCHED (test author wired real validation).
 *
 * After mutation, the import `import { noOpValidator } from
 * '@blackunicorn/bonklm/testing';` is added to the file if not already
 * present.
 *
 * Known miss-patterns (per plan v2 risk M1, NOT remediated by this script —
 * will surface as tsc errors in PR 3 and be remediated manually):
 *   • Spread options: createGuardedX(client, { ...baseOpts })
 *   • Factory indirection: const f = () => createGuardedX(client); f()
 *   • Conditional ternary: createGuardedX(client, cond ? {v:[r]} : {})
 *   • Class-member defaults inherited via Object.assign
 *
 * Run:
 *   npx tsx scripts/codemod-noop-validator.ts --dry-run    # preview
 *   npx tsx scripts/codemod-noop-validator.ts              # apply
 *
 * Output: scripts/codemod-report.json (always written).
 */
import {
  Project,
  type SourceFile,
  type Node,
  type ObjectLiteralExpression,
  type PropertyAssignment,
  type CallExpression,
  type NewExpression,
  SyntaxKind
} from 'ts-morph';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const TARGETS_PATH = path.join(REPO_ROOT, 'scripts/codemod-targets.txt');
const REPORT_PATH = path.join(REPO_ROOT, 'scripts/codemod-report.json');

const DRY_RUN = process.argv.includes('--dry-run');

/**
 * Factory identifiers the codemod targets. Built from a grep across
 * every test file in scripts/codemod-targets.txt; if a new connector
 * lands later, add its factory here.
 */
const TARGET_FACTORIES = new Set<string>([
  // GuardrailEngine direct
  'GuardrailEngine',
  // Class-style
  'GuardrailsCallbackHandler',
  'GuardrailsService',
  // Function-style (createGuarded*)
  'createGuardedAI',
  'createGuardedAnthropic',
  'createGuardedClient',
  'createGuardedCollection',
  'createGuardedCopilotKit',
  'createGuardedIndex',
  'createGuardedInference',
  'createGuardedMCP',
  'createGuardedMastra',
  'createGuardedOllama',
  'createGuardedOpenAI',
  'createGuardedQueryEngine',
  'createGuardedRetriever',
  // Other factory styles
  'createGenkitGuardrailsPlugin',
  'createGuardrailsMiddleware',
  'createGuardrailsService'
]);

/**
 * Per-call rewrite outcome — recorded in the JSON report.
 */
type RewriteOutcome =
  | 'inserted-options-object' // case 1
  | 'replaced-empty-options' // case 2
  | 'rewrote-empty-validators' // case 3
  | 'inserted-validators-prop' // case 4
  | 'stripped-allowempty-and-injected' // case 5
  | 'skipped-real-validators' // case 6
  | 'skipped-non-object-options' // options arg is a spread / identifier / ternary etc.
  | 'skipped-no-options-position' // factory signature has no second arg position
  | 'skipped-unknown-shape';

interface SiteReport {
  file: string;
  line: number;
  column: number;
  factory: string;
  outcome: RewriteOutcome;
  note?: string;
}

interface FileReport {
  file: string;
  importAdded: boolean;
  rewrites: number;
  sites: SiteReport[];
}

const project = new Project({
  tsConfigFilePath: path.join(REPO_ROOT, 'tsconfig.json'),
  // Skip type-resolution work — pure syntactic codemod.
  skipAddingFilesFromTsConfig: true,
  skipFileDependencyResolution: true
});

const targets = fs
  .readFileSync(TARGETS_PATH, 'utf-8')
  .split('\n')
  .map(l => l.trim())
  .filter(l => l.length > 0);

const report: FileReport[] = [];

for (const relPath of targets) {
  const absPath = path.join(REPO_ROOT, relPath);
  // Path-escape guard (audit-loop M2): a poisoned codemod-targets.txt
  // line like `../../etc/passwd` or an absolute path must NOT cause the
  // codemod to mutate files outside the repo. ts-morph would happily
  // load and save anything.
  const normalized = path.resolve(absPath);
  if (!normalized.startsWith(REPO_ROOT + path.sep)) {
    console.warn(`SKIP (escapes repo): ${relPath}`);
    continue;
  }
  if (!fs.existsSync(absPath)) {
    console.warn(`SKIP (not found): ${relPath}`);
    continue;
  }

  const sourceFile = project.addSourceFileAtPath(absPath);
  const fileReport: FileReport = {
    file: relPath,
    importAdded: false,
    rewrites: 0,
    sites: []
  };

  let touchedAnyCall = false;

  // Visit every call expression and new expression.
  const calls: (CallExpression | NewExpression)[] = [
    ...sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression),
    ...sourceFile.getDescendantsOfKind(SyntaxKind.NewExpression)
  ];

  for (const call of calls) {
    const expr = call.getExpression();
    const factoryName = expr.getText().split('.').pop()?.trim() ?? '';

    // Special case: fastify-style plugin registration —
    //   fastify.register(guardrailsPlugin, { ...opts })
    // The first arg's identifier identifies the plugin; options is arg[1].
    // We treat this exactly like a 2-arg factory whose first arg is the
    // plugin reference.
    let isFastifyStylePluginRegister = false;
    if (factoryName === 'register') {
      const firstArg = call.getArguments()[0];
      const firstArgText = firstArg?.getText().trim();
      if (firstArgText === 'guardrailsPlugin' || firstArgText === 'bonklmPlugin') {
        isFastifyStylePluginRegister = true;
      }
    }

    if (!TARGET_FACTORIES.has(factoryName) && !isFastifyStylePluginRegister) {
      continue;
    }

    // Identify which positional argument holds the options object.
    //
    // SINGLE-ARG factories (options at arg[0]):
    //   - GuardrailEngine, GuardrailsCallbackHandler, GuardrailsService
    //   - createGenkitGuardrailsPlugin, createGuardrailsMiddleware,
    //     createGuardrailsService
    //   - createGuardedCopilotKit, createGuardedMastra, createGuardedAI
    //     (audit-loop discovery: these were initially misclassified as
    //     2-arg factories — see corrections plan v2 PR-2 audit blocker)
    //
    // CLIENT-FIRST factories (options at arg[1]):
    //   - everything else (createGuardedAnthropic, createGuardedOpenAI,
    //     etc. — first arg is the SDK client/mock; options is second)
    //
    // The fastify-style `fastify.register(guardrailsPlugin, opts)` path
    // is also options-at-arg[1] (first arg is the plugin reference), and
    // is detected via `isFastifyStylePluginRegister` below.
    const SINGLE_ARG_FACTORIES = new Set<string>([
      'GuardrailEngine',
      'GuardrailsCallbackHandler',
      'GuardrailsService',
      'createGenkitGuardrailsPlugin',
      'createGuardrailsMiddleware',
      'createGuardrailsService',
      'createGuardedCopilotKit',
      'createGuardedMastra',
      'createGuardedAI'
    ]);
    const optionsIndex = SINGLE_ARG_FACTORIES.has(factoryName) ? 0 : 1;

    const args = call.getArguments();
    const pos = { line: call.getStartLineNumber(), column: call.getStart() };
    const recordSite = (outcome: RewriteOutcome, note?: string) => {
      fileReport.sites.push({
        file: relPath,
        line: pos.line,
        column: pos.column,
        factory: factoryName,
        outcome,
        note
      });
      if (
        outcome !== 'skipped-real-validators' &&
        outcome !== 'skipped-non-object-options' &&
        outcome !== 'skipped-no-options-position' &&
        outcome !== 'skipped-unknown-shape'
      ) {
        fileReport.rewrites++;
        touchedAnyCall = true;
      }
    };

    // CASE 1: no options arg at the expected position → insert one.
    if (args.length <= optionsIndex) {
      // For optionsIndex=1, ensure there IS an arg[0] before we add arg[1].
      // For optionsIndex=0, there's literally no args; insert one.
      if (optionsIndex === 0 || args.length === 1) {
        call.addArgument('{ validators: [noOpValidator()] }');
        recordSite('inserted-options-object');
        continue;
      } else {
        recordSite('skipped-no-options-position');
        continue;
      }
    }

    const optionsArg = args[optionsIndex] as Node;

    // Only handle object literal options — bail on identifiers, spreads,
    // ternaries, etc. (per plan v2 risk M1).
    if (optionsArg.getKind() !== SyntaxKind.ObjectLiteralExpression) {
      recordSite('skipped-non-object-options', `kind=${optionsArg.getKindName()}`);
      continue;
    }
    const opts = optionsArg as ObjectLiteralExpression;

    const validatorsProp = opts.getProperty('validators') as PropertyAssignment | undefined;
    const allowEmptyProp = opts.getProperty('allowEmptyForTesting') as PropertyAssignment | undefined;

    // CASE 5 (D-E): strip-and-substitute when allowEmptyForTesting: true is present.
    if (allowEmptyProp && allowEmptyProp.getInitializerOrThrow().getText().trim() === 'true') {
      // Replace empty `validators: []` with the noOp version, or insert if
      // validators key is absent. Then strip allowEmptyForTesting.
      if (validatorsProp) {
        const init = validatorsProp.getInitializerOrThrow().getText().trim();
        if (init === '[]') {
          validatorsProp.setInitializer('[noOpValidator()]');
          allowEmptyProp.remove();
          recordSite('stripped-allowempty-and-injected', 'validators was []');
          continue;
        } else {
          // Real validators are wired AND allowEmptyForTesting=true was set
          // (defensive opt-in). Just strip the now-redundant field; leave
          // validators untouched.
          allowEmptyProp.remove();
          recordSite('stripped-allowempty-and-injected', 'real validators kept');
          continue;
        }
      } else {
        // No validators key at all but allowEmptyForTesting=true. Insert
        // validators at the front, strip the hatch.
        opts.insertPropertyAssignment(0, {
          name: 'validators',
          initializer: '[noOpValidator()]'
        });
        allowEmptyProp.remove();
        recordSite('stripped-allowempty-and-injected', 'inserted validators');
        continue;
      }
    }

    // CASE 6: real validators wired, no allowEmptyForTesting:true → leave.
    if (validatorsProp) {
      const init = validatorsProp.getInitializerOrThrow().getText().trim();
      if (init === '[]') {
        // CASE 3: empty validators literal.
        validatorsProp.setInitializer('[noOpValidator()]');
        recordSite('rewrote-empty-validators');
        continue;
      } else {
        recordSite('skipped-real-validators', `validators=${init.slice(0, 60)}`);
        continue;
      }
    }

    // CASE 2: empty options `{}`.
    if (opts.getProperties().length === 0) {
      // ts-morph "replace" — easier to just insert the property.
      opts.insertPropertyAssignment(0, {
        name: 'validators',
        initializer: '[noOpValidator()]'
      });
      recordSite('replaced-empty-options');
      continue;
    }

    // CASE 4: options has other props, no validators key, no allowEmpty.
    opts.insertPropertyAssignment(0, {
      name: 'validators',
      initializer: '[noOpValidator()]'
    });
    recordSite('inserted-validators-prop');
  }

  // Add the import if any call site got rewritten in this file.
  if (touchedAnyCall) {
    const existingImports = sourceFile.getImportDeclarations();
    const alreadyImported = existingImports.some(imp =>
      imp.getNamedImports().some(named => named.getName() === 'noOpValidator')
    );
    if (!alreadyImported) {
      sourceFile.addImportDeclaration({
        moduleSpecifier: '@blackunicorn/bonklm/testing',
        namedImports: ['noOpValidator']
      });
      fileReport.importAdded = true;
    }
  }

  if (touchedAnyCall && !DRY_RUN) {
    sourceFile.saveSync();
  }

  if (fileReport.rewrites > 0 || fileReport.sites.length > 0) {
    report.push(fileReport);
  }
}

// Aggregate stats for the report header.
const stats = {
  mode: DRY_RUN ? 'dry-run' : 'applied',
  totalFiles: report.length,
  filesWithRewrites: report.filter(f => f.rewrites > 0).length,
  totalRewrites: report.reduce((acc, f) => acc + f.rewrites, 0),
  importsAdded: report.filter(f => f.importAdded).length,
  outcomeCounts: report
    .flatMap(f => f.sites)
    .reduce<Record<string, number>>((acc, s) => {
      acc[s.outcome] = (acc[s.outcome] ?? 0) + 1;
      return acc;
    }, {})
};

const payload = { stats, files: report };
fs.writeFileSync(REPORT_PATH, JSON.stringify(payload, null, 2), 'utf-8');

console.log(JSON.stringify(stats, null, 2));
console.log(`\n${DRY_RUN ? 'DRY-RUN' : 'APPLIED'} — full report at ${path.relative(REPO_ROOT, REPORT_PATH)}`);
