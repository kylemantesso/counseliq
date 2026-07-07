import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  query,
} from "../_generated/server";
import type { QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { requireAdmin } from "../admin";

/**
 * Cost + observability for LLM usage. Every OpenRouter call (including
 * validation retries) writes one llmCalls row with the provider-reported
 * cost — never a locally computed price.
 */

export const recordLlmCall = internalMutation({
  args: {
    runId: v.id("runs"),
    stage: v.string(),
    promptVersion: v.string(),
    model: v.string(),
    tokensIn: v.number(),
    tokensOut: v.number(),
    costUsd: v.number(),
    latencyMs: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("llmCalls", args);
    return null;
  },
});

export interface RunCostBreakdown {
  totalUsd: number;
  totalCalls: number;
  totalTokensIn: number;
  totalTokensOut: number;
  byStage: Array<{
    stage: string;
    model: string;
    calls: number;
    tokensIn: number;
    tokensOut: number;
    costUsd: number;
  }>;
}

async function computeRunCost(
  ctx: QueryCtx,
  runId: Id<"runs">
): Promise<RunCostBreakdown> {
  const calls = await ctx.db
    .query("llmCalls")
    .withIndex("by_run", (q) => q.eq("runId", runId))
    .take(5000);

  const byKey = new Map<string, RunCostBreakdown["byStage"][number]>();
  let totalUsd = 0;
  let totalTokensIn = 0;
  let totalTokensOut = 0;
  for (const call of calls) {
    const key = `${call.stage}\u0000${call.model}`;
    const entry = byKey.get(key) ?? {
      stage: call.stage,
      model: call.model,
      calls: 0,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
    };
    entry.calls += 1;
    entry.tokensIn += call.tokensIn;
    entry.tokensOut += call.tokensOut;
    entry.costUsd += call.costUsd;
    byKey.set(key, entry);
    totalUsd += call.costUsd;
    totalTokensIn += call.tokensIn;
    totalTokensOut += call.tokensOut;
  }

  return {
    totalUsd,
    totalCalls: calls.length,
    totalTokensIn,
    totalTokensOut,
    byStage: [...byKey.values()].sort((a, b) =>
      a.stage.localeCompare(b.stage)
    ),
  };
}

/** Total LLM cost for a run, itemized by stage and model. */
export const getRunCost = query({
  args: { runId: v.id("runs") },
  handler: async (ctx, args): Promise<RunCostBreakdown> => {
    await requireAdmin(ctx);
    return await computeRunCost(ctx, args.runId);
  },
});

/** Internal variant for the walkthrough and eval scripts. */
export const getRunCostInternal = internalQuery({
  args: { runId: v.id("runs") },
  handler: async (ctx, args): Promise<RunCostBreakdown> => {
    return await computeRunCost(ctx, args.runId);
  },
});
