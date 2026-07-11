import { v } from "convex/values";
import { internalQuery } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { reviewGateValidator } from "../schema";

/** Payload of a gate-3 `blocked_unit` review item (created by GENERATING_SCRIPT). */
export interface BlockedUnitItem {
  unitKey: string;
  moduleKey: string;
  concept: string;
  blockedTerms: string[];
  narrationIds: string[];
}

/**
 * Gate 3: one review item per unit blocked on an unresolved
 * CONFIRM_WITH_INSTITUTION pronunciation. Idempotent: existing gate-3
 * blocked_unit items for the run are replaced; other gate-3 kinds are left
 * untouched.
 */
export async function replaceGate3BlockedUnitItems(
  ctx: MutationCtx,
  runId: Id<"runs">,
  items: BlockedUnitItem[]
): Promise<void> {
  const existing = await ctx.db
    .query("reviewItems")
    .withIndex("by_run_and_gate", (q) => q.eq("runId", runId).eq("gate", 3))
    .take(1000);
  for (const item of existing) {
    if (item.kind === "blocked_unit") {
      await ctx.db.delete(item._id);
    }
  }
  for (const item of items) {
    await ctx.db.insert("reviewItems", {
      runId,
      gate: 3,
      kind: "blocked_unit",
      payload: item,
      status: "pending",
    });
  }
}

/** Payload of a gate-3 `failed_unit` review item (created by GENERATING_ASSETS). */
export interface FailedUnitItem {
  unitKey: string;
  moduleKey: string;
  concept: string;
  cause: string;
  retryable: boolean;
}

/**
 * Gate 3: one review item per unit whose synthesis failed. Idempotent:
 * existing gate-3 failed_unit items for the run are replaced; other gate-3
 * kinds are left untouched.
 */
export async function replaceGate3FailedUnitItems(
  ctx: MutationCtx,
  runId: Id<"runs">,
  items: FailedUnitItem[]
): Promise<void> {
  const existing = await ctx.db
    .query("reviewItems")
    .withIndex("by_run_and_gate", (q) => q.eq("runId", runId).eq("gate", 3))
    .take(1000);
  for (const item of existing) {
    if (item.kind === "failed_unit") {
      await ctx.db.delete(item._id);
    }
  }
  for (const item of items) {
    await ctx.db.insert("reviewItems", {
      runId,
      gate: 3,
      kind: "failed_unit",
      payload: item,
      status: "pending",
    });
  }
}

/** All review items for a run + gate, any status (scripts/tests/UI). */
export const listReviewItemsForRun = internalQuery({
  args: { runId: v.id("runs"), gate: reviewGateValidator },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("reviewItems")
      .withIndex("by_run_and_gate", (q) =>
        q.eq("runId", args.runId).eq("gate", args.gate)
      )
      .take(1000);
  },
});
