#!/usr/bin/env node
/**
 * `bonklm-server` CLI entrypoint.
 *
 * Reads configuration from environment variables:
 *
 *   - `BONKLM_PORT`        (default 4123)
 *   - `BONKLM_HOST`        (default '0.0.0.0')
 *   - `BONKLM_HMAC_SECRET` (REQUIRED — 32+ char shared secret)
 *   - `BONKLM_PORTKEY_WEBHOOK_SECRET` (optional — enables Portkey bearer auth)
 *   - `BONKLM_REPLAY_WINDOW_MS` (default 300000 = 5 min)
 *   - `BONKLM_REPLAY_CACHE_SIZE` (default 100000; size to window × peak accepted rps — at capacity the server fails closed with 503)
 *   - `BONKLM_PRODUCTION_MODE` (default 'true'; set 'false' only for development)
 *   - `BONKLM_TRUSTED_TLS_TERMINATION` (required for production non-loopback binding)
 *
 * Constructs a default validator stack of:
 *   - PromptInjectionValidator
 *   - JailbreakValidator
 *   - CodeInjectionValidator
 *   - MultilingualDetector
 *   - EncodedRescanValidator
 *   - IndirectInjectionValidator
 * plus a SecretGuard guard.
 *
 * For custom validator wiring, import `createBonklmGuardrailServer`
 * from `@blackunicorn/bonklm-server` directly in your own
 * server.ts.
 */
import {
  CodeInjectionValidator,
  EncodedRescanValidator,
  IndirectInjectionValidator,
  JailbreakValidator,
  MultilingualDetector,
  PromptInjectionValidator,
  SecretGuard
} from '@blackunicorn/bonklm';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBonklmGuardrailServer } from '../index.js';
import { readCliConfig } from './config.js';
import { formatCliError, formatListenMessage } from './logging.js';

type Server = Awaited<ReturnType<typeof createBonklmGuardrailServer>>;
type ServerOptions = Parameters<typeof createBonklmGuardrailServer>[0];

interface MainOptions {
  readonly createServer?: typeof createBonklmGuardrailServer;
  readonly env?: NodeJS.ProcessEnv;
  readonly error?: (...values: unknown[]) => void;
  readonly exit?: (code: number) => unknown;
  readonly log?: (...values: unknown[]) => void;
  readonly makeValidators?: () => ServerOptions['validators'];
  readonly makeGuards?: () => ServerOptions['guards'];
  readonly on?: (signal: NodeJS.Signals, handler: () => void) => unknown;
}

export function makeDefaultValidators(): NonNullable<ServerOptions['validators']> {
  return [
    new PromptInjectionValidator(),
    new JailbreakValidator(),
    new CodeInjectionValidator(),
    new MultilingualDetector(),
    new EncodedRescanValidator(),
    new IndirectInjectionValidator()
  ];
}

export function makeDefaultGuards(): NonNullable<ServerOptions['guards']> {
  return [new SecretGuard()];
}

export async function main(options?: MainOptions): Promise<Server | null> {
  const { createServer, env, error, exit, log, makeValidators, makeGuards, on } = Object.assign(
    {
      createServer: createBonklmGuardrailServer,
      env: process.env,
      error: console.error,
      exit: process.exit,
      log: console.log,
      makeValidators: makeDefaultValidators,
      makeGuards: makeDefaultGuards,
      on: process.on.bind(process)
    },
    options
  );
  const { port, host, hmacSecret, portkeyWebhookSecret, replayWindowMs, replayCacheSize, productionMode } =
    readCliConfig(env);

  const server = await createServer({
    validators: makeValidators(),
    guards: makeGuards(),
    hmacSecret,
    portkeyWebhookSecret,
    replayWindowMs,
    ...(replayCacheSize !== undefined ? { replayCacheSize } : {}),
    productionMode
  });

  try {
    await server.listen({ port, host });
    log(formatListenMessage(host, port));
  } catch (err) {
    error('bonklm-server: failed to start', formatCliError(err));
    exit(1);
    return null;
  }

  // Graceful shutdown.
  const close = async (signal: string): Promise<void> => {
    log(`bonklm-server: ${signal} received, shutting down`);
    await server.close();
    exit(0);
  };
  on('SIGTERM', () => void close('SIGTERM'));
  on('SIGINT', () => void close('SIGINT'));
  return server;
}

export async function runCli(options?: {
  readonly argv1?: string;
  readonly error?: (...values: unknown[]) => void;
  readonly exit?: (code: number) => unknown;
  readonly run?: () => Promise<unknown>;
  readonly scriptPath?: string;
}): Promise<boolean> {
  const { argv1, error, exit, run, scriptPath } = Object.assign(
    {
      argv1: process.argv[1],
      error: console.error,
      exit: process.exit,
      run: main,
      scriptPath: fileURLToPath(import.meta.url)
    },
    options
  );
  if (!argv1 || resolve(argv1) !== scriptPath) return false;
  try {
    await run();
  } catch (err) {
    error('bonklm-server: unhandled error', formatCliError(err));
    exit(1);
  }
  return true;
}

void runCli();
