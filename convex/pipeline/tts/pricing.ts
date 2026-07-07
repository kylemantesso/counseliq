/**
 * TTS price sheet for cost estimation. Unlike `llmCalls` (provider-reported
 * cost from OpenRouter), ElevenLabs returns NO per-request cost — every
 * `ttsCalls.costUsd` is an ESTIMATE derived from this sheet at record time.
 *
 * Rates are the ElevenLabs Creator-tier effective USD per 1k characters
 * (subscription characters ÷ subscription price): multilingual v2 bills
 * 1 credit/char, flash v2.5 bills 0.5 credit/char. The operator should
 * re-verify against their actual tier and update `verifiedAt`.
 */

export interface TtsPriceEntry {
  usdPer1kChars: number;
  /** When a human last checked this rate against the provider's pricing. */
  verifiedAt: string;
}

export const TTS_PRICING: Record<string, TtsPriceEntry> = {
  "eleven_multilingual_v2": { usdPer1kChars: 0.1, verifiedAt: "2026-07-07" },
  "eleven_flash_v2_5": { usdPer1kChars: 0.05, verifiedAt: "2026-07-07" },
  "eleven_turbo_v2_5": { usdPer1kChars: 0.05, verifiedAt: "2026-07-07" },
  /** The mock provider is free; a zero rate keeps cost math exercised. */
  "mock-tts-1": { usdPer1kChars: 0, verifiedAt: "2026-07-07" },
};

/** Estimated USD for a synthesis call; null when the model has no entry. */
export function estimateTtsCostUsd(input: {
  model: string;
  characters: number;
}): number | null {
  const entry = TTS_PRICING[input.model];
  if (!entry) return null;
  return (input.characters / 1000) * entry.usdPer1kChars;
}
