/**
 * BonkLM - Encoding Decoders
 * ==========================
 * Pure, side-effect-free decoders for the EncodedRescanValidator decode-then-rescan
 * layer. Each decoder turns an obfuscated payload back into candidate plaintext so
 * the existing pattern/jailbreak detectors can re-scan it.
 *
 * Two classes of decoder, distinguished by `structural`:
 *   - STRUCTURAL transports (unicode-escape, html-entity, percent/url, base64,
 *     base32, hex): only produce output when a literal encoding marker is present
 *     (escapes, entities, %-sequences, long valid blobs). Their presence is
 *     unambiguous evidence of intentional encoding, so the validator may act on a
 *     WARNING-level decoded finding.
 *   - SPECULATIVE ciphers (rot13, rot47, reverse, leetspeak): every string
 *     "decodes" to something, so the output is only trustworthy when the decoded
 *     text yields a CRITICAL injection signal (enforced by the validator).
 *
 * All extraction regexes use bounded, non-nested quantifiers (ReDoS-safe). Portable
 * base64/hex decoding is delegated to `edge-codec` so the layer runs unchanged on
 * Node and every edge runtime.
 *
 * @package @blackunicorn/bonklm/common
 */

import { base64DecodeToUtf8, hexDecodeToUtf8 } from './edge-codec.js';

/** A single candidate decoding with provenance. */
export interface DecodeCandidate {
  /** Stable identifier for the decoder, e.g. `unicode_escape`, `rot13`. */
  method: string;
  /** The decoded text to re-scan. */
  text: string;
  /** True for marker-driven transports (may act on WARNING); false for speculative ciphers. */
  structural: boolean;
}

/** Max input length we will attempt to decode (perf guard; larger inputs are left to other validators). */
export const MAX_DECODE_INPUT = 100_000;
/** Max number of blob runs (base64/base32/hex) processed per decoder (DoS guard). */
const MAX_BLOB_RUNS = 64;
/** Minimum printable ratio for a decoded blob to be considered real text (mirrors prompt-injection.ts). */
const MIN_PRINTABLE_RATIO = 0.8;
/** Default maximum multi-layer decode depth. */
export const DEFAULT_MAX_DECODE_DEPTH = 3;

function printableRatio(s: string): number {
  if (s.length === 0) return 0;
  let printable = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 9 || c === 10 || c === 13 || (c >= 32 && c < 127) || c > 160) printable++;
  }
  return printable / s.length;
}

/**
 * Run a decoder, swallowing any throw into a null (no-decode) result. Every decoder
 * already catches its own throws, so the catch here is a belt-and-braces guard that
 * keeps a future decoder's bug from crashing the whole validation pipeline.
 */
function safeDecode(fn: (c: string) => string | null, input: string): string | null {
  try {
    return fn(input);
  } catch {
    return null;
  }
}

// ── Structural transports ──────────────────────────────────────────────────

/** Replace `\u{XXXXX}`, `\uXXXX`, and `\xHH` escapes anywhere in the text. */
export function decodeUnicodeEscapes(content: string): string | null {
  if (!/\\u|\\x/.test(content)) return null;
  const decoded = content
    .replace(/\\u\{([0-9a-fA-F]{1,6})\}/g, (m, h) => {
      try {
        return String.fromCodePoint(parseInt(h, 16));
      } catch {
        return m;
      }
    })
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  return decoded === content ? null : decoded;
}

/** Decode numeric HTML entities (`&#NNN;`, `&#xHH;`). Named entities are intentionally not decoded. */
export function decodeHtmlEntities(content: string): string | null {
  if (!/&#x?[0-9a-fA-F]+;/.test(content)) return null;
  const decoded = content
    .replace(/&#x([0-9a-fA-F]+);/gi, (m, h) => {
      try {
        return String.fromCodePoint(parseInt(h, 16));
      } catch {
        return m;
      }
    })
    .replace(/&#(\d+);/g, (m, d) => {
      try {
        return String.fromCodePoint(parseInt(d, 10));
      } catch {
        return m;
      }
    });
  return decoded === content ? null : decoded;
}

