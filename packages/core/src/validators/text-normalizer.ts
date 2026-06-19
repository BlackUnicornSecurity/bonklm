/**
 * BonkLM - Shared Text Normalizer
 * ==========================================
 * Single source of truth for text normalization and unicode detection.
 */

import { Severity } from '../base/GuardrailResult.js';

// =============================================================================
// UNICODE NORMALIZATION AND MANIPULATION DETECTION (SEC-002-3)
// =============================================================================

/**
 * Zero-width and invisible characters to strip.
 * Includes direction control characters to prevent bypass attacks.
 */
export const ZERO_WIDTH_CHARS = [
  '\u200b', // Zero-width space
  '\u200c', // Zero-width non-joiner
  '\u200d', // Zero-width joiner
  '\u200e', // Left-to-Right Mark
  '\u200f', // Right-to-Left Mark
  '\u2060', // Word joiner
  '\ufeff', // Zero-width no-break space (BOM)
  '\u00ad', // Soft hyphen
  '\u061c', // Arabic Letter Mark
  '\u180e', // Mongolian vowel separator
  '\u2061', // Function application
  '\u2062', // Invisible times
  '\u2063', // Invisible separator
  '\u2064', // Invisible plus
  '\u206a', // Inhibit Symmetric Swapping
  '\u206b', // Activate Symmetric Swapping
  '\u206c', // National Digit Shapes
  '\u206d', // Nominal Digit Shapes
  '\u206e', // Arabic-Indic Digits
  '\u206f' // Extended Arabic-Indic Digits
];

/**
 * Combining character ranges to strip.
 */
export const COMBINING_MARK_PATTERN = /[\u0300-\u036f\u1ab0-\u1aff\u1dc0-\u1dff\u20d0-\u20ff\ufe20-\ufe2f]/g;

/**
 * Confusable character mapping (lookalikes to ASCII).
 */
