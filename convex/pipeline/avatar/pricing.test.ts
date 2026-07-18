import { describe, expect, test } from "vitest";
import { estimateHeyGenCostUsd, HEYGEN_PRICING } from "./pricing";

describe("estimateHeyGenCostUsd", () => {
  test("uses Avatar IV photo-avatar pricing", () => {
    expect(
      estimateHeyGenCostUsd({
        engine: "avatar_iv",
        avatarType: "photo_avatar",
        durationMs: 10_000,
      })
    ).toEqual({ costUsd: 0.5, usedFallbackPricing: false });
  });

  test("uses Avatar V digital-twin pricing", () => {
    const estimate = estimateHeyGenCostUsd({
      engine: "avatar_v",
      avatarType: "digital_twin",
      durationMs: 60_000,
    });
    expect(estimate.costUsd).toBeCloseTo(4.002);
    expect(estimate.usedFallbackPricing).toBe(false);
  });

  test("uses conservative pricing when an old job has no avatar type", () => {
    const estimate = estimateHeyGenCostUsd({
      engine: "avatar_iv",
      durationMs: 1_000,
    });
    expect(estimate.costUsd).toBeCloseTo(0.0667);
    expect(estimate.usedFallbackPricing).toBe(true);
  });

  test("every price entry carries a verification date", () => {
    for (const engine of Object.values(HEYGEN_PRICING)) {
      for (const entry of Object.values(engine)) {
        expect(entry?.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });
});
