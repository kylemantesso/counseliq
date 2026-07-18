export type HeyGenBilling = {
  billingType: string;
  currency: string;
  remaining: number | null;
  autoReload: boolean;
  plan: string | null;
  resetsAt: string | null;
  spendingCurrentUsd: number | null;
  spendingCapUsd: number | null;
};

export function estimateHeyGenAvatarVRun(
  durationMs: number,
  engines: ReadonlySet<string>,
  billing: HeyGenBilling | null
): { required: number; shortfall: number; currency: string } | null {
  if (!billing || durationMs <= 0 || engines.size !== 1 || !engines.has("avatar_v")) {
    return null;
  }
  const seconds = durationMs / 1000;
  const rate = billing.currency === "usd" ? 0.0667 : 0.1;
  const required = seconds * rate;
  return {
    required,
    shortfall: Math.max(0, required - (billing.remaining ?? 0)),
    currency: billing.currency,
  };
}

export function formatHeyGenAmount(value: number | null, currency: string): string {
  if (value === null) return "Unavailable";
  if (currency === "usd") {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  }
  return `${value.toFixed(2)} credits`;
}