/** Decode percent/URL encoding (`%XX`). */
export function decodePercent(content: string): string | null {
  if (!/%[0-9a-fA-F]{2}/.test(content)) return null;
  try {
    // Neutralise stray `%` not part of a valid escape so decodeURIComponent does not throw.
    const decoded = decodeURIComponent(content.replace(/%(?![0-9a-fA-F]{2})/g, '%25'));
    return decoded === content ? null : decoded;
  } catch {
    const decoded = content.replace(/%([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
    return decoded === content ? null : decoded;
  }
}

/** Extract and decode base64 blobs (>=16 chars), concatenating any printable results. */
export function decodeBase64Blobs(content: string): string | null {
  const runs = content.match(/[A-Za-z0-9+/]{16,}={0,2}/g);
  if (!runs) return null;
  let out = '';
  for (const run of runs.slice(0, MAX_BLOB_RUNS)) {
    if (out.length > MAX_DECODE_INPUT) break;
    if (run.length % 4 !== 0 && !run.includes('=')) continue;
    const decoded = base64DecodeToUtf8(run);
    if (decoded && decoded !== run && printableRatio(decoded) >= MIN_PRINTABLE_RATIO) out += `\n${decoded}`;
  }
  return out || null;
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Extract and decode base32 blobs (RFC 4648 alphabet, >=16 chars). */
export function decodeBase32Blobs(content: string): string | null {
  const runs = content.match(/[A-Z2-7]{16,}={0,6}/g);
  if (!runs) return null;
  let out = '';
  for (const run of runs.slice(0, MAX_BLOB_RUNS)) {
    if (out.length > MAX_DECODE_INPUT) break;
    const clean = run.replace(/=+$/, '');
    // Every char is in the alphabet by construction (the run regex is `[A-Z2-7]`).
    let bits = '';
    for (const ch of clean) bits += BASE32_ALPHABET.indexOf(ch).toString(2).padStart(5, '0');
    let decoded = '';
    for (let i = 0; i + 8 <= bits.length; i += 8) decoded += String.fromCharCode(parseInt(bits.slice(i, i + 8), 2));
    if (decoded && printableRatio(decoded) >= MIN_PRINTABLE_RATIO) out += `\n${decoded}`;
  }
  return out || null;
}

/** Extract and decode hex blobs (>=16 hex digits, optional separators), concatenating printable results. */
export function decodeHexBlobs(content: string): string | null {
  const runs = (content.match(/(?:[0-9a-fA-F]{2}[\s:,-]?){8,}/g) || []).map(r => r.replace(/[\s:,-]/g, ''));
  if (runs.length === 0) return null;
  let out = '';
  for (const run of runs.slice(0, MAX_BLOB_RUNS)) {
    if (out.length > MAX_DECODE_INPUT) break;
    if (run.length % 2 !== 0 || run.length < 16) continue;
    const decoded = hexDecodeToUtf8(run);
    if (decoded && printableRatio(decoded) >= MIN_PRINTABLE_RATIO) out += `\n${decoded}`;
  }
  return out || null;
}

// ── Speculative ciphers ────────────────────────────────────────────────────

/** ROT13 letter rotation. */
export function rot13(content: string): string | null {
  const decoded = content.replace(/[a-zA-Z]/g, c => {
    const base = c <= 'Z' ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
  });
  return decoded === content ? null : decoded;
}

/** ROT47 printable-ASCII rotation. */
export function rot47(content: string): string | null {
  const decoded = content.replace(/[!-~]/g, c => String.fromCharCode(((c.charCodeAt(0) - 33 + 47) % 94) + 33));
  return decoded === content ? null : decoded;
}

/** Whole-string reversal. */
export function reverseText(content: string): string | null {
  if (content.length < 8) return null;
  return [...content].reverse().join('');
}

const LEET_MAP: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '@': 'a',
  $: 's'
};

/** Leetspeak substitution (digit/symbol → letter). */
export function deLeet(content: string): string | null {
  if (!/[013457@$]/.test(content)) return null;
  const decoded = content.replace(/[013457@$]/g, c => LEET_MAP[c] ?? c);
  return decoded === content ? null : decoded;
}

// ── Aggregation ────────────────────────────────────────────────────────────

const STRUCTURAL_DECODERS: Array<{ method: string; fn: (c: string) => string | null }> = [
  { method: 'unicode_escape', fn: decodeUnicodeEscapes },
  { method: 'html_entity', fn: decodeHtmlEntities },
  { method: 'percent_url', fn: decodePercent },
  { method: 'base64', fn: decodeBase64Blobs },
  { method: 'base32', fn: decodeBase32Blobs },
  { method: 'hex', fn: decodeHexBlobs }
];

const CIPHER_DECODERS: Array<{ method: string; fn: (c: string) => string | null }> = [
  { method: 'rot13', fn: rot13 },
  { method: 'rot47', fn: rot47 },
  { method: 'reverse', fn: reverseText },
  { method: 'leetspeak', fn: deLeet }
];

/**
 * Produce every single-pass decode candidate for `content`, tagged structural/speculative.
 * Returns an empty array for empty or over-length input.
 */
export function decodeCandidates(content: string): DecodeCandidate[] {
  if (!content || content.length > MAX_DECODE_INPUT) return [];
  const candidates: DecodeCandidate[] = [];
  for (const { method, fn } of STRUCTURAL_DECODERS) {
    const decoded = safeDecode(fn, content);
    if (decoded && decoded !== content) candidates.push({ method, text: decoded, structural: true });
  }
  for (const { method, fn } of CIPHER_DECODERS) {
    const decoded = safeDecode(fn, content);
    if (decoded && decoded !== content) candidates.push({ method, text: decoded, structural: false });
  }
  return candidates;
}

/**
 * Iteratively decode chained encodings (e.g. base64-then-rot13), re-scanning each layer.
 * Returns the intermediate decoded strings (excluding the original). Chained output is always
 * treated as speculative (the validator requires a CRITICAL signal) because a cipher step can
 * appear anywhere in the chain. Loop-guarded and depth-bounded.
 */
export function multiLayerDecode(content: string, maxDepth: number = DEFAULT_MAX_DECODE_DEPTH): string[] {
  if (!content || content.length > MAX_DECODE_INPUT) return [];
  // Apply exactly ONE decoder per layer (first that makes progress) so a chain unwinds correctly:
  // structural transports are tried FIRST every layer so a speculative cipher (which "succeeds" on any
  // text) cannot clobber a still-encoded intermediate before the next structural pass can decode it
  // (e.g. base64-of-base64 would otherwise be rot13'd into garbage between layers).
  const structural = [
    decodeUnicodeEscapes,
    decodeHtmlEntities,
    decodePercent,
    decodeBase64Blobs,
    decodeBase32Blobs,
    decodeHexBlobs
  ];
  // Only the self-inverse / order-stable ciphers join the chain. ROT47 and leetspeak are
  // single-pass-only (decodeCandidates) — chaining them is lossy/ambiguous and adds no real coverage.
  const ciphers = [rot13, reverseText];
  const out: string[] = [];
  const seen = new Set<string>([content]);
  let current = content;
  for (let depth = 0; depth < maxDepth; depth++) {
    let next: string | null = null;
    for (const fn of [...structural, ...ciphers]) {
      const decoded = safeDecode(fn, current);
      if (decoded && decoded !== current && decoded.length <= MAX_DECODE_INPUT && !seen.has(decoded)) {
        next = decoded;
        break;
      }
    }
    if (next === null) break;
    seen.add(next);
    out.push(next);
    current = next;
  }
  return out;
}
