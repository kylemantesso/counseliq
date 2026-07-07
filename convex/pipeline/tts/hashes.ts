/**
 * Content-hash derivations for TTS invalidation (M5). Web Crypto only, so
 * the whole synthesis stack stays in the default Convex runtime.
 *
 * Two granularities:
 * - sentenceHash keys the cross-run `ttsSentences` cache: an edited sentence
 *   (or a lexicon change affecting it) re-synthesises alone.
 * - unitContentHash marks a unit's audio-relevant inputs: an unchanged unit
 *   is skipped entirely on re-runs of GENERATING_ASSETS.
 *
 * Brand tokens and card-template versions are deliberately NOT hashed here:
 * they do not affect audio or beat times. The M6 render artifact gets its
 * own hash.
 */

import { TIMING_VERSION } from "@counseliq/course-schema";

export async function sha256Hex(
  input: string | ArrayBuffer | Uint8Array
): Promise<string> {
  const bytes =
    typeof input === "string"
      ? new TextEncoder().encode(input)
      : input instanceof Uint8Array
        ? input
        : new Uint8Array(input);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    bytes as unknown as ArrayBuffer
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Cache key for one synthesised sentence (see ttsSentences). */
export async function sentenceHash(input: {
  spokenText: string;
  voiceId: string;
  model: string;
  outputFormat: string;
}): Promise<string> {
  return await sha256Hex(
    `tts:v1|${input.spokenText}|${input.voiceId}|${input.model}|${input.outputFormat}`
  );
}

/** Lexicon entries in key-sorted order so object insertion order never
 *  changes the hash. */
function canonicalLexicon(
  lexicon: Record<string, string>
): Array<[string, string]> {
  return Object.keys(lexicon)
    .sort()
    .map((key) => [key, lexicon[key]]);
}

/**
 * A unit's audio-relevant fingerprint. Matching `microUnits.contentHash`
 * plus an existing timing artifact means GENERATING_ASSETS skips the unit.
 */
export async function unitContentHash(input: {
  speakTexts: string[];
  lexicon: Record<string, string>;
  cards: unknown;
  voiceId: string;
  model: string;
  outputFormat: string;
  gapMs: number;
}): Promise<string> {
  return await sha256Hex(
    JSON.stringify({
      v: 1,
      timingVersion: TIMING_VERSION,
      sentences: input.speakTexts,
      lexicon: canonicalLexicon(input.lexicon),
      cards: input.cards,
      voiceId: input.voiceId,
      model: input.model,
      outputFormat: input.outputFormat,
      interSentenceGapMs: input.gapMs,
    })
  );
}
