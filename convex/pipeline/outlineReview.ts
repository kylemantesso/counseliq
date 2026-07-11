import { start } from "@convex-dev/workflow";
import { v } from "convex/values";
import type { Concept } from "@counseliq/course-schema";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "../_generated/server";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { AppErrorCode, appError } from "../errors";
import { requireAdmin } from "../admin";
import { applyRunTransition } from "./transitions";
import {
  getExplicitRunAssetIds,
  getRunCatalogueAssets,
  isAssetCleared,
  isCatalogueAsset,
} from "./assetsCatalogue";
import {
  llmCourseOutlineSchema,
  type LlmCourseOutline,
} from "./compiler/schemas";
import {
  UNIT_RANGE_DEFAULT,
  parseRange,
} from "./compiler/assemble";

/**
 * The OUTLINE_REVIEW step (M6.5): the persisted outline is the review
 * surface (like gate 2 — no reviewItems). The operator edits it in place,
 * regenerates with feedback, or approves it into compilation. Every write
 * to `courseOutlines.modules` goes through the shared Zod contract plus
 * the same code checks the generation pass enforces — an edited outline
 * can never be worse-formed than a generated one.
 */

async function getOutlineRow(
  ctx: QueryCtx,
  runId: Id<"runs">
): Promise<Doc<"courseOutlines"> | null> {
  return await ctx.db
    .query("courseOutlines")
    .withIndex("by_run", (q) => q.eq("runId", runId))
    .unique();
}

/** Concept keys with approved facts for a run (outline validation). */
async function conceptContext(
  ctx: QueryCtx,
  runId: Id<"runs">
): Promise<{ concepts: Concept[]; conceptKeys: Set<string> }> {
  const rows = await ctx.db
    .query("inventoryItems")
    .withIndex("by_run", (q) => q.eq("runId", runId))
    .take(5000);
  const concepts = rows
    .filter((row) => row.kind === "concept")
    .map((row) => row.body as Concept);
  return { concepts, conceptKeys: new Set(concepts.map((c) => c.key)) };
}

/**
 * Code checks shared by generation-save and operator edits: concept keys
 * must exist in the run's inventory, at least one unit must be present,
 * and media suggestions must reference CLEARED catalogue assets.
 */
async function validateOutlineAgainstRun(
  ctx: QueryCtx,
  runId: Id<"runs">,
  outline: LlmCourseOutline
): Promise<void> {
  const units = outline.modules.flatMap((m) => m.units);
  const unitRange = parseRange(process.env.COMPILE_UNIT_RANGE, UNIT_RANGE_DEFAULT);
  if (units.length < 1) {
    appError(AppErrorCode.OUTLINE_INVALID);
  }
  if (units.length > unitRange[1]) {
    console.warn(
      `[pipeline] run ${runId}: outline has ${units.length} units; target is ${unitRange[0]}-${unitRange[1]} units`
    );
  }
  const { conceptKeys } = await conceptContext(ctx, runId);
  if (units.some((unit) => !conceptKeys.has(unit.conceptKey))) {
    appError(AppErrorCode.OUTLINE_INVALID);
  }
  const run = await ctx.db.get(runId);
  if (!run) appError(AppErrorCode.RUN_NOT_FOUND);
  const explicitAssetIds = await getExplicitRunAssetIds(ctx, run);
  for (const unit of units) {
    for (const assetRef of unit.mediaAssetIds ?? []) {
      const assetId = ctx.db.normalizeId("assets", assetRef);
      if (!assetId) appError(AppErrorCode.ASSET_NOT_FOUND);
      const asset = await ctx.db.get(assetId);
      if (
        !asset ||
        !isCatalogueAsset(asset) ||
        asset.institutionId !== run.institutionId ||
        (explicitAssetIds !== null && !explicitAssetIds.has(assetId))
      ) {
        appError(AppErrorCode.ASSET_NOT_FOUND);
      }
      if (!isAssetCleared(asset)) appError(AppErrorCode.ASSET_NOT_CLEARED);
    }
  }
}

