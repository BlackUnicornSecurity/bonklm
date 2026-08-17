import { MAX_REPLAY_WINDOW_MS, MAX_REPLAY_CACHE_SIZE } from '../hmac/index.js';

export interface CliConfig {
  readonly port: number;
  readonly host: string;
  readonly hmacSecret: string;
  readonly portkeyWebhookSecret: string | undefined;
  readonly replayWindowMs: number | undefined;
  readonly replayCacheSize: number | undefined;
  readonly productionMode: boolean;
  readonly trustedTlsTermination: boolean;
}

function parseBoolean(name: string, value: string | undefined, defaultValue: boolean): boolean {
  const configured = value ?? String(defaultValue);
  if (configured === 'true') return true;
  if (configured === 'false') return false;
  throw new Error(`${name} must be exactly "true" or "false"`);
}

function isLoopbackHost(host: string): boolean {
  return ['127.0.0.1', '::1', '0:0:0:0:0:0:0:1', 'localhost'].includes(host.toLowerCase());
}

function parseBoundedInteger(name: string, value: string, minimum: number, maximum: number): number {
  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function parsePortkeySecret(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (value.length < 32) {
    throw new Error('BONKLM_PORTKEY_WEBHOOK_SECRET must contain at least 32 characters');
  }
  return value;
}

export function readCliConfig(environment: NodeJS.ProcessEnv): CliConfig {
  const hmacSecret = environment.BONKLM_HMAC_SECRET;
  if (hmacSecret === undefined || Buffer.byteLength(hmacSecret, 'utf8') < 32) {
    throw new Error(
      'BONKLM_HMAC_SECRET is required and must contain at least 32 bytes. Generate one with openssl rand -base64 32.'
    );
  }
  const host = environment.BONKLM_HOST ?? '0.0.0.0';
  const productionMode = parseBoolean('BONKLM_PRODUCTION_MODE', environment.BONKLM_PRODUCTION_MODE, true);
  const trustedTlsTermination = parseBoolean(
    'BONKLM_TRUSTED_TLS_TERMINATION',
    environment.BONKLM_TRUSTED_TLS_TERMINATION,
    false
  );
  if (productionMode && !isLoopbackHost(host) && !trustedTlsTermination) {
    throw new Error('BONKLM_TRUSTED_TLS_TERMINATION must be true for production non-loopback binding');
  }

  return {
    port: parseBoundedInteger('BONKLM_PORT', environment.BONKLM_PORT ?? '4123', 1, 65_535),
    host,
    hmacSecret,
    portkeyWebhookSecret: parsePortkeySecret(environment.BONKLM_PORTKEY_WEBHOOK_SECRET),
    replayWindowMs:
      environment.BONKLM_REPLAY_WINDOW_MS === undefined
        ? undefined
        : parseBoundedInteger('BONKLM_REPLAY_WINDOW_MS', environment.BONKLM_REPLAY_WINDOW_MS, 1, MAX_REPLAY_WINDOW_MS),
    replayCacheSize:
      environment.BONKLM_REPLAY_CACHE_SIZE === undefined
        ? undefined
        : parseBoundedInteger(
            'BONKLM_REPLAY_CACHE_SIZE',
            environment.BONKLM_REPLAY_CACHE_SIZE,
            1,
            MAX_REPLAY_CACHE_SIZE
          ),
    productionMode,
    trustedTlsTermination
  };
}
