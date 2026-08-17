/**
 * tsd type-surface suite — @blackunicorn/bonklm-logger (ST-04-248).
 *
 * Locks the published public type surface across the main barrel plus the
 * `./types` subpath export. Imports by package name (+ subpath) so it resolves
 * the `types` entries exactly as a consumer would. Run via `pnpm exec tsd`.
 * Lives in test-d/ (tsd's default dir) so vitest files stay out of scope.
 */
import { expectType, expectError, expectAssignable, expectNotAssignable } from 'tsd';
import {
  AttackLogger,
  AttackLogStore,
  resetSessionId,
  setExportDirectory,
  createConfig,
  validateConfig,
  getDefaultConfig,
  mergeConfig,
  transformToAttackLogEntry,
  deriveInjectionType,
  deriveAttackVector,
  sanitizeContent,
  truncateContent,
  escapeControlCharacters,
  stripAnsiEscapes,
  sanitizeForJSON,
  type ValidatedConfig,
  type AttackLogEntry,
  type InjectionType,
  type AttackVector,
  type RiskLevel,
  type OriginType,
  type DisplayFormat,
  type Finding,
  type AttackLoggerConfig,
  type LogFilter,
  type DisplayOptions,
  type ExportOptions,
  type AttackSummary,
  type InterceptCallback,
  type EngineResult,
  type ValidatorResult
} from '@blackunicorn/bonklm-logger';
// Subpath export — prove the `exports['./types']` entry resolves by name.
import type {
  InjectionType as InjectionTypeSub,
  AttackLogEntry as AttackLogEntrySub,
  InterceptCallback as InterceptCallbackSub
} from '@blackunicorn/bonklm-logger/types';

// --- classes ----------------------------------------------------------------
expectAssignable<new (config?: AttackLoggerConfig) => AttackLogger>(AttackLogger);
expectAssignable<new (...args: any[]) => AttackLogStore>(AttackLogStore);
expectType<AttackLogger>(new AttackLogger());
expectType<AttackLogger>(new AttackLogger({ max_logs: 100, enabled: true }));
expectError(new AttackLogger({ max_logs: 'lots' }));

// --- module-level functions -------------------------------------------------
expectType<void>(resetSessionId());
expectType<void>(setExportDirectory('/tmp/exports'));
expectError(setExportDirectory()); // dir required

// --- config functions -------------------------------------------------------
expectType<ValidatedConfig>(createConfig());
expectType<ValidatedConfig>(createConfig({ max_logs: 50 }));
expectType<ValidatedConfig>(validateConfig({ ttl: 1000 }));
expectType<ValidatedConfig>(getDefaultConfig());
expectType<AttackLoggerConfig>(mergeConfig({ max_logs: 1 }, { enabled: false }));
expectError(createConfig({ enabled: 'yes' }));

// --- transform functions ----------------------------------------------------
declare const findings: Finding[];
declare const engineResult: EngineResult;
declare const transformCtx: Parameters<typeof transformToAttackLogEntry>[1];
expectType<AttackLogEntry>(transformToAttackLogEntry(engineResult, transformCtx));
expectType<AttackLogEntry>(transformToAttackLogEntry(engineResult, transformCtx, true));
expectType<InjectionType>(deriveInjectionType(findings));
expectType<AttackVector>(deriveAttackVector(findings, 'content'));
expectType<string>(sanitizeContent('content'));
expectType<string>(sanitizeContent('content', [/secret/]));
expectType<string>(truncateContent('content'));
expectType<string>(truncateContent('content', 50));
expectType<string>(escapeControlCharacters('content'));
expectType<string>(stripAnsiEscapes('content'));
expectType<string>(sanitizeForJSON('content'));
expectError(deriveInjectionType('not-findings'));
expectError(sanitizeForJSON()); // content required

// --- union types ------------------------------------------------------------
expectAssignable<InjectionType>('prompt-injection');
expectAssignable<InjectionType>('unknown');
expectNotAssignable<InjectionType>('sqli');
expectAssignable<AttackVector>('encoded');
expectNotAssignable<AttackVector>('telepathy');
expectAssignable<RiskLevel>('HIGH');
expectNotAssignable<RiskLevel>('CRITICAL'); // logger RiskLevel is LOW | MEDIUM | HIGH
expectAssignable<OriginType>('sessionId');
expectNotAssignable<OriginType>('global');
expectAssignable<DisplayFormat>('table');
expectNotAssignable<DisplayFormat>('csv');

// --- interface shapes -------------------------------------------------------
expectAssignable<Finding>({ category: 'c', severity: 'critical', description: 'd' });
expectNotAssignable<Finding>({ category: 'c' }); // severity + description required
expectAssignable<AttackLoggerConfig>({});
expectAssignable<AttackLoggerConfig>({ max_logs: 1, ttl: 1, enabled: true, origin_type: 'custom', custom_origin: 'x' });
expectNotAssignable<AttackLoggerConfig>({ origin_type: 'global' });
expectAssignable<LogFilter>({ injection_type: 'jailbreak' });
expectAssignable<LogFilter>({ injection_type: ['jailbreak', 'unknown'], risk_level: ['HIGH'], blocked: true });
expectAssignable<DisplayOptions>({ format: 'json', color: true });
expectAssignable<ExportOptions>({ sanitize_pii: true });
expectAssignable<AttackSummary>({
  total_count: 0,
  blocked_count: 0,
  allowed_count: 0,
  by_injection_type: {} as Record<InjectionType, number>,
  by_attack_vector: {} as Record<AttackVector, number>,
  by_risk_level: {} as Record<RiskLevel, number>,
  highest_risk_entry: null
});

// --- InterceptCallback + result shapes --------------------------------------
expectAssignable<InterceptCallback>((_result: EngineResult, _context: { content: string }) => {});
expectAssignable<InterceptCallback>(async () => {});
declare const er: EngineResult;
expectType<boolean>(er.blocked);
expectType<RiskLevel>(er.risk_level);
declare const vr: ValidatorResult;
expectType<string>(vr.validatorName);
declare const entry: AttackLogEntry;
expectType<InjectionType>(entry.injection_type);
expectType<AttackVector>(entry.vector);

// --- ./types subpath resolves to the identical type declarations ------------
expectAssignable<InjectionTypeSub>('jailbreak');
expectNotAssignable<InjectionTypeSub>('sqli');
expectAssignable<InterceptCallbackSub>(async () => {});
declare const subEntry: AttackLogEntrySub;
expectType<InjectionType>(subEntry.injection_type);
