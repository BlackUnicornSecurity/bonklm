/**
 * tsd type-surface suite — @blackunicorn/bonklm-elizaos (ST-04-206).
 *
 * The heaviest public surface in the repo: 33 value exports + 21 type
 * exports. Imports by package name so it resolves the package `types`
 * entry exactly as a consumer would, and proves every signature
 * rejects misuse. Covers:
 *   - the sealed-wrap installer (`installSealedWrapMemory`) + the ALS
 *     call-context helpers (`withCallContext` / `withCallContextSync` /
 *     `runWithoutCallContext` are generic — the callback return type `T`
 *     is threaded through unchanged),
 *   - the Levenshtein typo-squat trio + `TypoSquatResult` shape,
 *   - the startup-probe pair + the 4-member `ProbeOutcome` discriminated
 *     union (locked on `kind`) + `ProbeOptions` (agentId + port required),
 *   - the recipient-gate + signing-action wrap,
 *   - the doctor audit family + `DoctorFinding` / `DoctorReport` shapes,
 *   - the shadow-log adapter + integration surface (`ShadowLogAuthError`
 *     class, room-access assertion, MESSAGE_RECEIVED mapper, the
 *     verify-and-read flow + its opaque `AuthenticatedMessagesResult`),
 *   - the `bonklmPlugin` factory + `BonklmPluginOptions` bag,
 *   - the two constants (`BONKLM_PLUGIN_PRIORITY` literal `1000` vs the
 *     widened `VERIFIED_PUBLISHER_ALLOWLIST`),
 *   - the re-exported core `ConnectorValidationError`.
 *
 * Run via `pnpm exec tsd`. Lives in test-d/ (tsd's default dir).
 */
import { expectType, expectError, expectAssignable, expectNotAssignable } from 'tsd';
import type {
  GuardrailEngine,
  Logger,
  ShadowLog,
  ShadowLogEntry,
  ShadowLogSourceTrust,
  ShadowLogStorageAdapter
} from '@blackunicorn/bonklm';
import {
  installSealedWrapMemory,
  withCallContext,
  getCallContext,
  assertCallContextRuntime,
  bindEngineCallContext,
  runWithoutCallContext,
  withCallContextSync,
  detectTypoSquat,
  detectTypoSquatBatch,
  levenshteinDistance,
  runStartupProbe,
  applyProbeOutcome,
  evaluateRecipientGate,
  wrapSigningAction,
  auditCharacterFile,
  auditInstalledVersions,
  auditPlugins,
  buildReport,
  probeOutcomeToFindings,
  runDoctor,
  runDoctorRuntime,
  bonklmPlugin,
  createElizaOSDrizzleShadowLogStorage,
  assertRoomAccess,
  ShadowLogAuthError,
  mapMessageReceivedToShadowLog,
  verifyAndReadAuthenticatedMessages,
  shadowLogIntegrityFailureMessage,
  buildEolFindingV04,
  warnAcknowledgeClass4RiskDeprecated,
  BONKLM_PLUGIN_PRIORITY,
  VERIFIED_PUBLISHER_ALLOWLIST,
  ConnectorValidationError,
  type CallContext,
  type TypoSquatResult,
  type ProbeOutcome,
  type ProbeOptions,
  type DrizzleShadowLogClient,
  type DrizzleShadowLogStorageOptions,
  type ElizaMessageReceivedEvent,
  type AuthenticatedMessagesResult,
  type VerifyAndReadOptions,
  type ActionLike,
  type BonklmPluginOptions,
  type BonklmRuntimeNamespace,
  type DoctorFinding,
  type DoctorReport,
  type IAgentRuntimeLike,
  type MemoryLike,
  type PluginLike,
  type PluginLoadContext,
  type ProviderLike,
  type ProviderResultLike,
  type SourceTrust
} from '@blackunicorn/bonklm-elizaos';

declare const runtime: IAgentRuntimeLike;
declare const engine: GuardrailEngine;
declare const logger: Logger;
declare const ctx: CallContext;
declare const outcome: ProbeOutcome;
declare const memory: MemoryLike;
declare const action: ActionLike;
declare const shadowLog: ShadowLog;
declare const coreSourceTrust: ShadowLogSourceTrust;
declare const event: ElizaMessageReceivedEvent;
declare const client: DrizzleShadowLogClient;