export const CONFUSABLE_MAP: Record<string, string> = {
  // Cyrillic lookalikes
  а: 'a',
  е: 'e',
  і: 'i',
  о: 'o',
  р: 'p',
  с: 'c',
  у: 'y',
  х: 'x',
  ѕ: 's',
  ј: 'j',
  ӏ: 'l',
  ԛ: 'q',
  ԝ: 'w',
  А: 'A',
  В: 'B',
  Е: 'E',
  К: 'K',
  М: 'M',
  Н: 'H',
  О: 'O',
  Р: 'P',
  С: 'C',
  Т: 'T',
  Х: 'X',
  Ѕ: 'S',
  Ј: 'J',
  // Greek lookalikes
  Α: 'A',
  Β: 'B',
  Ε: 'E',
  Η: 'H',
  Ι: 'I',
  Κ: 'K',
  Μ: 'M',
  Ν: 'N',
  Ο: 'O',
  Ρ: 'P',
  Τ: 'T',
  Υ: 'Y',
  Χ: 'X',
  Ζ: 'Z',
  ο: 'o',
  ν: 'v',
  // Special characters
  ß: 'ss',
  ø: 'o',
  æ: 'ae',
  œ: 'oe',
  đ: 'd',
  ł: 'l',
  ı: 'i',
  ȷ: 'j',
  ŋ: 'n',
  ſ: 's',
  // Fullwidth
  Ａ: 'A',
  Ｂ: 'B',
  Ｃ: 'C',
  Ｄ: 'D',
  Ｅ: 'E',
  Ｆ: 'F',
  Ｇ: 'G',
  Ｈ: 'H',
  Ｉ: 'I',
  Ｊ: 'J',
  Ｋ: 'K',
  Ｌ: 'L',
  Ｍ: 'M',
  Ｎ: 'N',
  Ｏ: 'O',
  Ｐ: 'P',
  Ｑ: 'Q',
  Ｒ: 'R',
  Ｓ: 'S',
  Ｔ: 'T',
  Ｕ: 'U',
  Ｖ: 'V',
  Ｗ: 'W',
  Ｘ: 'X',
  Ｙ: 'Y',
  Ｚ: 'Z',
  ａ: 'a',
  ｂ: 'b',
  ｃ: 'c',
  ｄ: 'd',
  ｅ: 'e',
  ｆ: 'f',
  ｇ: 'g',
  ｈ: 'h',
  ｉ: 'i',
  ｊ: 'j',
  ｋ: 'k',
  ｌ: 'l',
  ｍ: 'm',
  ｎ: 'n',
  ｏ: 'o',
  ｐ: 'p',
  ｑ: 'q',
  ｒ: 'r',
  ｓ: 's',
  ｔ: 't',
  ｕ: 'u',
  ｖ: 'v',
  ｗ: 'w',
  ｘ: 'x',
  ｙ: 'y',
  ｚ: 'z',
  '１': '1',
  '２': '2',
  '３': '3',
  '４': '4',
  '５': '5',
  '６': '6',
  '７': '7',
  '８': '8',
  '９': '9',
  '０': '0',
  // Modifier letters
  ᴬ: 'A',
  ᴮ: 'B',
  ᴰ: 'D',
  ᴱ: 'E',
  ᴳ: 'G',
  ᴴ: 'H',
  ᵵ: 'I',
  ᴶ: 'J',
  ᴷ: 'K',
  ᴸ: 'L',
  ᴹ: 'M',
  ᴺ: 'N',
  ᴼ: 'O',
  ᴾ: 'P',
  ᴿ: 'R',
  ᵀ: 'T',
  ᵁ: 'U',
  ⱽ: 'V',
  ᵂ: 'W',
  // Latin Letter Small Capitals (IPA / phonetic block) — NFKD does NOT decompose
  // these to ASCII, so an attacker can spell `ɪɢɴᴏʀᴇ ᴀʟʟ ᴘʀᴇᴠɪᴏᴜѕ` and bypass
  // every uppercase pattern unless we fold them here.
  ᴀ: 'a',
  ʙ: 'b',
  ᴄ: 'c',
  ᴅ: 'd',
  ᴇ: 'e',
  ꜰ: 'f',
  ɢ: 'g',
  ʜ: 'h',
  ɪ: 'i',
  ᴊ: 'j',
  ᴋ: 'k',
  ʟ: 'l',
  ᴍ: 'm',
  ɴ: 'n',
  ᴏ: 'o',
  ᴘ: 'p',
  ǫ: 'q',
  ʀ: 'r',
  ꜱ: 's',
  ᴛ: 't',
  ᴜ: 'u',
  ᴠ: 'v',
  ᴡ: 'w',
  ʏ: 'y',
  ᴢ: 'z',
  // Cherokee letters that share glyph with Latin (case-confusable attacks)
  Ꭺ: 'A',
  Ꭱ: 'E',
  Ꭲ: 'T',
  Ꮃ: 'W',
  Ꮤ: 'W',
  Ꮯ: 'C',
  Ꮷ: 'd',
  // Armenian uppercase shapes overlapping Latin
  Ա: 'U',
  Բ: 'F',
  Հ: 'Z',
  Տ: 'S',
  // Mathematical symbols (confusables)
  ℝ: 'R',
  ℤ: 'Z',
  ℚ: 'Q',
  ℕ: 'N',
  ℂ: 'C',
  ℙ: 'P',
  '∞': 'infinity',
  '∂': 'd',
  '∆': 'delta',
  '∑': 'sum',
  '∏': 'product',
  '∫': 'integral',
  '√': 'sqrt',
  '≈': 'approximately',
  '≠': 'not',
  '≤': 'less_or_equal',
  '≥': 'greater_or_equal',
  '→': 'to',
  '⇒': 'implies'
};

/**
 * Additional whitespace and formatting characters to normalize.
 * These exotic whitespace types can be used to evade pattern matching.
 */
export const EVASION_WHITESPACE_CHARS: Array<{ char: string; name: string; codePoint: number }> = [
  { char: '\u000B', name: 'vertical tab', codePoint: 0x000b },
  { char: '\u000C', name: 'form feed', codePoint: 0x000c },
  { char: '\u2028', name: 'line separator', codePoint: 0x2028 },
  { char: '\u2029', name: 'paragraph separator', codePoint: 0x2029 },
  { char: '\u202F', name: 'narrow no-break space', codePoint: 0x202f },
  { char: '\u205F', name: 'medium mathematical space', codePoint: 0x205f },
  { char: '\u3000', name: 'ideographic space', codePoint: 0x3000 }
];

/**
 * Braille Pattern Blank range (U+2800-U+28FF).
 * These invisible Braille characters can be used to hide content.
 */
export const BRAILLE_PATTERN = /[\u2800-\u28FF]/g;

/**
 * Mongolian Free Variation Selectors (U+180B-U+180D).
 */
export const MONGOLIAN_FVS_PATTERN = /[\u180B-\u180D]/g;

