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

const decisionValidator = v.union(v.literal("approve"), v.literal("reject"));
type GateDecision = "approve" | "reject";

async function startRunHelper(
  ctx: MutationCtx,
  institutionId: Id<"institutions">,
  sourceDocIds: Id<"sourceDocs">[] = [],
  brief?: string
): Promise<Id<"runs">> {
  const institution = await ctx.db.get(institutionId);
  if (!institution) {
    appError(AppErrorCode.INSTITUTION_NOT_FOUND);
  }

  // Creation is the one place a run's state is set outside transitionRun:
  // every run is born UPLOADED; all subsequent changes go through the
  // transition mutation.
  const trimmedBrief = brief?.trim();
  const runId = await ctx.db.insert("runs", {
    institutionId,
    state: "UPLOADED",
    promptVersions: {},
    ...(trimmedBrief ? { brief: trimmedBrief } : {}),
  });

  // Link registered source docs to this run (a run may ingest several).
  for (const sourceDocId of sourceDocIds) {
    const doc = await ctx.db.get(sourceDocId);
    if (!doc) {
      appError(AppErrorCode.SOURCE_DOC_NOT_FOUND);
    }
    await ctx.db.patch(sourceDocId, { runId });
  }

  await start(ctx, internal.pipeline.workflows.ingestAndExtract, { runId });

  return runId;
}

async function decideGateHelper(
  ctx: MutationCtx,
  args: {
    runId: Id<"runs">;
    gate: ReviewGate;
    decision: GateDecision;
    reviewer: string;
    notes?: string;
  }
): Promise<void> {
  const run = await ctx.db.get(args.runId);
  if (!run) {
    appError(AppErrorCode.RUN_NOT_FOUND);
  }

  if (run.state !== GATE_STATES[args.gate]) {
    appError(AppErrorCode.RUN_NOT_AT_GATE);
  }

  // Gate 3 cannot be approved while any unit is blocked on an unresolved
  // pronunciation or carries a synthesis error — the preview query surfaces
  // the offending units to the reviewer.
  if (args.gate === 3 && args.decision === "approve" && run.courseId) {
    const units = await ctx.db
      .query("microUnits")
      .withIndex("by_course", (q) => q.eq("courseId", run.courseId!))
      .take(1000);
    if (
      units.some((unit) => unit.state === "blocked" || unit.error !== undefined)
    ) {
      appError(AppErrorCode.UNITS_BLOCKED);
    }
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
    // Gate 3 rejection is a send-back, not a dead end: the run returns to
    // course review with the reviewer's notes attached (journaled in
    // runEvents and surfaced at gate 2 via a gate3_rejection review item).
    if (args.gate === 3) {
      const notes = (args.notes ?? "").trim().slice(0, 500);
      await applyRunTransition(ctx, {
        runId: args.runId,
        toState: "GATE_2_COURSE_REVIEW",
        actor: args.reviewer,
        detail:
          notes.length > 0 ? `gate 3 rejected: ${notes}` : "gate 3 rejected",
      });
      await ctx.db.insert("reviewItems", {
        runId: args.runId,
        gate: 2,
        kind: "gate3_rejection",
        payload: {
          notes,
          rejectedBy: args.reviewer,
          rejectedAt: Date.now(),
        },
        status: "pending",
      });
      return;
    }

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
      // M6.5: knowledge review feeds the OUTLINE pass; compilation only
      // starts once the operator approves the (editable) outline.
      await applyRunTransition(ctx, {
        runId: args.runId,
        toState: "OUTLINING",
        actor: args.reviewer,
        detail: "gate 1 approved: proposing course outline from reviewed inventory",
      });
      await start(ctx, internal.pipeline.workflows.generateOutline, {
        runId: args.runId,
      });
      break;
    }
    case 2: {
      await applyRunTransition(ctx, {
        runId: args.runId,
        toState: "GENERATING_SCRIPT",
        actor: args.reviewer,
        detail: "gate 2 approved: starting asset generation",
      });
      await start(ctx, internal.pipeline.workflows.generateAssets, {
        runId: args.runId,
      });
      break;
    }
    case 3: {
      await applyRunTransition(ctx, {
        runId: args.runId,
        toState: "PUBLISHING",
        actor: args.reviewer,
        detail: "gate 3 approved: publishing course",
      });
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
    brief: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await startRunHelper(
      ctx,
      args.institutionId,
      args.sourceDocIds,
      args.brief
    );
  },
});