// --- call-context helpers (withCallContext* generic — T threaded) -----------
expectType<void>(installSealedWrapMemory(runtime, {}));
expectError(installSealedWrapMemory(runtime)); // options required
expectError(installSealedWrapMemory()); // runtime + options required

expectType<Promise<number>>(withCallContext(runtime, ctx, () => 1));
expectType<Promise<number>>(withCallContext(runtime, ctx, async () => 1));
expectType<string>(withCallContextSync(runtime, ctx, () => 'x'));
expectError(withCallContext(runtime, ctx)); // fn required

expectType<CallContext | undefined>(getCallContext());
expectType<void>(assertCallContextRuntime());
expectType<void>(bindEngineCallContext(engine));
expectError(bindEngineCallContext({})); // requires a GuardrailEngine
expectType<Promise<boolean>>(runWithoutCallContext(() => true));
expectType<Promise<boolean>>(runWithoutCallContext(async () => true));

// --- CallContext / SourceTrust ----------------------------------------------
expectAssignable<CallContext>({ sourceTrust: 'authenticated' });
expectAssignable<CallContext>({ sourceTrust: 'agent_internal', pluginName: 'p' });
expectNotAssignable<CallContext>({}); // sourceTrust required
expectNotAssignable<CallContext>({ sourceTrust: 'nope' }); // bad source-trust
expectAssignable<SourceTrust>('authenticated');
expectAssignable<SourceTrust>('unauthenticated_http');
expectAssignable<SourceTrust>('agent_internal');
expectNotAssignable<SourceTrust>('trusted');

// --- typo-squat trio + TypoSquatResult --------------------------------------
expectType<TypoSquatResult>(detectTypoSquat('plugin-a'));
expectType<TypoSquatResult>(detectTypoSquat('plugin-a', ['plugin-a', 'plugin-b']));
expectError(detectTypoSquat()); // pluginName required
expectType<TypoSquatResult[]>(detectTypoSquatBatch(['a', 'b']));
expectType<TypoSquatResult[]>(detectTypoSquatBatch(['a'], ['a']));
expectType<number>(levenshteinDistance('a', 'b'));
expectError(levenshteinDistance('a')); // both args required

expectAssignable<TypoSquatResult>({ pluginName: 'p', exactMatch: true });
expectAssignable<TypoSquatResult>({
  pluginName: 'p',
  exactMatch: false,
  nearestTypoSquat: { target: 't', distance: 2 }
});
expectNotAssignable<TypoSquatResult>({ pluginName: 'p' }); // exactMatch required
expectNotAssignable<TypoSquatResult>({ pluginName: 'p', exactMatch: true, nearestTypoSquat: { target: 't' } }); // distance required

// --- startup probe + ProbeOutcome union + ProbeOptions ----------------------
expectType<Promise<ProbeOutcome>>(runStartupProbe({ agentId: 'a', port: 3000 }));
expectType<Promise<ProbeOutcome>>(
  runStartupProbe({ agentId: 'a', port: 3000, acknowledgeClass4Risk: true, envBindings: { NODE_ENV: 'test' }, logger })
);
expectError(runStartupProbe({ agentId: 'a' })); // port required
expectError(runStartupProbe({ port: 3000 })); // agentId required
expectType<void>(applyProbeOutcome(outcome, {}));
expectType<void>(applyProbeOutcome(outcome, { logger, productionMode: true }));
expectError(applyProbeOutcome(outcome)); // opts required

expectAssignable<ProbeOutcome>({ kind: 'unauth_detected_no_ack' });
expectAssignable<ProbeOutcome>({ kind: 'unauth_detected_acknowledged' });
expectAssignable<ProbeOutcome>({ kind: 'unreachable', reason: 'ECONNREFUSED' });
expectAssignable<ProbeOutcome>({ kind: 'skipped', reason: 'no port' });
expectNotAssignable<ProbeOutcome>({ kind: 'unreachable' }); // reason required for unreachable
expectNotAssignable<ProbeOutcome>({ kind: 'open' }); // not a probe-outcome kind
expectAssignable<ProbeOptions>({ agentId: 'a', port: 3000 });
expectNotAssignable<ProbeOptions>({ agentId: 'a' }); // port required
expectNotAssignable<ProbeOptions>({ agentId: 'a', port: '3000' }); // port is number