/**
 * Unicode Tags block \u2014 Plane 14, U+E0000-U+E007F.
 * This block mirrors ASCII (U+E0020-U+E007E \u2194 0x20-0x7E) but renders to NO glyph, so it is
 * the canonical primitive for *invisible instruction injection*: an attacker smuggles ASCII
 * directives ("ignore prior instructions\u2026") as zero-width tag characters that a human reviewer
 * and most renderers never see, while byte-level LM tokenizers still read them (Goodside, 2024).
 * Uses the `u` flag because these are astral (surrogate-pair) codepoints the per-code-unit loop
 * in `detectHiddenUnicode` cannot see.
 */
export const TAGS_BLOCK_PATTERN = /[\u{E0000}-\u{E007F}]/gu;

/**
 * Well-formed RGI emoji tag sequence \u2014 the ONLY sanctioned modern use of the Tags block:
 * subdivision-flag emoji (\uD83C\uDFF4\uDB40\uDC67\uDB40\uDC62\uDB40\uDC73\uDB40\uDC63\uDB40\uDC74\uDB40\uDC7F Scotland, \uD83C\uDFF4\uDB40\uDC67\uDB40\uDC62\uDB40\uDC77\uDB40\uDC6C\uDB40\uDC73\uDB40\uDC7F Wales, \uD83C\uDFF4\uDB40\uDC67\uDB40\uDC62\uDB40\uDC65\uDB40\uDC6E\uDB40\uDC67\uDB40\uDC7F England). Such a
 * sequence is a U+1F3F4 base + one-or-more tag chars from the subdivision alphabet (tag digits
 * U+E0030-U+E0039, tag lowercase U+E0061-U+E007A) + the U+E007F CANCEL TAG terminator. Stripped
 * before the Tags-block scan so legitimate flags do not register as smuggled instructions.
 */
export const EMOJI_TAG_SEQUENCE_PATTERN = /\u{1F3F4}[\u{E0030}-\u{E0039}\u{E0061}-\u{E007A}]+\u{E007F}/gu;

/**
 * Detect unusual whitespace characters for obfuscation flagging.
 * Returns count of unusual whitespace chars found.
 */
export function detectUnusualWhitespace(text: string): {
  count: number;
  types: string[];
} {
  let count = 0;
  const types: string[] = [];

  for (const ws of EVASION_WHITESPACE_CHARS) {
    const matches = text.split(ws.char).length - 1;
    if (matches > 0) {
      count += matches;
      types.push(ws.name);
    }
  }

  // Check Braille
  const brailleMatches = (text.match(BRAILLE_PATTERN) || []).length;
  if (brailleMatches > 0) {
    count += brailleMatches;
    types.push('braille pattern blank');
  }

  // Check Mongolian FVS
  const mongolianMatches = (text.match(MONGOLIAN_FVS_PATTERN) || []).length;
  if (mongolianMatches > 0) {
    count += mongolianMatches;
    types.push('mongolian free variation selector');
  }

  return { count, types };
}

/**
 * True if the string contains any non-ASCII (>U+007F) character. Used to gate
 * obfuscation-style detections (homoglyph / zero-width / combining-mark) that are
 * meaningless on plain ASCII: whitespace-heavy ASCII (e.g. pretty-printed JSON) also
 * shrinks during normalization but is not obfuscated. Shared by the prompt-injection
 * and jailbreak validators so the two gates cannot drift. Iterates UTF-16 code units,
 * which is correct for a boolean "any non-ASCII" test — each surrogate half is >127.
 */
export function containsNonAscii(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 127) {
      return true;
    }
  }
  return false;
}

/**
 * Normalize text by applying NFKC, stripping hidden chars, and mapping confusables.
 */
export function normalizeText(text: string): string {
  // Step 1: NFKD normalization — DECOMPOSE precomposed characters into
  // base + combining mark so step 3 can strip the mark. NFKC composes
  // them back together, which defeats the combining-mark strip and
  // allows `cŭrl`, `evạl`, `mkfŝ`-style obfuscation bypasses.
  let normalized = text.normalize('NFKD');

  // Step 2: Strip zero-width characters
  for (const char of ZERO_WIDTH_CHARS) {
    normalized = normalized.split(char).join('');
  }

  // Step 3: Strip combining marks (now reachable after NFKD decomposition)
  normalized = normalized.replace(COMBINING_MARK_PATTERN, '');

  // Step 3b: Strip Braille pattern blanks
  normalized = normalized.replace(BRAILLE_PATTERN, '');

  // Step 3c: Strip Mongolian Free Variation Selectors
  normalized = normalized.replace(MONGOLIAN_FVS_PATTERN, '');

  // Step 3d: Normalize evasion whitespace chars to regular space
  for (const ws of EVASION_WHITESPACE_CHARS) {
    normalized = normalized.split(ws.char).join(' ');
  }

  // Step 4: Map confusable characters
  let result = '';
  for (const char of normalized) {
    result += CONFUSABLE_MAP[char] || char;
  }

  // Step 5: Collapse whitespace (includes tabs)
  result = result.replace(/[ \t]+/g, ' ');
  result = result.replace(/\n{3,}/g, '\n\n');

  return result;
}

