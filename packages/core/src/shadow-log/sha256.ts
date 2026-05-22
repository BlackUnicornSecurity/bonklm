/**
 * Story 1.3b — Portable sha256 (edge-safe)
 * =========================================
 *
 * Uses Web Crypto API (`crypto.subtle.digest`) which works on Node
 * ≥18, Workerd, Deno, Bun, and edge-light runtimes. Returns the
 * hex-encoded 64-char digest.
 *
 * @package @blackunicorn/bonklm (internal)
 */

/**
 * Compute sha256 of a UTF-8 string and return the hex-encoded digest.
 *
 * Async — uses Web Crypto's `subtle.digest`. The shadow log's `append`
 * is async, so the cost is in the natural async path.
 *
 * @internal Used by the shadow log to compute `contentHash` and
 * `prevEntryHash` chain links.
 */
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  // `globalThis.crypto.subtle.digest` is available on Node ≥18,
  // Workerd, Deno, Bun, edge-light.
  const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', data);
  return bufferToHex(new Uint8Array(hashBuffer));
}

/**
 * Convert a Uint8Array to a hex string. Portable — no `Buffer`.
 */
function bufferToHex(bytes: Uint8Array): string {
  const out = new Array<string>(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    out[i] = bytes[i].toString(16).padStart(2, '0');
  }
  return out.join('');
}