// --- recipient gate + signing-action wrap -----------------------------------
expectType<{ block: boolean; reason?: string }>(evaluateRecipientGate('0xabc', [memory]));
expectError(evaluateRecipientGate('0xabc')); // memories required
expectType<ActionLike>(wrapSigningAction(action, runtime, {}));
expectError(wrapSigningAction(action, runtime)); // options required
expectError(wrapSigningAction(action)); // runtime + options required

// --- doctor audit family + DoctorFinding / DoctorReport ---------------------
expectType<DoctorFinding[]>(auditCharacterFile({}, 'character.json'));
expectType<DoctorFinding[]>(auditCharacterFile(null, undefined));
expectError(auditCharacterFile({})); // filePath arg required (string | undefined)
expectType<DoctorFinding[]>(auditInstalledVersions({ '@blackunicorn/bonklm-elizaos': '0.4.1' }));
expectType<DoctorFinding[]>(auditInstalledVersions(undefined));
expectType<DoctorFinding[]>(auditPlugins([{ name: 'p' }]));
expectType<DoctorReport>(buildReport([]));
expectType<DoctorFinding[]>(probeOutcomeToFindings(outcome));
expectType<DoctorReport>(runDoctor({}));
expectType<DoctorReport>(
  runDoctor({ character: {}, characterFilePath: 'c.json', plugins: [{ name: 'p' }], installedVersions: { a: '1' } })
);
expectType<Promise<DoctorReport>>(runDoctorRuntime({ agentId: 'a', port: 3000 }));
expectType<Promise<DoctorReport>>(runDoctorRuntime({ agentId: 'a', port: 3000, applyLogSideEffects: true }));
expectError(runDoctorRuntime({ agentId: 'a' })); // port required (ProbeOptions & ...)

expectAssignable<DoctorFinding>({ severity: 'INFO', category: 'c', description: 'd' });
expectAssignable<DoctorFinding>({ severity: 'CRITICAL', category: 'c', description: 'd', file: 'f', pluginName: 'p' });
expectNotAssignable<DoctorFinding>({ severity: 'LOW', category: 'c', description: 'd' }); // LOW not in the union
expectNotAssignable<DoctorFinding>({ severity: 'INFO', category: 'c' }); // description required
expectAssignable<DoctorReport>({ findings: [], criticalCount: 0, exitCode: 0 });
expectNotAssignable<DoctorReport>({ findings: [], criticalCount: 0 }); // exitCode required

// --- bonklmPlugin factory + BonklmPluginOptions -----------------------------
expectType<PluginLike>(bonklmPlugin());
expectType<PluginLike>(bonklmPlugin({}));
expectType<PluginLike>(
  bonklmPlugin({ validators: [], guards: [], productionMode: true, signingActionRegex: /SEND_/, runtimePort: 3000 })
);
expectError(bonklmPlugin({ validators: 'nope' })); // validators is Validator[]
expectAssignable<BonklmPluginOptions>({});
expectAssignable<BonklmPluginOptions>({ shadowLog, acknowledgeClass4Risk: true });
expectNotAssignable<BonklmPluginOptions>({ productionMode: 'yes' }); // boolean field

// --- shadow-log adapter ------------------------------------------------------
expectType<ShadowLogStorageAdapter>(createElizaOSDrizzleShadowLogStorage({ client }));
expectType<ShadowLogStorageAdapter>(createElizaOSDrizzleShadowLogStorage({ client, schemaName: 'bonklm_shadow' }));
expectError(createElizaOSDrizzleShadowLogStorage({})); // client required
expectAssignable<DrizzleShadowLogStorageOptions>({ client });
expectNotAssignable<DrizzleShadowLogStorageOptions>({ schemaName: 'x' }); // client required
expectAssignable<DrizzleShadowLogClient>({
  insert: async () => {},
  selectByRoom: async () => [],
  selectLatestHashForRoom: async () => null
});
expectNotAssignable<DrizzleShadowLogClient>({ insert: async () => {} }); // selectByRoom + selectLatestHashForRoom required

// --- assertRoomAccess + ShadowLogAuthError ----------------------------------
expectType<void>(assertRoomAccess(new Set(['room-1']), 'room-1'));
expectType<void>(assertRoomAccess(undefined, 'room-1'));
expectError(assertRoomAccess(new Set(['room-1']))); // requestedRoomId required
const authErr = new ShadowLogAuthError('public', 'detail with roomId');
expectAssignable<Error>(authErr);
expectType<string>(authErr.publicMessage);
expectType<string>(authErr.detailMessage);
expectError(new ShadowLogAuthError('public')); // detailMessage required
expectError(new ShadowLogAuthError()); // both required

