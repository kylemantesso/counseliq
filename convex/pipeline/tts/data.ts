import { v } from "convex/values";
import { unitTimingSchema } from "@counseliq/course-schema";
import { internalMutation, internalQuery } from "../../_generated/server";
import type { QueryCtx } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import { AppErrorCode, appError } from "../../errors";
import { replaceGate3FailedUnitItems, type FailedUnitItem } from "../reviewItems";

/**
 * Queries/mutations backing the GENERATING_ASSETS synthesis actions (M5).
 * Actions have no ctx.db, so everything they read or write goes through
 * these thin, validated entry points.
 */

/** Course voice + institution voice config as synthesis sees them. */
export interface RunVoiceContext {
  /** From courses.definitionMeta.voice (assembled definition). */
  voiceRef: string | null;
  lexicon: Record<string, string>;
  /** From institutions.voiceConfig (operator-selected provider voice). */
  voiceConfig: { provider: string; voiceRef: string; voiceId: string } | null;
}

async function loadRunVoiceContext(
  ctx: QueryCtx,
  runId: Id<"runs">
): Promise<{ courseId: Id<"courses">; voice: RunVoiceContext }> {
  const run = await ctx.db.get(runId);
  if (!run) appError(AppErrorCode.RUN_NOT_FOUND);
  if (!run.courseId) appError(AppErrorCode.COURSE_NOT_FOUND);
  const course = await ctx.db.get(run.courseId);
  if (!course) appError(AppErrorCode.COURSE_NOT_FOUND);
  const institution = await ctx.db.get(course.institutionId);
  const meta = course.definitionMeta as
    | {
        voice?: { voiceRef?: string; pronunciationLexicon?: Record<string, string> };
      }
    | undefined;
  return {
    courseId: course._id,
    voice: {
      voiceRef: meta?.voice?.voiceRef ?? null,
      lexicon: meta?.voice?.pronunciationLexicon ?? {},
      voiceConfig: institution?.voiceConfig ?? null,
    },
  };
}

/**
 * durationMs per catalogued video asset id, for media-window computation.
 * Non-id refs (legacy fixture strings) and duration-less assets (images)
 * are silently absent from the result.
 */
export const getAssetDurations = internalQuery({
  args: { assetIds: v.array(v.string()) },
  handler: async (ctx, args): Promise<Record<string, number>> => {
    const out: Record<string, number> = {};
    for (const id of new Set(args.assetIds)) {
      const normalized = ctx.db.normalizeId("assets", id);
      if (!normalized) continue;
      const asset = await ctx.db.get(normalized);
      if (asset?.durationMs !== undefined) out[id] = asset.durationMs;
    }
    return out;
  },
});

/** One unit + the run's voice context (per-unit synthesis input). */
export const getUnitTtsContext = internalQuery({
  args: { runId: v.id("runs"), unitId: v.id("microUnits") },
  handler: async (ctx, args) => {
    const { courseId, voice } = await loadRunVoiceContext(ctx, args.runId);
    const unit = await ctx.db.get(args.unitId);
    if (!unit || unit.courseId !== courseId) {
      appError(AppErrorCode.COURSE_NOT_FOUND);
    }
    return { unit, voice };
  },
});

/** All units of the run's course + voice context (orchestrator input). */
export const getRunTtsOverview = internalQuery({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    const { courseId, voice } = await loadRunVoiceContext(ctx, args.runId);
    const units = await ctx.db
      .query("microUnits")
      .withIndex("by_course", (q) => q.eq("courseId", courseId))
      .take(1000);
    return {
      voice,
      units: units.map((unit) => ({
        _id: unit._id,
        unitKey: unit.unitKey,
        state: unit.state,
        error: unit.error ?? null,
        timingGeneratedAt:
          (unit.timing as { generatedAt?: number } | undefined)?.generatedAt ??
          null,
      })),
    };
  },
});

export const getTtsSentenceByHash = internalQuery({
  args: { sentenceHash: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("ttsSentences")
      .withIndex("by_sentence_hash", (q) =>
        q.eq("sentenceHash", args.sentenceHash)
      )
      .first();
  },
});

const spokenWordValidator = v.object({
  text: v.string(),
  startMs: v.number(),
  endMs: v.number(),
  charStart: v.number(),
  charEnd: v.number(),
});

