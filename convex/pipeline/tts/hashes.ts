/**
 * Content-hash derivations for TTS invalidation (M5). Web Crypto only, so
 * the whole synthesis stack stays in the default Convex runtime.
 *
 * unitContentHash marks a unit's audio-relevant inputs: an unchanged unit is
 * skipped entirely on re-runs of GENERATING_ASSETS.
 *
 * Brand tokens and card-template versions are deliberately NOT hashed here:
 * they do not affect audio or beat times. Visual-only card props (assetRef /
 * imageRef) are stripped for the same reason — swapping which cleared asset
 * fills a frame (gate-2 asset swap) must never force re-synthesis. A future
 * render artifact gets its own hash.
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

/** Lexicon entries in key-sorted order so object insertion order never
 *  changes the hash. */
function canonicalLexicon(
  lexicon: Record<string, string>
): Array<[string, string]> {
  return Object.keys(lexicon)
    .sort()
    .map((key) => [key, lexicon[key]]);
}

/** Card props that never affect audio or beat times. */
const VISUAL_ONLY_PROPS: readonly string[] = ["assetRef", "imageRef"];

/**
 * Cards with visual-only props stripped — the shape that participates in
 * `unitContentHash`. Everything else (templates, text props, enterAt order)
 * stays: it feeds beat resolution or authored content.
 */
export function sanitizeCardsForAudioHash(cards: unknown): unknown {
  if (!Array.isArray(cards)) return cards;
  return cards.map((card) => {
    if (card === null || typeof card !== "object" || Array.isArray(card)) {
      return card;
    }
    const { props, ...rest } = card as Record<string, unknown>;
    if (props === null || typeof props !== "object" || Array.isArray(props)) {
      return card;
    }
    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(props)) {
      if (VISUAL_ONLY_PROPS.includes(key)) continue;
      cleaned[key] = value;
    }
    return { ...rest, props: cleaned };
  });
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
  voiceAccent?: string | null;
  voiceSettings?: {
    stability?: number;
    similarityBoost?: number;
    style?: number;
    speakerBoost?: boolean;
    speed?: number;
  } | null;
  model: string;
  outputFormat: string;
}): Promise<string> {
  return await sha256Hex(
    JSON.stringify({
      v: 3,
      timingVersion: TIMING_VERSION,
      sentences: input.speakTexts,
      lexicon: canonicalLexicon(input.lexicon),
      cards: sanitizeCardsForAudioHash(input.cards),
      voiceId: input.voiceId,
      voiceAccent: input.voiceAccent ?? null,
      voiceSettings: input.voiceSettings ?? null,
      model: input.model,
      outputFormat: input.outputFormat,
    })
  );
}
