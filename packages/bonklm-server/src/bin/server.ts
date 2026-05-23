#!/usr/bin/env node
/**
 * `bonklm-server` CLI entrypoint.
 *
 * Reads configuration from environment variables:
 *
 *   - `BONKLM_PORT`        (default 4123)
 *   - `BONKLM_HOST`        (default '0.0.0.0')
 *   - `BONKLM_HMAC_SECRET` (REQUIRED — 32+ char shared secret)
 *   - `BONKLM_REPLAY_WINDOW_MS` (default 300000 = 5 min)
 *   - `BONKLM_PRODUCTION_MODE` (default 'false')
 *
 * Constructs a default validator stack of:
 *   - PromptInjectionValidator
 *   - MultilingualDetector
 *   - SecretGuard (if available)
 *
 * For custom validator wiring, import `createBonklmGuardrailServer`
 * from `@blackunicorn/bonklm-server` directly in your own
 * server.ts.
 */
import {
  PromptInjectionValidator,
  MultilingualDetector,
} from '@blackunicorn/bonklm';
import { createBonklmGuardrailServer } from '../index.js';

async function main(): Promise<void> {
  const port = Number.parseInt(process.env.BONKLM_PORT ?? '4123', 10);
  const host = process.env.BONKLM_HOST ?? '0.0.0.0';
  const hmacSecret = process.env.BONKLM_HMAC_SECRET;
  const replayWindowMs = process.env.BONKLM_REPLAY_WINDOW_MS
    ? Number.parseInt(process.env.BONKLM_REPLAY_WINDOW_MS, 10)
    : undefined;
  // sec v5#13 closure (v0.5.0 pre-publish audit): CLI default flipped
  // to `true` to match the programmatic API default. Operators MUST
  // explicitly opt OUT for dev/debugging via
  // `BONKLM_PRODUCTION_MODE=false`. Default-safe matches Dockerfile
  // posture + closes the "production by deploy default, debug by API
  // default" drift.
  const productionMode =
    (process.env.BONKLM_PRODUCTION_MODE ?? 'true').toLowerCase() === 'true';

  if (hmacSecret === undefined || hmacSecret.length < 32) {
    // eslint-disable-next-line no-console
    console.error(
      'bonklm-server: BONKLM_HMAC_SECRET env var REQUIRED and MUST be >= 32 characters.\n' +
        'Generate via: openssl rand -base64 32'
    );
    process.exit(1);
  }

  const server = await createBonklmGuardrailServer({
    validators: [
      new PromptInjectionValidator(),
      new MultilingualDetector(),
    ],
    hmacSecret,
    replayWindowMs,
    productionMode,
  });

  try {
    await server.listen({ port, host });
    // eslint-disable-next-line no-console
    console.log(`bonklm-server listening on http://${host}:${port}`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('bonklm-server: failed to start', err);
    process.exit(1);
  }

  // Graceful shutdown.
  const close = async (signal: string): Promise<void> => {
    // eslint-disable-next-line no-console
    console.log(`bonklm-server: ${signal} received, shutting down`);
    await server.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void close('SIGTERM'));
  process.on('SIGINT', () => void close('SIGINT'));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('bonklm-server: unhandled error', err);
  process.exit(1);
});
