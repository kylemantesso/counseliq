import { start } from "@convex-dev/workflow";
import { v } from "convex/values";
import { internalMutation, mutation } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { reviewGateValidator } from "../schema";
import { AppErrorCode, appError } from "../errors";
import { requireAdmin } from "../admin";
import { GATE_STATES, type ReviewGate } from "./states";
import { applyRunTransition } from "./transitions";
import { insertGateReviewItems } from "./reviewItems";

const decisionValidator = v.union(v.literal("approve"), v.literal("reject"));
type GateDecision = "approve" | "reject";

async function startRunHelper(
  ctx: MutationCtx,
  institutionId: Id<"institutions">,
  sourceDocIds: Id<"sourceDocs">[] = []
): Promise<Id<"runs">> {
  const institution = await ctx.db.get(institutionId);
  if (!institution) {
    appError(AppErrorCode.INSTITUTION_NOT_FOUND);
  }

  // Creation is the one place a run's state is set outside transitionRun:
  // every run is born UPLOADED; all subsequent changes go through the
  // transition mutation.
  const runId = await ctx.db.insert("runs", {
    institutionId,
    state: "UPLOADED",
    promptVersions: {},
  });

  // Link registered source docs to this run (a run may ingest several).
  for (const sourceDocId of sourceDocIds) {
    const doc = await ctx.db.get(sourceDocId);
    if (!doc) {
      appError(AppErrorCode.SOURCE_DOC_NOT_FOUND);
    }
    await ctx.db.patch(sourceDocId, { runId });
  }

  await start(ctx, internal.pipeline.workflows.ingestAndCompile, { runId });

  return runId;
}

async function decideGateHelper(
  ctx: MutationCtx,
  args: {
    runId: Id<"runs">;
    gate: ReviewGate;
    decision: GateDecision;
    reviewer: string;
  }
): Promise<void> {
  const run = await ctx.db.get(args.runId);
  if (!run) {
    appError(AppErrorCode.RUN_NOT_FOUND);
  }

  if (run.state !== GATE_STATES[args.gate]) {
    appError(AppErrorCode.RUN_NOT_AT_GATE);
  }

  const gateItems = await ctx.db
    .query("reviewItems")
    .withIndex("by_run_and_gate", (q) =>
      q.eq("runId", args.runId).eq("gate", args.gate)
    )
    .take(1000);

  // Gate 1 items are real per-fact reviews (M3): approving the gate requires
  // every item to be individually resolved (approve-with-source / exclude).
  if (
    args.gate === 1 &&
    args.decision === "approve" &&
    gateItems.some((item) => item.status === "pending")
  ) {
    appError(AppErrorCode.GATE_ITEMS_UNRESOLVED);
  }

  const decidedStatus = args.decision === "approve" ? "approved" : "rejected";
  for (const item of gateItems) {
    if (item.status !== "pending") {
      continue;
    }
    await ctx.db.patch(item._id, {
      status: decidedStatus,
      reviewer: args.reviewer,
      decidedAt: Date.now(),
    });
  }

  if (args.decision === "reject") {
    await applyRunTransition(ctx, {
      runId: args.runId,
      toState: "FAILED",
      actor: args.reviewer,
      detail: `gate ${args.gate} rejected`,
      error: { retryable: true, cause: `gate ${args.gate} rejected` },
    });
    return;
  }

  switch (args.gate) {
    case 1: {
      await applyRunTransition(ctx, {
        runId: args.runId,
        toState: "GENERATING_SCRIPT",
        actor: args.reviewer,
        detail: "gate 1 approved: starting asset generation",
      });
      await start(ctx, internal.pipeline.workflows.generateAssets, {
        runId: args.runId,
      });
      break;
    }
    case 2: {
      await applyRunTransition(ctx, {
        runId: args.runId,
        toState: "GATE_3_PREVIEW",
        actor: args.reviewer,
        detail: "gate 2 approved: awaiting preview review",
      });
      await insertGateReviewItems(ctx, args.runId, 3);
      break;
    }
    case 3: {
      await start(ctx, internal.pipeline.workflows.publishPhase, {
        runId: args.runId,
      });
      break;
    }
  }
}

/** Create a run in UPLOADED and kick off the ingest-and-compile phase. */
export const startRun = internalMutation({
  args: {
    institutionId: v.id("institutions"),
    sourceDocIds: v.optional(v.array(v.id("sourceDocs"))),
  },
  handler: async (ctx, args) => {
    return await startRunHelper(ctx, args.institutionId, args.sourceDocIds);
  },
});

/** Resolve a human review gate and advance the run to the next phase. */
export const decideGate = internalMutation({
  args: {
    runId: v.id("runs"),
    gate: reviewGateValidator,
    decision: decisionValidator,
    reviewer: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await decideGateHelper(ctx, {
      runId: args.runId,
      gate: args.gate,
      decision: args.decision,
      reviewer: args.reviewer ?? "system",
    });
    return null;
  },
});

/** Admin-only public wrapper for startRun. */
export const adminStartRun = mutation({
  args: {
    institutionId: v.id("institutions"),
    sourceDocIds: v.optional(v.array(v.id("sourceDocs"))),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    return await startRunHelper(ctx, args.institutionId, args.sourceDocIds);
  },
});

/** Admin-only public wrapper for decideGate. */
export const adminDecideGate = mutation({
  args: {
    runId: v.id("runs"),
    gate: reviewGateValidator,
    decision: decisionValidator,
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    await decideGateHelper(ctx, {
      runId: args.runId,
      gate: args.gate,
      decision: args.decision,
      reviewer: admin.email,
    });
    return null;
  },
});
