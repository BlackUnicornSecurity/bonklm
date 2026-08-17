/**
 * tsd type-surface suite — @blackunicorn/bonklm-sandbox-utils (ST-04-242).
 *
 * Locks the published public type surface (imports by package name, so it
 * resolves the package `types` entry exactly as a consumer would) and proves
 * the signatures reject misuse. Run with `pnpm exec tsd` from the package dir.
 * Lives in test-d/ (tsd's default dir) so vitest test files stay out of scope.
 */
import { expectType, expectError, expectAssignable, expectNotAssignable } from 'tsd';
import {
  validateCode,
  validatePath,
  wrapStream,
  SandboxStreamBlocked,
  _resetFailOpenWarnState,
  EXPERIMENTAL_WARN_LABEL,
  type SandboxValidationResult,
  type SandboxValidatorOptions,
  type SandboxWrapStreamOptions,
  type OnSandboxErrorAction
} from '@blackunicorn/bonklm-sandbox-utils';

// --- validateCode -----------------------------------------------------------
expectType<Promise<SandboxValidationResult>>(validateCode('const x = 1;'));
expectType<Promise<SandboxValidationResult>>(validateCode('x', { timeoutMs: 10, onSandboxError: 'allow' }));
expectError(validateCode());
expectError(validateCode(123));
expectError(validateCode('x', { onSandboxError: 'sometimes' }));
expectError(validateCode('x', { notAnOption: true }));
// `wrapperKey` is an internal-but-published option (intentional callers: e2b/daytona adapters);
// lock it so an accidental removal from the public type surface fails this suite.
expectType<Promise<SandboxValidationResult>>(validateCode('x', { wrapperKey: {} }));

// --- validatePath -----------------------------------------------------------
expectType<Promise<SandboxValidationResult>>(validatePath('/a/b', '/cwd'));
expectType<Promise<SandboxValidationResult>>(validatePath('/a', '/cwd', { onSandboxError: 'block' }));
expectError(validatePath('/a'));
expectError(validatePath(1, 2));

// --- wrapStream (generic — chunk type preserved) ----------------------------
declare const strStream: AsyncIterable<string>;
declare const binStream: AsyncIterable<Uint8Array>;
expectType<AsyncGenerator<string, void, unknown>>(wrapStream(strStream, { validators: ['code'] }));
expectType<AsyncGenerator<Uint8Array, void, unknown>>(wrapStream(binStream, { validators: ['path'], cwd: '/tmp' }));
expectError(wrapStream(strStream, {})); // `validators` is required

// --- SandboxStreamBlocked ---------------------------------------------------
const blocked = new SandboxStreamBlocked('reason', 'category');
expectAssignable<Error>(blocked);
expectType<'SandboxStreamBlocked'>(blocked.name);
expectType<string>(blocked.reason);
expectType<string | undefined>(blocked.category);
expectType<SandboxStreamBlocked>(new SandboxStreamBlocked('reason')); // category optional
expectError(new SandboxStreamBlocked());

// --- internal reset + constant ----------------------------------------------
expectType<void>(_resetFailOpenWarnState());
expectType<'BONKLM_SANDBOX_EXPERIMENTAL_FAIL_OPEN'>(EXPERIMENTAL_WARN_LABEL);

// --- exported type shapes ---------------------------------------------------
expectAssignable<SandboxValidationResult>({ allowed: true, blocked: false });
expectAssignable<SandboxValidationResult>({
  allowed: false,
  blocked: true,
  reason: 'r',
  severity: 'critical',
  category: 'c',
  validatorError: true
});
expectAssignable<SandboxValidatorOptions>({
  timeoutMs: 1,
  onSandboxError: 'allow',
  nodeEnv: 'production',
  warn: (label, ctx) => void [label, ctx]
});
expectAssignable<SandboxWrapStreamOptions>({ validators: ['code', 'path'], cwd: '/x' });
expectAssignable<OnSandboxErrorAction>('block');
expectAssignable<OnSandboxErrorAction>('allow');
expectNotAssignable<OnSandboxErrorAction>('nope');
expectNotAssignable<SandboxWrapStreamOptions>({ validators: ['exec'] });
