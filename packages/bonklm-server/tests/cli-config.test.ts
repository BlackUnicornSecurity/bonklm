import { describe, expect, it } from 'vitest';
import { readCliConfig } from '../src/bin/config.js';

const SECRET = 's'.repeat(32);
const NON_LOOPBACK_ENV = {
  BONKLM_HMAC_SECRET: SECRET,
  BONKLM_TRUSTED_TLS_TERMINATION: 'true'
};

describe('server CLI configuration', () => {
  it('accepts an explicit development-mode opt-out', () => {
    expect(readCliConfig({ BONKLM_HMAC_SECRET: SECRET, BONKLM_PRODUCTION_MODE: 'false' }).productionMode).toBe(false);
  });

  it('measures the HMAC secret minimum in UTF-8 bytes', () => {
    expect(readCliConfig({ ...NON_LOOPBACK_ENV, BONKLM_HMAC_SECRET: 'é'.repeat(16) }).hmacSecret).toBe('é'.repeat(16));
    expect(() => readCliConfig({ BONKLM_HMAC_SECRET: 'a'.repeat(31) })).toThrow(/32 bytes/);
  });

  it('reads the optional Portkey webhook bearer secret', () => {
    const portkeyWebhookSecret = 'p'.repeat(32);
    const config = readCliConfig({
      BONKLM_HMAC_SECRET: SECRET,
      BONKLM_TRUSTED_TLS_TERMINATION: 'true',
      BONKLM_PORTKEY_WEBHOOK_SECRET: portkeyWebhookSecret
    });

    expect(config.portkeyWebhookSecret).toBe(portkeyWebhookSecret);
  });

  it('rejects a short Portkey webhook bearer secret', () => {
    expect(() =>
      readCliConfig({
        BONKLM_HMAC_SECRET: SECRET,
        BONKLM_TRUSTED_TLS_TERMINATION: 'true',
        BONKLM_PORTKEY_WEBHOOK_SECRET: 'short'
      })
    ).toThrow(/BONKLM_PORTKEY_WEBHOOK_SECRET.*32/);
  });

  it.each(['treu', 'true ', 'TRUE', ''])('rejects an invalid production-mode value %j', value => {
    expect(() =>
      readCliConfig({
        BONKLM_HMAC_SECRET: SECRET,
        BONKLM_TRUSTED_TLS_TERMINATION: 'true',
        BONKLM_PRODUCTION_MODE: value
      })
    ).toThrow(/BONKLM_PRODUCTION_MODE.*true.*false/);
  });

  it.each(['4123x', ' 4123', '0', '-1', '65536', ''])('rejects an invalid port value %j', value => {
    expect(() =>
      readCliConfig({
        BONKLM_HMAC_SECRET: SECRET,
        BONKLM_TRUSTED_TLS_TERMINATION: 'true',
        BONKLM_PORT: value
      })
    ).toThrow(/BONKLM_PORT.*integer.*1.*65535/);
  });

  it.each(['300000x', ' 300000', '0', '-1', '86400001', ''])('rejects an invalid replay window %j', value => {
    expect(() =>
      readCliConfig({
        BONKLM_HMAC_SECRET: SECRET,
        BONKLM_TRUSTED_TLS_TERMINATION: 'true',
        BONKLM_REPLAY_WINDOW_MS: value
      })
    ).toThrow(/BONKLM_REPLAY_WINDOW_MS.*integer.*1.*86400000/);
  });

  it('requires trusted TLS termination for production non-loopback binding', () => {
    expect(() => readCliConfig({ BONKLM_HMAC_SECRET: SECRET })).toThrow(/BONKLM_TRUSTED_TLS_TERMINATION.*non-loopback/);
    expect(readCliConfig(NON_LOOPBACK_ENV).trustedTlsTermination).toBe(true);
  });

  it.each(['127.0.0.1', '::1', 'localhost'])('allows production loopback binding at %s', host => {
    expect(readCliConfig({ BONKLM_HMAC_SECRET: SECRET, BONKLM_HOST: host }).host).toBe(host);
  });

  it.each(['TRUE', 'false ', '1', ''])('rejects an invalid trusted TLS termination value %j', value => {
    expect(() =>
      readCliConfig({
        BONKLM_HMAC_SECRET: SECRET,
        BONKLM_TRUSTED_TLS_TERMINATION: value
      })
    ).toThrow(/BONKLM_TRUSTED_TLS_TERMINATION.*true.*false/);
  });
});
