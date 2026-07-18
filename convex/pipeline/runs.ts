import { start } from "@convex-dev/workflow";
import { v } from "convex/values";
import { internalMutation, mutation } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { AppErrorCode, appError } from "../errors";
import { requireAdmin } from "../admin";
import { GATE_STATES, type RunState } from "./states";
import { applyRunTransition, recoverRunFromFailure } from "./transitions";
import { getSourceDocFactReviewFromDoc } from "./sourceDocFacts";
import { materializeReviewedInventory } from "./inventory";
import {
  getExplicitRunAssetIds,
  isAssetCleared,
  isCatalogueAsset,
} from "./assetsCatalogue";
import type { CoursePresentation } from "@counseliq/course-schema";
import { requeueRetryableAvatarGeneration } from "./avatar/jobs";

const decisionValidator = v.union(v.literal("approve"), v.literal("reject"));
type GateDecision = "approve" | "reject";
const actionableGateValidator = v.union(v.literal(2), v.literal(3));
type ActionableGate = 2 | 3;

type ResumeResult = {
  queued: boolean;
  stage:
    | "outline"
    | "compile"
    | "assets"
    | "avatar"
    | "publish"
    | "render"
    | "recovered"
    | "noop";
};

const LEGACY_INGESTION_STATES = new Set<RunState>([
  "UPLOADED",
  "CONVERTING",
  "CONVERTED",
  "EXTRACTING",
  "EXTRACTED",
]);

async function materializeLinkedReviewedDocuments(
  ctx: MutationCtx,
  runId: Id<"runs">
): Promise<void> {
  const docs = await ctx.db
    .query("sourceDocs")
    .withIndex("by_run", (q) => q.eq("runId", runId))
    .take(100);
  if (docs.length === 0) appError(AppErrorCode.SOURCE_DOCS_REQUIRED);
  for (const doc of docs) {
    const review = await getSourceDocFactReviewFromDoc(ctx, doc);
    if (review.status !== "approved" || review.expectedPages === 0) {
      appError(AppErrorCode.SOURCE_DOC_FACTS_PENDING_REVIEW);
    }
  }
  await materializeReviewedInventory(
    ctx,
    runId,
    docs.map((doc) => doc._id)
  );
}

function recoveryStateForFailedFromState(fromState: RunState): RunState | null {
  switch (fromState) {
    case "UPLOADED":
    case "CONVERTING":
    case "CONVERTED":
    case "EXTRACTING":
    case "EXTRACTED":
      return fromState;
    case "COMPILED":
    case "QA_RUNNING":
      return "COMPILING";
    case "GENERATING_ASSETS":
      return "GENERATING_SCRIPT";
    case "GENERATING_AVATAR":
      return "GENERATING_AVATAR";
    case "FAILED":
      return null;
    default:
      return fromState;
  }
}

async function queueResumeForState(
  ctx: MutationCtx,
  runId: Id<"runs">,
  state: RunState,
  actor: string
): Promise<ResumeResult> {
  if (LEGACY_INGESTION_STATES.has(state)) {
    await materializeLinkedReviewedDocuments(ctx, runId);
    await applyRunTransition(ctx, {
      runId,
      toState: "OUTLINING",
      actor,
      detail: "resume: using previously extracted source documents",
    });
    await start(ctx, internal.pipeline.workflows.generateOutline, { runId });
    return { queued: true, stage: "outline" as const };
  }

  if (state === "OUTLINING") {
    await start(ctx, internal.pipeline.workflows.generateOutline, { runId });
    return { queued: true, stage: "outline" as const };
  }

  if (state === "COMPILING") {
    await start(ctx, internal.pipeline.workflows.compileAndJudge, { runId });
    return { queued: true, stage: "compile" as const };
  }

  if (state === "GENERATING_SCRIPT" || state === "GENERATING_ASSETS") {
    await start(ctx, internal.pipeline.workflows.generateAssets, { runId });
    return { queued: true, stage: "assets" as const };
  }

  if (state === "GENERATING_AVATAR") {
    await requeueRetryableAvatarGeneration(ctx, runId);
    await ctx.scheduler.runAfter(0, internal.pipeline.avatar.heygen.dispatchQueuedAvatarJobs, {
      runId,
    });
    return { queued: true, stage: "avatar" as const };
  }

  if (state === "PUBLISHING") {
    await start(ctx, internal.pipeline.workflows.publishPhase, { runId });
    return { queued: true, stage: "publish" as const };
  }

  if (state === "PUBLISHED") {
    await ctx.scheduler.runAfter(0, internal.pipeline.render.dispatchQueuedForRun, {
      runId,
    });
    return { queued: true, stage: "render" as const };
  }

  return { queued: false, stage: "noop" as const };
}