/** Idempotent upsert of a synthesised sentence into the cross-run cache. */
export const saveTtsSentence = internalMutation({
  args: {
    sentenceHash: v.string(),
    audioKey: v.string(),
    durationMs: v.number(),
    words: v.array(spokenWordValidator),
    characters: v.number(),
    provider: v.string(),
    model: v.string(),
    voiceId: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("ttsSentences")
      .withIndex("by_sentence_hash", (q) =>
        q.eq("sentenceHash", args.sentenceHash)
      )
      .first();
    if (existing) {
      await ctx.db.replace(existing._id, args);
      return existing._id;
    }
    return await ctx.db.insert("ttsSentences", args);
  },
});

/** Idempotent registry row for an uploaded TTS audio artifact. */
export const recordTtsAudioAsset = internalMutation({
  args: {
    objectKey: v.string(),
    sourceProvenance: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("assets")
      .withIndex("by_object_key", (q) => q.eq("objectKey", args.objectKey))
      .first();
    if (existing) return null;
    await ctx.db.insert("assets", {
      objectKey: args.objectKey,
      kind: "tts-audio",
      sourceProvenance: args.sourceProvenance,
    });
    return null;
  },
});

/**
 * Persist a unit's timing artifact. The artifact is schema-validated here —
 * the single write path — so nothing invalid ever lands on microUnits.timing.
 * Success also clears any stale gate-3 failed_unit review item for the unit
 * (a per-unit retry succeeds outside runAssetGeneration's item refresh), in
 * the same transaction as the state change.
 */
export const saveUnitTiming = internalMutation({
  args: {
    runId: v.id("runs"),
    unitId: v.id("microUnits"),
    timing: v.any(),
    contentHash: v.string(),
  },
  handler: async (ctx, args) => {
    const timing = unitTimingSchema.parse(args.timing);
    const unit = await ctx.db.get(args.unitId);
    if (!unit) appError(AppErrorCode.COURSE_NOT_FOUND);
    await ctx.db.patch(args.unitId, {
      timing,
      contentHash: args.contentHash,
      state: "assets_ready",
      error: undefined,
    });
    const gate3Items = await ctx.db
      .query("reviewItems")
      .withIndex("by_run_and_gate", (q) =>
        q.eq("runId", args.runId).eq("gate", 3)
      )
      .take(1000);
    for (const item of gate3Items) {
      if (
        item.kind === "failed_unit" &&
        (item.payload as { unitKey?: string }).unitKey === unit.unitKey
      ) {
        await ctx.db.delete(item._id);
      }
    }
    return null;
  },
});

/** Per-unit synthesis failure marker (unit keeps its prior state). */
export const setUnitTtsError = internalMutation({
  args: {
    unitId: v.id("microUnits"),
    error: v.object({ retryable: v.boolean(), cause: v.string() }),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.unitId, { error: args.error });
    return null;
  },
});

/** Replace gate-3 failed_unit review items after an asset-generation pass. */
export const setGate3FailedUnitItems = internalMutation({
  args: {
    runId: v.id("runs"),
    items: v.array(
      v.object({
        unitKey: v.string(),
        moduleKey: v.string(),
        concept: v.string(),
        cause: v.string(),
        retryable: v.boolean(),
      })
    ),
  },
  handler: async (ctx, args) => {
    await replaceGate3FailedUnitItems(
      ctx,
      args.runId,
      args.items as FailedUnitItem[]
    );
    return null;
  },
});

/** Units with a synthesis error, shaped as failed_unit review-item payloads. */
export const getFailedUnitDetails = internalQuery({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    const { courseId } = await loadRunVoiceContext(ctx, args.runId);
    const units = await ctx.db
      .query("microUnits")
      .withIndex("by_course", (q) => q.eq("courseId", courseId))
      .take(1000);
    return units
      .filter((unit) => unit.error !== undefined)
      .map((unit) => ({
        unitKey: unit.unitKey,
        moduleKey: unit.moduleKey,
        concept: unit.concept,
        cause: unit.error!.cause,
        retryable: unit.error!.retryable,
      }));
  },
});

/** ttsCalls rows for a run (cost/character reporting). */
export const listTtsCallsForRun = internalQuery({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("ttsCalls")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .take(5000);
  },
});