// --- MESSAGE_RECEIVED mapper + verify-and-read flow --------------------------
expectType<{
  messageId: string;
  roomId: string;
  entityId: string;
  text: string;
  sourceTrust: ShadowLogSourceTrust;
}>(mapMessageReceivedToShadowLog(event, coreSourceTrust));
expectError(mapMessageReceivedToShadowLog(event)); // sourceTrust required
expectAssignable<ElizaMessageReceivedEvent>({ messageId: 'm', roomId: 'r', entityId: 'e', content: {} });
expectAssignable<ElizaMessageReceivedEvent>({ messageId: 'm', roomId: 'r', entityId: 'e', content: { text: 't' } });
expectNotAssignable<ElizaMessageReceivedEvent>({ messageId: 'm', roomId: 'r', entityId: 'e' }); // content required

expectType<Promise<AuthenticatedMessagesResult>>(
  verifyAndReadAuthenticatedMessages({ shadowLog, roomId: 'r', authenticatedRoomIds: new Set(['r']) })
);
expectError(verifyAndReadAuthenticatedMessages({ shadowLog, roomId: 'r' })); // authenticatedRoomIds required
expectAssignable<VerifyAndReadOptions>({ shadowLog, roomId: 'r', authenticatedRoomIds: undefined });
expectAssignable<VerifyAndReadOptions>({
  shadowLog,
  roomId: 'r',
  authenticatedRoomIds: new Set<string>(),
  sourceFilter: ['authenticated'],
  logger,
  onTamperDetected: d => {
    expectType<{ roomId: string; brokenAt: number }>(d);
  }
});
// AuthenticatedMessagesResult is opaque on failure ({ ok: false } carries no brokenAt).
expectAssignable<AuthenticatedMessagesResult>({ ok: false });
declare const entries: ShadowLogEntry[];
expectAssignable<AuthenticatedMessagesResult>({ ok: true, entries });
expectNotAssignable<AuthenticatedMessagesResult>({ ok: false, brokenAt: 3 }); // brokenAt must NOT surface publicly

// --- standalone helpers ------------------------------------------------------
expectType<string>(shadowLogIntegrityFailureMessage());
expectType<{ severity: 'HIGH'; category: string; description: string; pluginName: string }>(
  buildEolFindingV04('0.4.1')
);
expectError(buildEolFindingV04()); // installedVersion required
expectType<void>(warnAcknowledgeClass4RiskDeprecated(logger));
expectType<void>(warnAcknowledgeClass4RiskDeprecated(undefined));

// --- re-exported core ConnectorValidationError ------------------------------
const cve = new ConnectorValidationError('msg');
expectType<ConnectorValidationError>(cve);
expectType<string>(cve.category);
expectType<number | undefined>(cve.statusCode);
new ConnectorValidationError('m', 'invalid_runtime', 400);
expectError(new ConnectorValidationError()); // message required

// --- constants: literal `1000` vs widened ReadonlyArray ---------------------
expectType<1000>(BONKLM_PLUGIN_PRIORITY);
expectType<ReadonlyArray<string>>(VERIFIED_PUBLISHER_ALLOWLIST);

// --- remaining structural types ---------------------------------------------
expectAssignable<ActionLike>({ name: 'SEND_SOL' });
expectNotAssignable<ActionLike>({}); // name required
expectAssignable<PluginLike>({ name: 'p' });
expectNotAssignable<PluginLike>({}); // name required
expectAssignable<PluginLoadContext>({ runtime });
expectNotAssignable<PluginLoadContext>({}); // runtime required
expectAssignable<ProviderLike>({});
expectAssignable<ProviderLike>({ name: 'p', get: async () => ({ text: 'x' }) });
expectAssignable<ProviderResultLike>({});
expectAssignable<ProviderResultLike>({ text: 'x', values: {}, data: {} });
expectAssignable<MemoryLike>({});
expectAssignable<MemoryLike>({ id: 'm', roomId: 'r', content: { text: 't' }, source: 'authenticated' });
expectAssignable<IAgentRuntimeLike>({});
expectAssignable<IAgentRuntimeLike>({ agentId: 'a', actions: [], plugins: [] });
expectAssignable<BonklmRuntimeNamespace>({});
expectNotAssignable<BonklmRuntimeNamespace>({ anything: 1 }); // Record<string, never> — no populated keys