/**
 * Suspicious unicode ranges.
 * Expanded to include additional direction control characters.
 */
export const SUSPICIOUS_UNICODE_RANGES: Array<[number, number, string]> = [
  [0x200b, 0x200f, 'zero-width'], // Zero-width spaces and direction marks
  [0x202a, 0x202e, 'direction'], // Embedding controls
  [0x2060, 0x2064, 'zero-width'], // Word joiner and invisible operators
  [0x2066, 0x206f, 'direction'], // Isolate controls (expanded range)
  [0xfeff, 0xfeff, 'other'], // Byte order mark (when not at start)
  [0x180e, 0x180e, 'zero-width'], // Mongolian vowel separator
  [0x00ad, 0x00ad, 'zero-width'], // Soft hyphen
  [0x061c, 0x061c, 'direction'] // Arabic Letter Mark
];

/**
 * Unicode manipulation finding.
 */
export interface UnicodeFinding {
  category: string;
  count: number;
  severity: Severity;
  description: string;
  chars: string[];
}

/**
 * Detect hidden or suspicious unicode characters.
 */
export function detectHiddenUnicode(text: string): UnicodeFinding[] {
  const findings: Map<string, UnicodeFinding> = new Map();

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const codePoint = char.codePointAt(0)!;

    // Skip BOM at start of file
    if (i === 0 && codePoint === 0xfeff) {
      continue;
    }

    // Check against suspicious ranges
    for (const [start, end, category] of SUSPICIOUS_UNICODE_RANGES) {
      if (codePoint >= start && codePoint <= end) {
        const key = category;
        const existing = findings.get(key);
        if (existing) {
          existing.count++;
          if (!existing.chars.includes(`U+${codePoint.toString(16).padStart(4, '0').toUpperCase()}`)) {
            existing.chars.push(`U+${codePoint.toString(16).padStart(4, '0').toUpperCase()}`);
          }
        } else {
          findings.set(key, {
            category: 'unicode_manipulation',
            count: 1,
            severity: category === 'zero-width' ? Severity.WARNING : Severity.INFO,
            description: `Hidden ${category} characters detected`,
            chars: [`U+${codePoint.toString(16).padStart(4, '0').toUpperCase()}`]
          });
        }
        break;
      }
    }
  }

  // Upgrade severity based on count
  for (const finding of findings.values()) {
    if (finding.count >= 5) {
      finding.severity = Severity.WARNING;
    }
    if (finding.count >= 10 && finding.category === 'zero-width') {
      finding.severity = Severity.CRITICAL;
    }
  }

  // Plane-14 Tags-block scan. Kept separate from (and AFTER) the per-code-unit loop above:
  // (1) these are astral codepoints the UTF-16-unit loop cannot read, and (2) the count-based
  // re-grading above would otherwise clobber the severity set here. Strip well-formed emoji
  // subdivision-flag sequences first so the one legitimate use of the block is not flagged;
  // any residual tag character is a covert invisible-instruction-injection primitive with no
  // benign plain-text use.
  const residualTags = text.replace(EMOJI_TAG_SEQUENCE_PATTERN, '').match(TAGS_BLOCK_PATTERN);
  if (residualTags && residualTags.length > 0) {
    const chars = Array.from(
      new Set(residualTags.map(c => `U+${c.codePointAt(0)!.toString(16).padStart(4, '0').toUpperCase()}`))
    ).slice(0, 8);
    findings.set('tag_characters', {
      category: 'unicode_manipulation',
      count: residualTags.length,
      // A run (>=2) is an unambiguous smuggled payload → CRITICAL; a lone tag char is anomalous
      // (truncated flag / data corruption) → WARNING. Both block via the PromptInjection path.
      // Intentionally stricter than the zero-width count thresholds above: the Tags block has no
      // benign plain-text use, so even a 2-char run is treated as CRITICAL.
      severity: residualTags.length >= 2 ? Severity.CRITICAL : Severity.WARNING,
      description:
        'Invisible Tags-block characters (Unicode Plane 14, U+E0000-U+E007F) detected - ' +
        'covert instruction-injection primitive',
      chars
    });
  }

  return Array.from(findings.values());
}
