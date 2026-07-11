import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  query,
} from "../_generated/server";
import type { QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { requireAdmin } from "../admin";
import { estimateCostUsd, PRICING } from "./llm/pricing";
import {
  currentModelRouting,
  isLlmTask,
  type LlmModelRouting,
} from "./llm/models";

/**
 * Cost + observability for LLM usage. Every OpenRouter call (including
 * validation retries) writes one llmCalls row with the provider-reported
 * cost — never a locally computed price.
 */

export const recordLlmCall = internalMutation({
  args: {
    /** Absent for run-less workloads (institution-scoped asset tagging). */
    runId: v.optional(v.id("runs")),
    institutionId: v.optional(v.id("institutions")),
    sourceDocId: v.optional(v.id("sourceDocs")),
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
  /** LLM-only totals (pre-M5 shape, kept for walkthrough/eval compat). */
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
  /** TTS totals (M5). costUsd here is estimated, not provider-reported. */
  tts: {
    totalUsd: number;
    totalCalls: number;
    totalCharacters: number;
    byStage: Array<{
      stage: string;
      model: string;
      calls: number;
      characters: number;
      costUsd: number;
    }>;
  };
  /** LLM + TTS. */
  grandTotalUsd: number;
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

  const ttsCalls = await ctx.db
    .query("ttsCalls")
    .withIndex("by_run", (q) => q.eq("runId", runId))
    .take(5000);
  const ttsByKey = new Map<
    string,
    RunCostBreakdown["tts"]["byStage"][number]
  >();
  let ttsUsd = 0;
  let ttsCharacters = 0;
  for (const call of ttsCalls) {
    const key = `${call.stage}\u0000${call.model}`;
    const entry = ttsByKey.get(key) ?? {
      stage: call.stage,
      model: call.model,
      calls: 0,
      characters: 0,
      costUsd: 0,
    };
    entry.calls += 1;
    entry.characters += call.characters;
    entry.costUsd += call.costUsd;
    ttsByKey.set(key, entry);
    ttsUsd += call.costUsd;
    ttsCharacters += call.characters;
  }

  return {
    totalUsd,
    totalCalls: calls.length,
    totalTokensIn,
    totalTokensOut,
    byStage: [...byKey.values()].sort((a, b) =>
      a.stage.localeCompare(b.stage)
    ),
    tts: {
      totalUsd: ttsUsd,
      totalCalls: ttsCalls.length,
      totalCharacters: ttsCharacters,
      byStage: [...ttsByKey.values()].sort((a, b) =>
        a.stage.localeCompare(b.stage)
      ),
    },
    grandTotalUsd: totalUsd + ttsUsd,
  };
}

async function resolveModelRouting(ctx: QueryCtx): Promise<LlmModelRouting> {
  const rows = await ctx.db.query("llmTaskModels").take(50);
  const overrides: Partial<LlmModelRouting> = {};
  for (const row of rows) {
    if (!isLlmTask(row.task)) continue;
    const model = row.model.trim();
    if (model.length === 0) continue;
    overrides[row.task] = model;
  }
  return currentModelRouting(overrides);
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

/**
 * Pre-run cost estimate for `npm run eval`, from the operator-confirmed
 * price sheet in llm/pricing.ts. Actual cost is always provider-reported.
 */
/**
 * Pre-run cost estimate for `npm run eval:compile`: extraction is assumed
 * cached (page cache), so the dominant costs are the structure pass, one
 * author-unit call per planned unit (plus compliance retries), and one
 * judge pass over the whole course.
 */
export const estimateCompileCost = internalQuery({
  args: {
    units: v.number(),
    avgTokensInPerUnit: v.number(),
    avgTokensOutPerUnit: v.number(),
  },
  handler: async (ctx, args) => {
    const models = await resolveModelRouting(ctx);
    const structureModel = models["compile-structure"];
    const authorModel = models["author-unit"];
    const judgeModel = models["judge-course"];
    const structureEstimate = estimateCostUsd({
      model: structureModel,
      calls: 1,
      avgTokensInPerCall: args.units * 900,
      avgTokensOutPerCall: args.units * 80,
    });
    // ~1.3 calls/unit budgets for the one compliance-feedback retry.
    const authorEstimate = estimateCostUsd({
      model: authorModel,
      calls: Math.ceil(args.units * 1.3),
      avgTokensInPerCall: args.avgTokensInPerUnit,
      avgTokensOutPerCall: args.avgTokensOutPerUnit,
    });
    const judgeEstimate = estimateCostUsd({
      model: judgeModel,
      calls: 1,
      avgTokensInPerCall: args.units * (args.avgTokensOutPerUnit + 600),
      avgTokensOutPerCall: args.units * 350,
    });
    const known =
      structureEstimate !== null &&
      authorEstimate !== null &&
      judgeEstimate !== null;
    return {
      models,
      priceSheetVerifiedAt: PRICING[authorModel]?.verifiedAt ?? null,
      estimateUsd: known
        ? (structureEstimate ?? 0) + (authorEstimate ?? 0) + (judgeEstimate ?? 0)
        : null,
    };
  },
});

export const estimateExtractionCost = internalQuery({
  args: {
    pages: v.number(),
    avgTokensInPerPage: v.number(),
    avgTokensOutPerPage: v.number(),
  },
  handler: async (ctx, args) => {
    const models = await resolveModelRouting(ctx);
    const model = models["extract-page"];
    const pageEstimate = estimateCostUsd({
      model,
      calls: args.pages,
      avgTokensInPerCall: args.avgTokensInPerPage,
      avgTokensOutPerCall: args.avgTokensOutPerPage,
    });
    // Merge sees every concept candidate.
    const mergeEstimate = estimateCostUsd({
      model: models["merge-inventory"],
      calls: 1,
      avgTokensInPerCall: args.pages * 120,
      avgTokensOutPerCall: args.pages * 60,
    });
    const known = pageEstimate !== null && mergeEstimate !== null;
    return {
      models,
      priceSheetVerifiedAt: PRICING[model]?.verifiedAt ?? null,
      estimateUsd: known
        ? (pageEstimate ?? 0) + (mergeEstimate ?? 0)
        : null,
    };
  },
});
