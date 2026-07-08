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

/** Internal variant for scripts (eval-compile reuse detection). */
export const listRunsByStateInternal = internalQuery({
  args: { state: runStateValidator },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("runs")
      .withIndex("by_state", (q) => q.eq("state", args.state))
      .order("desc")
      .take(100);
  },
});

/** Auth check for admin-only actions (actions have no db access). */
export const assertAdmin = internalQuery({
  args: {},
  handler: async (ctx): Promise<{ email: string }> => {
    const admin = await requireAdmin(ctx);
    return { email: admin.email };
  },
});

/** Source documents, newest first — the admin ingestion inspector list. */
export const listSourceDocs = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return await ctx.db.query("sourceDocs").order("desc").take(100);
  },
});

/** One source doc with its converted pages, ordered by page number. */
export const getSourceDoc = query({
  args: { sourceDocId: v.id("sourceDocs") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const doc = await ctx.db.get(args.sourceDocId);
    if (!doc) {
      return null;
    }
    const slides = await ctx.db
      .query("slides")
      .withIndex("by_source_doc_and_n", (q) =>
        q.eq("sourceDocId", args.sourceDocId)
      )
      .take(500);
    return { doc, slides };
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