/** Context the generation action needs (brief + accumulated feedback). */
export const getOutlineGenerationContext = internalQuery({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) appError(AppErrorCode.RUN_NOT_FOUND);
    const outline = await getOutlineRow(ctx, args.runId);
    return {
      brief: run.brief,
      regenFeedback: outline?.regenFeedback ?? [],
    };
  },
});

/** The approved outline for compilation (null = legacy inline structure). */
export const getApprovedOutlineForRun = internalQuery({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    const outline = await getOutlineRow(ctx, args.runId);
    if (!outline || outline.status !== "approved") return null;
    return {
      courseTitle: outline.courseTitle,
      learningOutcomes: outline.learningOutcomes,
      modules: outline.modules as LlmCourseOutline["modules"],
      brief: outline.brief ?? null,
    };
  },
});

/**
 * Single validated write path for the generation pass. Upserts the run's
 * one outline row as an editable draft; regeneration replaces the draft
 * (the UI warns that manual edits are lost) but preserves the feedback
 * trail and the run's brief.
 */
export const saveCourseOutline = internalMutation({
  args: {
    runId: v.id("runs"),
    outline: v.any(),
    promptVersion: v.string(),
    model: v.string(),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) appError(AppErrorCode.RUN_NOT_FOUND);
    const outline = llmCourseOutlineSchema.parse(args.outline);
    await validateOutlineAgainstRun(ctx, args.runId, outline);

    const fields = {
      brief: run.brief,
      courseTitle: outline.courseTitle,
      learningOutcomes: outline.learningOutcomes,
      modules: outline.modules,
      status: "draft",
      generatedAt: Date.now(),
      promptVersion: args.promptVersion,
      model: args.model,
      editedAt: undefined,
      editedBy: undefined,
    };
    const existing = await getOutlineRow(ctx, args.runId);
    if (existing) {
      await ctx.db.patch(existing._id, fields);
    } else {
      await ctx.db.insert("courseOutlines", { runId: args.runId, ...fields });
    }
    return null;
  },
});

/** Outline + editing context for the review screen. */
export const adminGetOutline = query({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const run = await ctx.db.get(args.runId);
    if (!run) appError(AppErrorCode.RUN_NOT_FOUND);
    const outline = await getOutlineRow(ctx, args.runId);
    const { concepts } = await conceptContext(ctx, args.runId);

    const usedConceptKeys = new Set(
      outline
        ? (outline.modules as LlmCourseOutline["modules"]).flatMap((m) =>
            m.units.map((u) => u.conceptKey)
          )
        : []
    );
    const unusedConcepts = concepts
      .filter((concept) => !usedConceptKeys.has(concept.key))
      .map((concept) => ({
        key: concept.key,
        title: concept.title,
        summary: concept.summary,
      }));

    // Display metadata for every suggested media asset (captions + thumbs).
    const suggestedIds = new Set(
      outline
        ? (outline.modules as LlmCourseOutline["modules"]).flatMap((m) =>
            m.units.flatMap((u) => u.mediaAssetIds ?? [])
          )
        : []
    );
    const suggestedAssets: Record<
      string,
      { caption: string | null; thumbKey: string | null; kind: string }
    > = {};
    for (const ref of suggestedIds) {
      const assetId = ctx.db.normalizeId("assets", ref);
      if (!assetId) continue;
      const asset = await ctx.db.get(assetId);
      if (!asset) continue;
      suggestedAssets[ref] = {
        caption: asset.caption ?? null,
        thumbKey:
          asset.thumbKey ?? (asset.kind === "image" ? asset.objectKey : null),
        kind: asset.kind,
      };
    }

    // Every cleared catalogue asset (compact), so the editor can add media
    // suggestions — same clearance predicate as everywhere else.
    const runAssets = await getRunCatalogueAssets(ctx, run);
    const clearedAssets = runAssets
      .filter(
        (asset) =>
          isCatalogueAsset(asset) &&
          isAssetCleared(asset)
      )
      .slice(0, 150)
      .map((asset) => ({
        id: String(asset._id),
        kind: asset.kind,
        caption: asset.caption ?? null,
      }));

    return {
      runState: run.state,
      brief: run.brief ?? null,
      outline,
      unusedConcepts,
      suggestedAssets,
      clearedAssets,
    };
  },
});

