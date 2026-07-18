/**
 * HeyGen self-serve API video pricing. The provider bills API-key usage from
 * a prepaid USD wallet but does not return per-video cost in the video API,
 * so completed-job costs are estimated from output duration.
 *
 * Source: https://developers.heygen.com/docs/pricing
 */

export type HeyGenEngine = "avatar_iv" | "avatar_v";
export type HeyGenAvatarType =
  | "photo_avatar"
  | "digital_twin"
  | "studio_avatar";

export interface HeyGenPriceEntry {
  usdPerSecond: number;
  verifiedAt: string;
}

export const HEYGEN_PRICING: Record<
  HeyGenEngine,
  Partial<Record<HeyGenAvatarType, HeyGenPriceEntry>>
> = {
  avatar_iv: {
    photo_avatar: { usdPerSecond: 0.05, verifiedAt: "2026-07-14" },
    digital_twin: { usdPerSecond: 0.0667, verifiedAt: "2026-07-14" },
    studio_avatar: { usdPerSecond: 0.0667, verifiedAt: "2026-07-14" },
  },
  avatar_v: {
    digital_twin: { usdPerSecond: 0.0667, verifiedAt: "2026-07-14" },
  },
};

export function estimateHeyGenCostUsd(input: {
  engine: HeyGenEngine;
  avatarType?: string;
  durationMs: number;
}): { costUsd: number; usedFallbackPricing: boolean } {
  const knownType =
    input.avatarType === "photo_avatar" ||
    input.avatarType === "digital_twin" ||
    input.avatarType === "studio_avatar"
      ? input.avatarType
      : undefined;
  const exact = knownType ? HEYGEN_PRICING[input.engine][knownType] : undefined;
  // Unknown legacy Avatar IV jobs use the highest current rate rather than
  // understating spend. Avatar V currently has one supported avatar type.
  const rate = exact ?? HEYGEN_PRICING[input.engine].digital_twin;
  return {
    costUsd: (Math.max(0, input.durationMs) / 1000) * rate!.usdPerSecond,
    usedFallbackPricing: exact === undefined,
  };
}
