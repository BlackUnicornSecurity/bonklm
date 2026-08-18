/**
 * Type-surface tests for `@blackunicorn/bonklm-mcp`.
 *
 * Locks the public type contract exported from the package barrel:
 *   - `createGuardedMCP(client, options?)` factory (return type
 *     `GuardedMCPClient` is intentionally NOT exported — asserted via
 *     `ReturnType<>` + arity / misuse checks).
 *   - Option / DTO interfaces: `GuardedMCPOptions`, `ToolCallOptions`,
 *     `ToolCallResult`, `ToolInfo`.
 *   - Re-exported core error classes (4).
 *   - Literal-vs-widened numeric constants + the RegExp pattern.
 *
 * Run via `pnpm --filter @blackunicorn/bonklm-mcp test:types` (tsd).
 */
import { expectType, expectError, expectAssignable, expectNotAssignable } from 'tsd';
import {
  createGuardedMCP,
  StreamValidationError,
  ConnectorValidationError,
  ConnectorConfigurationError,
  ConnectorTimeoutError,
  DEFAULT_MAX_ARGUMENT_SIZE,
  DEFAULT_VALIDATION_TIMEOUT,
  VALID_TOOL_NAME_PATTERN,
  MAX_TOOL_NAME_LENGTH,
  type GuardedMCPOptions,
  type ToolCallOptions,
  type ToolCallResult,
  type ToolInfo
} from '@blackunicorn/bonklm-mcp';

// --- Factory: createGuardedMCP(client: Client, options?: GuardedMCPOptions) ---
// `client` is the MCP SDK `Client`; capture its type via Parameters<> so the
// suite need not import the SDK directly. `options` is optional (defaults {}).
declare const client: Parameters<typeof createGuardedMCP>[0];
expectType<ReturnType<typeof createGuardedMCP>>(createGuardedMCP(client));
expectType<ReturnType<typeof createGuardedMCP>>(createGuardedMCP(client, {}));
expectType<ReturnType<typeof createGuardedMCP>>(
  createGuardedMCP(client, { validateToolCalls: true, maxArgumentSize: 1024 })
);
expectError(createGuardedMCP()); // client required
expectError(createGuardedMCP(client, { validators: 'nope' })); // wrong option type
expectError(createGuardedMCP(client, { notAnOption: true })); // excess property

// --- GuardedMCPOptions (every field optional) ---
expectAssignable<GuardedMCPOptions>({});
expectAssignable<GuardedMCPOptions>({
  validateToolCalls: true,
  validateToolResults: false,
  allowedTools: ['a', 'b'],
  maxArgumentSize: 2048,
  productionMode: true,
  validationTimeout: 1000,
  onToolCallBlocked: (_result, _toolName) => {},
  onToolResultBlocked: (_result, _toolName) => {}
});
expectNotAssignable<GuardedMCPOptions>({ validateToolCalls: 'yes' }); // boolean field
expectNotAssignable<GuardedMCPOptions>({ allowedTools: 'a' }); // string[] field
expectNotAssignable<GuardedMCPOptions>({ maxArgumentSize: '2048' }); // number field

// --- ToolCallOptions: `name` required, `arguments` optional ---
expectAssignable<ToolCallOptions>({ name: 'search' });
expectAssignable<ToolCallOptions>({ name: 'search', arguments: { q: 1 } });
expectNotAssignable<ToolCallOptions>({}); // name required
expectNotAssignable<ToolCallOptions>({ name: 123 }); // name must be string
expectNotAssignable<ToolCallOptions>({ arguments: {} }); // name required

// --- ToolCallResult: `content` required ---
expectAssignable<ToolCallResult>({ content: [{ type: 'text', text: 'x' }] });
expectAssignable<ToolCallResult>({ content: [], filtered: true, raw: 1 });
expectNotAssignable<ToolCallResult>({}); // content required
expectNotAssignable<ToolCallResult>({ content: 'nope' }); // content must be array

// --- ToolInfo: `name` required ---
expectAssignable<ToolInfo>({ name: 't' });
expectAssignable<ToolInfo>({ name: 't', description: 'd', inputSchema: {} });
expectNotAssignable<ToolInfo>({}); // name required
expectNotAssignable<ToolInfo>({ name: 1 }); // name must be string

// --- Constants: literal vs widened ---
expectType<number>(DEFAULT_MAX_ARGUMENT_SIZE); // `1024 * 100` arithmetic widens to number
expectType<5000>(DEFAULT_VALIDATION_TIMEOUT); // literal preserved
expectType<RegExp>(VALID_TOOL_NAME_PATTERN);
expectType<128>(MAX_TOOL_NAME_LENGTH); // literal preserved

// --- Error classes (re-exported from core connector-utils) ---
const cve = new ConnectorValidationError('msg');
expectType<ConnectorValidationError>(cve);
expectType<string>(cve.category);
expectType<number | undefined>(cve.statusCode);
new ConnectorValidationError('m', 'configuration_error', 400);
expectError(new ConnectorValidationError()); // message required

const sve = new StreamValidationError('msg');
expectType<StreamValidationError>(sve);
expectType<string>(sve.reason);
expectType<boolean>(sve.blocked);
new StreamValidationError('m', 'buffer_exceeded', true);
expectError(new StreamValidationError()); // message required

const cce = new ConnectorConfigurationError('msg');
expectType<ConnectorConfigurationError>(cce);
expectType<string | undefined>(cce.field);
new ConnectorConfigurationError('m', 'apiKey');
expectError(new ConnectorConfigurationError()); // message required

const cte = new ConnectorTimeoutError('msg', 5000);
expectType<ConnectorTimeoutError>(cte);
expectType<number>(cte.timeout);
expectError(new ConnectorTimeoutError('m')); // timeout required
expectError(new ConnectorTimeoutError()); // message + timeout required