/** Resolve a human review gate and advance the run to the next phase. */
export const decideGate = internalMutation({
  args: {
    runId: v.id("runs"),
    gate: reviewGateValidator,
    decision: decisionValidator,
    reviewer: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await decideGateHelper(ctx, {
      runId: args.runId,
      gate: args.gate,
      decision: args.decision,
      reviewer: args.reviewer ?? "system",
      ...(args.notes !== undefined ? { notes: args.notes } : {}),
    });
    return null;
  },
});

/** Admin-only public wrapper for startRun. */
export const adminStartRun = mutation({
  args: {
    institutionId: v.id("institutions"),
    sourceDocIds: v.optional(v.array(v.id("sourceDocs"))),
    brief: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    return await startRunHelper(
      ctx,
      args.institutionId,
      args.sourceDocIds,
      args.brief
    );
  },
});

async function sendBackForReauthoringHelper(
  ctx: MutationCtx,
  args: { runId: Id<"runs">; unitIds: Id<"microUnits">[]; actor: string }
): Promise<void> {
  const run = await ctx.db.get(args.runId);
  if (!run) {
    appError(AppErrorCode.RUN_NOT_FOUND);
  }
  if (run.state !== GATE_STATES[2]) {
    appError(AppErrorCode.RUN_NOT_AT_GATE);
  }
  if (args.unitIds.length === 0) {
    appError(AppErrorCode.UNITS_REQUIRED);
  }
  for (const unitId of args.unitIds) {
    const unit = await ctx.db.get(unitId);
    if (!unit || !run.courseId || unit.courseId !== run.courseId) {
      appError(AppErrorCode.UNITS_REQUIRED);
    }
  }
  await applyRunTransition(ctx, {
    runId: args.runId,
    toState: "COMPILING",
    actor: args.actor,
    detail: `gate 2 send-back: re-authoring ${args.unitIds.length} unit(s)`,
  });
  await start(ctx, internal.pipeline.workflows.compileAndJudge, {
    runId: args.runId,
    reAuthorUnitIds: args.unitIds,
  });
}

/** Gate-2 send-back for scripts/walkthroughs (mirrors decideGate). */
export const sendBackForReauthoring = internalMutation({
  args: {
    runId: v.id("runs"),
    unitIds: v.array(v.id("microUnits")),
    reviewer: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await sendBackForReauthoringHelper(ctx, {
      runId: args.runId,
      unitIds: args.unitIds,
      actor: args.reviewer ?? "system",
    });
    return null;
  },
});

/**
 * Gate-2 send-back: re-author the selected units with the judge's flags as
 * feedback. Preserved units pass through the recompile unchanged; the
 * re-authored course goes back through the QA judge before returning to
 * gate 2.
 */
export const adminSendBackForReauthoring = mutation({
  args: {
    runId: v.id("runs"),
    unitIds: v.array(v.id("microUnits")),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    await sendBackForReauthoringHelper(ctx, {
      runId: args.runId,
      unitIds: args.unitIds,
      actor: admin.email,
    });
    return null;
  },
});

/** Admin-only public wrapper for decideGate. */
export const adminDecideGate = mutation({
  args: {
    runId: v.id("runs"),
    gate: reviewGateValidator,
    decision: decisionValidator,
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    await decideGateHelper(ctx, {
      runId: args.runId,
      gate: args.gate,
      decision: args.decision,
      reviewer: admin.email,
      ...(args.notes !== undefined ? { notes: args.notes } : {}),
    });
    return null;
  },
});