/** Operator edit: full replacement of title/outcomes/modules, validated. */
export const adminUpdateOutline = mutation({
  args: {
    runId: v.id("runs"),
    courseTitle: v.string(),
    learningOutcomes: v.array(v.string()),
    modules: v.any(),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const run = await ctx.db.get(args.runId);
    if (!run) appError(AppErrorCode.RUN_NOT_FOUND);
    if (run.state !== "OUTLINE_REVIEW") appError(AppErrorCode.RUN_NOT_AT_GATE);
    const existing = await getOutlineRow(ctx, args.runId);
    if (!existing) appError(AppErrorCode.OUTLINE_NOT_FOUND);

    const outline = llmCourseOutlineSchema.parse({
      courseTitle: args.courseTitle,
      learningOutcomes: args.learningOutcomes,
      modules: args.modules,
    });
    await validateOutlineAgainstRun(ctx, args.runId, outline);

    await ctx.db.patch(existing._id, {
      courseTitle: outline.courseTitle,
      learningOutcomes: outline.learningOutcomes,
      modules: outline.modules,
      editedAt: Date.now(),
      editedBy: admin.email,
    });
    return null;
  },
});

async function approveOutlineHelper(
  ctx: MutationCtx,
  runId: Id<"runs">,
  actor: string
): Promise<void> {
  const run = await ctx.db.get(runId);
  if (!run) appError(AppErrorCode.RUN_NOT_FOUND);
  if (run.state !== "OUTLINE_REVIEW") appError(AppErrorCode.RUN_NOT_AT_GATE);
  const outline = await getOutlineRow(ctx, runId);
  if (!outline) appError(AppErrorCode.OUTLINE_NOT_FOUND);

  await ctx.db.patch(outline._id, { status: "approved" });
  await applyRunTransition(ctx, {
    runId,
    toState: "COMPILING",
    actor,
    detail: "outline approved: authoring course from the reviewed outline",
  });
  await start(ctx, internal.pipeline.workflows.compileAndJudge, { runId });
}

/** Internal sibling for scripts/walkthroughs (mirrors decideGate). */
export const approveOutline = internalMutation({
  args: { runId: v.id("runs"), reviewer: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await approveOutlineHelper(ctx, args.runId, args.reviewer ?? "system");
    return null;
  },
});

export const adminApproveOutline = mutation({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    await approveOutlineHelper(ctx, args.runId, admin.email);
    return null;
  },
});

async function regenerateOutlineHelper(
  ctx: MutationCtx,
  runId: Id<"runs">,
  feedback: string,
  actor: string
): Promise<void> {
  const run = await ctx.db.get(runId);
  if (!run) appError(AppErrorCode.RUN_NOT_FOUND);
  if (run.state !== "OUTLINE_REVIEW") appError(AppErrorCode.RUN_NOT_AT_GATE);
  const outline = await getOutlineRow(ctx, runId);
  if (!outline) appError(AppErrorCode.OUTLINE_NOT_FOUND);
  const note = feedback.trim();
  if (note === "") appError(AppErrorCode.OUTLINE_INVALID);

  await ctx.db.patch(outline._id, {
    regenFeedback: [...(outline.regenFeedback ?? []), note],
  });
  await applyRunTransition(ctx, {
    runId,
    toState: "OUTLINING",
    actor,
    detail: "outline regeneration requested with feedback",
  });
  await start(ctx, internal.pipeline.workflows.generateOutline, { runId });
}

/** Internal sibling for scripts. */
export const regenerateOutline = internalMutation({
  args: {
    runId: v.id("runs"),
    feedback: v.string(),
    reviewer: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await regenerateOutlineHelper(
      ctx,
      args.runId,
      args.feedback,
      args.reviewer ?? "system"
    );
    return null;
  },
});

export const adminRegenerateOutline = mutation({
  args: { runId: v.id("runs"), feedback: v.string() },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    await regenerateOutlineHelper(ctx, args.runId, args.feedback, admin.email);
    return null;
  },
});
