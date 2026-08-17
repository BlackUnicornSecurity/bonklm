/**
 * Edge-Runtime Portable Codecs
 * ========================================
 * Edge-safe replacements for `Buffer.from(...)` / `Buffer.byteLength`
 * calls that BonkLM's pattern engine previously used. Workerd /
 * Deno / Bun all ship Web Standard `atob` + `TextEncoder` /
 * `TextDecoder` but NOT Node's `Buffer`.
 *
 * These helpers are pure-portable JS and work identically on Node
 * (LTS >=20) and every edge runtime in the `exports['./edge']` map
 * (`workerd` / `deno` / `bun`).
 *
 * @package @blackunicorn/bonklm/common
 */

/**
 * Decode a base64 string into a UTF-8 string. Returns the empty
 * string if the input is not valid base64.
 *
 * Node + Workerd + Deno + Bun all expose `atob` per Web Standards.
 * The Node fallback to `Buffer.from(..., 'base64')` is intentionally
 * NOT used so the same code path runs on every runtime.
 */
export function base64DecodeToUtf8(input: string): string {
  try {
    const binary = atob(input);
    // `atob` produces a binary string (one char per byte, latin-1).
    // Convert to a Uint8Array then decode as UTF-8 via TextDecoder.
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch {
    return '';
  }
}

/**
 * Decode a hex string into a UTF-8 string. Returns the empty string
 * if the input is not valid hex.
 *
 * Web Standards do not ship a built-in `hexDecode`; this is a
 * lightweight portable implementation.
 */
export function hexDecodeToUtf8(input: string): string {
  if (input.length === 0 || input.length % 2 !== 0) return '';
  if (!/^[0-9A-Fa-f]+$/.test(input)) return '';
  try {
    const bytes = new Uint8Array(input.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(input.slice(i * 2, i * 2 + 2), 16);
    }
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch {
    return '';
  }
}

/**
 * UTF-8 byte length of a string. Portable replacement for
 * `Buffer.byteLength(s, 'utf-8')`. Uses `TextEncoder.encode(s)`
 * which is available on every runtime.
 */
export function utf8ByteLength(input: string): number {
  return new TextEncoder().encode(input).byteLength;
}

/**
 * Cryptographically-strong random UUID v4. Portable replacement
 * for `node:crypto`'s `randomUUID()`. `globalThis.crypto.randomUUID`
 * is available on Node >=19, Workerd, Deno, and Bun.
 *
 * Falls back to a Math.random-based UUID v4 ONLY if no platform
 * `crypto.randomUUID` is available — this fallback is documented as
 * NOT cryptographically-strong, and is intended only for
 * non-security-critical execution-id labelling in `HookSandbox`.
 */
export function portableRandomUUID(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c && typeof c.randomUUID === 'function') {
    return c.randomUUID();
  }
  // Non-crypto-strong fallback. Used only when the runtime has no
  // Web Crypto interface — practically never on the runtimes we
  // support (Node >=20, Workerd, Deno, Bun all ship Web Crypto).
  const hex = '0123456789abcdef';
  let out = '';
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) {
      out += '-';
    } else if (i === 14) {
      out += '4';
    } else if (i === 19) {
      out += hex[8 + Math.floor(Math.random() * 4)];
    } else {
      out += hex[Math.floor(Math.random() * 16)];
    }
  }
  return out;
}