async function resumeCourseGenerationHelper(
  ctx: MutationCtx,
  args: { runId: Id<"runs">; actor: string; detailPrefix: string }
): Promise<ResumeResult> {
  const run = await ctx.db.get(args.runId);
  if (!run) appError(AppErrorCode.RUN_NOT_FOUND);

  if (run.state !== "FAILED") {
    return await queueResumeForState(ctx, args.runId, run.state, args.actor);
  }

  if (!run.error?.retryable) {
    appError(AppErrorCode.RUN_TRANSITION_INVALID);
  }

  const events = await ctx.db
    .query("runEvents")
    .withIndex("by_run", (q) => q.eq("runId", args.runId))
    .take(200);
  const lastFailure = [...events].reverse().find((event) => event.toState === "FAILED");
  if (!lastFailure) {
    appError(AppErrorCode.RUN_TRANSITION_INVALID);
  }

  const recoveryState = recoveryStateForFailedFromState(lastFailure.fromState);
  if (!recoveryState) {
    appError(AppErrorCode.RUN_TRANSITION_INVALID);
  }

  await recoverRunFromFailure(ctx, {
    runId: args.runId,
    toState: recoveryState,
    actor: args.actor,
    detail: `${args.detailPrefix}: recovered from failed state to ${recoveryState}`,
  });

  const resumed = await queueResumeForState(
    ctx,
    args.runId,
    recoveryState,
    args.actor
  );
  if (resumed.queued) {
    return resumed;
  }

  return { queued: true, stage: "recovered" as const };
}

async function startRunHelper(
  ctx: MutationCtx,
  institutionId: Id<"institutions">,
  sourceDocIds: Id<"sourceDocs">[] = [],
  brief?: string,
  assetIds?: Id<"assets">[],
  presentation?: CoursePresentation
): Promise<Id<"runs">> {
  const institution = await ctx.db.get(institutionId);
  if (!institution) {
    appError(AppErrorCode.INSTITUTION_NOT_FOUND);
  }
  if (assetIds !== undefined) {
    if (assetIds.length > 2000 || new Set(assetIds).size !== assetIds.length) {
      appError(AppErrorCode.RUN_ASSET_SELECTION_INVALID);
    }
    for (const assetId of assetIds) {
      const asset = await ctx.db.get(assetId);
      if (
        !asset ||
        !isCatalogueAsset(asset) ||
        asset.institutionId !== institutionId
      ) {
        appError(AppErrorCode.RUN_ASSET_SELECTION_INVALID);
      }
    }
  }
  if (sourceDocIds.length === 0 || new Set(sourceDocIds).size !== sourceDocIds.length) {
    appError(AppErrorCode.SOURCE_DOCS_REQUIRED);
  }

  for (const sourceDocId of sourceDocIds) {
    const doc = await ctx.db.get(sourceDocId);
    if (!doc) {
      appError(AppErrorCode.SOURCE_DOC_NOT_FOUND);
    }
    if (doc.institutionId !== institutionId) {
      appError(AppErrorCode.RUN_TRANSITION_INVALID);
    }

    const review = await getSourceDocFactReviewFromDoc(ctx, doc);
    if (review.status !== "approved" || review.expectedPages === 0) {
      appError(AppErrorCode.SOURCE_DOC_FACTS_PENDING_REVIEW);
    }
  }

  // Document conversion, fact extraction, and fact review are upload-time
  // concerns. Course generation starts from the approved stored facts.
  const trimmedBrief = brief?.trim();
  const runId = await ctx.db.insert("runs", {
    institutionId,
    state: "OUTLINING",
    promptVersions: {},
    ...(assetIds !== undefined ? { hasExplicitAssetSelection: true } : {}),
    ...(trimmedBrief ? { brief: trimmedBrief } : {}),
    ...(presentation !== undefined ? { presentation } : {}),
  });

  for (const assetId of assetIds ?? []) {
    await ctx.db.insert("runAssetSelections", { runId, assetId });
  }

  // Link registered source docs to this run (a run may ingest several).
  for (const sourceDocId of sourceDocIds) {
    await ctx.db.patch(sourceDocId, { runId });
  }

  await materializeReviewedInventory(ctx, runId, sourceDocIds);
  await start(ctx, internal.pipeline.workflows.generateOutline, { runId });

  return runId;
}

