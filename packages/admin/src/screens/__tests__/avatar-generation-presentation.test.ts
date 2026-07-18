import { describe, expect, test } from "vitest";
import {
  estimateHeyGenAvatarVRun,
  formatHeyGenAmount,
  type HeyGenBilling,
} from "../avatar-generation-presentation";

const wallet: HeyGenBilling = {
  billingType: "wallet",
  currency: "usd",
  remaining: 10,
  autoReload: false,
  plan: null,
  resetsAt: null,
  spendingCurrentUsd: null,
  spendingCapUsd: null,
};

describe("HeyGen avatar cost presentation", () => {
  test("estimates Avatar V wallet cost and shortfall from exact audio duration", () => {
    const estimate = estimateHeyGenAvatarVRun(426_192, new Set(["avatar_v"]), wallet);
    expect(estimate?.required).toBeCloseTo(28.426, 2);
    expect(estimate?.shortfall).toBeCloseTo(18.426, 2);
    expect(formatHeyGenAmount(estimate?.required ?? null, "usd")).toBe("$28.43");
  });

  test("does not guess a price for mixed or unsupported engines", () => {
    expect(estimateHeyGenAvatarVRun(60_000, new Set(["avatar_iv"]), wallet)).toBeNull();
    expect(
      estimateHeyGenAvatarVRun(60_000, new Set(["avatar_v", "avatar_iv"]), wallet)
    ).toBeNull();
  });
});
