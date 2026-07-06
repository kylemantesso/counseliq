import { v } from "convex/values";
import { internalQuery, query } from "../_generated/server";
import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { reviewGateValidator, runStateValidator } from "../schema";
import { requireAdmin } from "../admin";

async function getRunWithEvents(
  ctx: QueryCtx,
  runId: Id<"runs">
): Promise<{ run: Doc<"runs"> | null; events: Doc<"runEvents">[] }> {
  const run = await ctx.db.get(runId);
  if (!run) {
    return { run: null, events: [] };
  }

  const events = await ctx.db
    .query("runEvents")
    .withIndex("by_run", (q) => q.eq("runId", runId))
    .take(200);

  return { run, events };
}

/** A run plus its full transition history, oldest first. */
export const getRun = query({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    return await getRunWithEvents(ctx, args.runId);
  },
});

/** Internal variant of getRun for scripts and tests (no auth context). */
export const getRunInternal = internalQuery({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    return await getRunWithEvents(ctx, args.runId);
  },
});

export const listRunsByState = query({
  args: { state: runStateValidator },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    return await ctx.db
      .query("runs")
      .withIndex("by_state", (q) => q.eq("state", args.state))
      .order("desc")
      .take(100);
  },
});

/** Pending review items waiting at a gate, oldest first. */
export const gateQueue = query({
  args: { gate: reviewGateValidator },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    return await ctx.db
      .query("reviewItems")
      .withIndex("by_gate_and_status", (q) =>
        q.eq("gate", args.gate).eq("status", "pending")
      )
      .take(100);
  },
});