async function decideGateHelper(
  ctx: MutationCtx,
  args: {
    runId: Id<"runs">;
    gate: ActionableGate;
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

  if (args.gate === 3 && args.decision === "approve") {
    if (!run.courseId) {
      appError(AppErrorCode.COURSE_NOT_FOUND);
    }
    const explicitAssetIds = await getExplicitRunAssetIds(ctx, run);
    if (explicitAssetIds !== null) {
      for (const assetId of explicitAssetIds) {
        const asset = await ctx.db.get(assetId);
        if (
          !asset ||
          !isCatalogueAsset(asset) ||
          asset.institutionId !== run.institutionId ||
          !isAssetCleared(asset)
        ) {
          appError(AppErrorCode.RUN_SELECTED_ASSETS_NOT_CLEARED);
        }
      }
    }
    const units = await ctx.db
      .query("microUnits")
      .withIndex("by_course", (q) => q.eq("courseId", run.courseId!))
      .take(1000);
    const blocked = units.filter(
      (unit) =>
        unit.state === "blocked" ||
        unit.error !== undefined ||
        (unit.state !== "assets_ready" && unit.state !== "published")
    );
    if (blocked.length > 0) {
      appError(AppErrorCode.UNITS_BLOCKED);
    }
  }

  const gateItems = await ctx.db
    .query("reviewItems")
    .withIndex("by_run_and_gate", (q) =>
      q.eq("runId", args.runId).eq("gate", args.gate)
    )
    .take(1000);

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

/** Create a run from reviewed source documents and start outline generation. */
export const startRun = internalMutation({
  args: {
    institutionId: v.id("institutions"),
    sourceDocIds: v.optional(v.array(v.id("sourceDocs"))),
    brief: v.optional(v.string()),
    assetIds: v.optional(v.array(v.id("assets"))),
    presentation: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    return await startRunHelper(
      ctx,
      args.institutionId,
      args.sourceDocIds,
      args.brief,
      args.assetIds,
      args.presentation as CoursePresentation | undefined
    );
  },
});

/** Resolve a human review gate and advance the run to the next phase. */
export const decideGate = internalMutation({
  args: {
    runId: v.id("runs"),
    gate: actionableGateValidator,
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
    assetIds: v.optional(v.array(v.id("assets"))),
    presentation: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    return await startRunHelper(
      ctx,
      args.institutionId,
      args.sourceDocIds,
      args.brief,
      args.assetIds,
      args.presentation as CoursePresentation | undefined
    );
  },
});

/**
 * Admin nudge: resume a stalled course generation from its current phase.
 * Safe to call repeatedly; each resume targets the workflow for the
 * generation's present state.
 */
export const adminResumeCourseGeneration = mutation({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    return await resumeCourseGenerationHelper(ctx, {
      runId: args.runId,
      actor: admin.email,
      detailPrefix: "admin resume",
    });
  },
});

/** Internal variant for scripts/tests where auth context is unavailable. */
export const resumeCourseGenerationInternal = internalMutation({
  args: { runId: v.id("runs"), actor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    return await resumeCourseGenerationHelper(ctx, {
      runId: args.runId,
      actor: args.actor ?? "system",
      detailPrefix: "internal resume",
    });
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

async function unlinkSourceDocsForRun(
  ctx: MutationCtx,
  runId: Id<"runs">
): Promise<void> {
  while (true) {
    const rows = await ctx.db
      .query("sourceDocs")
      .withIndex("by_run", (q) => q.eq("runId", runId))
      .take(200);
    if (rows.length === 0) return;
    for (const row of rows) {
      const { _id, _creationTime, runId: _ignored, ...withoutRunId } = row;
      await ctx.db.replace(row._id, withoutRunId);
    }
  }
}

async function deleteRowsByRun(
  ctx: MutationCtx,
  table:
    | "inventoryItems"
    | "courseOutlines"
    | "runAssetSelections"
    | "runEvents"
    | "reviewItems"
    | "llmCalls"
    | "ttsCalls"
    | "courseVersions",
  runId: Id<"runs">
): Promise<void> {
  while (true) {
    const rows = await ctx.db
      .query(table)
      .withIndex("by_run", (q) => q.eq("runId", runId))
      .take(500);
    if (rows.length === 0) return;
    for (const row of rows) {
      await ctx.db.delete(row._id);
    }
  }
}

async function deleteUnitAuthoringsForRun(
  ctx: MutationCtx,
  runId: Id<"runs">
): Promise<void> {
  while (true) {
    const rows = await ctx.db
      .query("unitAuthorings")
      .withIndex("by_run_and_unit", (q) => q.eq("runId", runId))
      .take(500);
    if (rows.length === 0) return;
    for (const row of rows) {
      await ctx.db.delete(row._id);
    }
  }
}

async function deleteCourseArtifacts(
  ctx: MutationCtx,
  courseId: Id<"courses">
): Promise<void> {
  while (true) {
    const units = await ctx.db
      .query("microUnits")
      .withIndex("by_course", (q) => q.eq("courseId", courseId))
      .take(500);
    if (units.length === 0) break;
    for (const unit of units) {
      await ctx.db.delete(unit._id);
    }
  }

  while (true) {
    const questions = await ctx.db
      .query("questions")
      .withIndex("by_course", (q) => q.eq("courseId", courseId))
      .take(1000);
    if (questions.length === 0) break;
    for (const question of questions) {
      await ctx.db.delete(question._id);
    }
  }

  await ctx.db.delete(courseId);
}

async function deleteRunHelper(
  ctx: MutationCtx,
  runId: Id<"runs">
): Promise<void> {
  const run = await ctx.db.get(runId);
  if (!run) appError(AppErrorCode.RUN_NOT_FOUND);

  await unlinkSourceDocsForRun(ctx, runId);
  await deleteRowsByRun(ctx, "inventoryItems", runId);
  await deleteRowsByRun(ctx, "courseOutlines", runId);
  await deleteRowsByRun(ctx, "runAssetSelections", runId);
  await deleteRowsByRun(ctx, "reviewItems", runId);
  await deleteRowsByRun(ctx, "runEvents", runId);
  await deleteRowsByRun(ctx, "llmCalls", runId);
  await deleteRowsByRun(ctx, "ttsCalls", runId);
  await deleteRowsByRun(ctx, "courseVersions", runId);
  await deleteUnitAuthoringsForRun(ctx, runId);

  if (run.courseId !== undefined) {
    await deleteCourseArtifacts(ctx, run.courseId);
  }

  await ctx.db.delete(runId);
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

/**
 * Permanently delete a course generation and all run-scoped artifacts.
 * Source docs are retained and unlinked so they can be reused.
 */
export const adminDeleteRun = mutation({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    await deleteRunHelper(ctx, args.runId);
    return null;
  },
});

/** Admin-only public wrapper for decideGate. */
export const adminDecideGate = mutation({
  args: {
    runId: v.id("runs"),
    gate: actionableGateValidator,
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
