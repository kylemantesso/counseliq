/**
 * Price sheet used ONLY for pre-run cost estimates (npm run eval). Actual
 * cost is always taken from OpenRouter's per-response usage accounting
 * (usage.cost) and recorded on llmCalls — never computed from this table.
 *
 * Values are USD per 1M tokens, operator-confirmed from
 * https://openrouter.ai/<model>/pricing on `verifiedAt`.
 */

export interface ModelPricing {
  inputPerMTokUsd: number;
  outputPerMTokUsd: number;
  verifiedAt: string;
}

export const PRICING: Record<string, ModelPricing> = {
  // Note: Google scheduled gemini-2.5-flash EOL mid-2026; it remains listed
  // on OpenRouter. If extraction starts failing with model-unavailable
  // errors, swap the task routing in models.ts.
  "google/gemini-2.5-flash": {
    inputPerMTokUsd: 0.3,
    outputPerMTokUsd: 2.5,
    verifiedAt: "2026-07-07",
  },
};

export interface CostEstimateInput {
  model: string;
  calls: number;
  avgTokensInPerCall: number;
  avgTokensOutPerCall: number;
}

/** Returns the estimate in USD, or null when the model has no price sheet. */
export function estimateCostUsd(input: CostEstimateInput): number | null {
  const pricing = PRICING[input.model];
  if (!pricing) return null;
  const tokensIn = input.calls * input.avgTokensInPerCall;
  const tokensOut = input.calls * input.avgTokensOutPerCall;
  return (
    (tokensIn / 1_000_000) * pricing.inputPerMTokUsd +
    (tokensOut / 1_000_000) * pricing.outputPerMTokUsd
  );
}
