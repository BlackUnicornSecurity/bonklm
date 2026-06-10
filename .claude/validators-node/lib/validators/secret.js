import { getWriteContent, getFilePath } from '../input.js';
import { isExampleContext, isExampleFile } from '../example-content.js';

/**
 * Secret guard — blocks writing high-confidence hardcoded credentials.
 *
 * Posture: HARD BLOCK on a confident provider-key match in non-example content.
 * Patterns are ported from the library's reviewed set (incl. the Anthropic
 * `sk-ant-api03-...{93}` boundary). All patterns are anchored/bounded — no
 * unbounded quantifiers — to avoid catastrophic backtracking.
 * Example/placeholder lines and *.example/template files are skipped.
 */

/** @type {{re:RegExp,type:string}[]} — non-global (stateless .test per line). */
const CRITICAL_PATTERNS = [
  { re: /AKIA[0-9A-Z]{16}/, type: 'AWS Access Key ID' },
  { re: /gh[opusr]_[A-Za-z0-9]{36}/, type: 'GitHub Token' },
  { re: /xox[baprs]-[0-9]{10,13}-[0-9]{10,13}-[a-zA-Z0-9]{24}/, type: 'Slack Token' },
  { re: /sk_(?:live|test)_[A-Za-z0-9]{24,64}/, type: 'Stripe Secret Key' },
  { re: /AIza[0-9A-Za-z_-]{35}/, type: 'Google API Key' },
  { re: /sk-ant-api03-[A-Za-z0-9_-]{93}/, type: 'Anthropic API Key' },
  { re: /sk-[A-Za-z0-9]{20}T3BlbkFJ[A-Za-z0-9]{20}/, type: 'OpenAI Key' },
  { re: /sk-proj-[A-Za-z0-9]{20,64}T3BlbkFJ[A-Za-z0-9]{20,64}/, type: 'OpenAI Project Key' },
  { re: /glpat-[A-Za-z0-9_-]{20}/, type: 'GitLab Personal Access Token' },
  { re: /npm_[A-Za-z0-9]{36}/, type: 'npm Access Token' },
  {
    re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?(?:PRIVATE KEY|PRIVATE KEY BLOCK)-----/,
    type: 'Private Key',
  },
  {
    re: /(?:mongodb|postgres|postgresql|mysql|mariadb|redis):\/\/[^\s:@/]+:[^\s@/]{1,200}@[^\s/]+/i,
    type: 'Database URL with embedded credentials',
  },
];

/**
 * @param {object} input - parsed hook input
 * @returns {{block:boolean,title:string,reason:string,target:string,recommendations:string[]}|null}
 */
export function validateSecret(input) {
  const content = getWriteContent(input);
  if (!content) return null;

  const filePath = getFilePath(input);
  if (isExampleFile(filePath)) return null;

  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (isExampleContext(line)) continue;
    for (const { re, type } of CRITICAL_PATTERNS) {
      if (re.test(line)) {
        return {
          block: true,
          title: 'HARDCODED SECRET DETECTED',
          reason: `Possible ${type} on line ${i + 1} of the content being written.`,
          target: filePath || '(write content)',
          recommendations: [
            'Load secrets from environment variables or a secret manager.',
            'If this is a sample, mark the value as an example/placeholder or use a *.example file.',
          ],
        };
      }
    }
  }
  return null;
}
