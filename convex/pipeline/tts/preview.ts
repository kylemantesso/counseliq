import { v } from "convex/values";
import type { UnitScript, UnitTiming } from "@counseliq/course-schema";
import { TIMING_VERSION } from "@counseliq/course-schema";
import { internalQuery, query } from "../../_generated/server";
import type { QueryCtx } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import { requireAdmin } from "../../admin";
import { getCourseRowsForRun } from "../courses";

/**
 * Gate-3 preview data (M5): everything the studio review surface needs in one
 * reactive query — ordered modules/units with narration, cards, scripts and
 * timing artifacts, the institution's brand tokens for theming, and the
 * blocked/failed review items that gate approval.
 *
 * Audio itself is NOT presigned here (URLs must never sit in query results);
 * the client batch-presigns unitAudioKey via objectStore.adminPresignGetBatch.
 */

interface PreviewUnit {
  _id: Id<"microUnits">;
  unitKey: string;
  concept: string;
  state: Doc<"microUnits">["state"];
  error: { retryable: boolean; cause: string } | null;
  narration: unknown;
  cards: unknown;
  meta: unknown;
  script: unknown;
  timing: unknown;
  qa: unknown;
  avatarTrack?: { objectKey: string; durationMs: number } | null;
}

interface PreviewModule {
  moduleKey: string;
  moduleTitle: string;
  units: PreviewUnit[];
}

/**
 * A stored timing artifact from an older TIMING_VERSION is surfaced as
 * absent (the studio shows the unit as needing re-synthesis) rather than
 * crashing a consumer that reads current-version fields. The contentHash
 * embeds TIMING_VERSION, so the next GENERATING_ASSETS pass rebuilds it.
 */
function currentVersionTiming(timing: unknown): unknown {
  if (
    timing !== null &&
    typeof timing === "object" &&
    (timing as { version?: unknown }).version === TIMING_VERSION
  ) {
    return timing;
  }
  return null;
}

async function buildRunPreview(ctx: QueryCtx, runId: Id<"runs">) {
  const rows = await getCourseRowsForRun(ctx, runId);
  if (!rows) return null;
  const { run, course, units, questions } = rows;
  const institution = await ctx.db.get(course.institutionId);
  const avatarJobs = await ctx.db
    .query("avatarJobs")
    .withIndex("by_run", (q) => q.eq("runId", runId))
    .take(500);
  const avatarByUnit = new Map(
    avatarJobs
      .filter((job) => job.status === "succeeded" && job.output)
      .map((job) => [String(job.unitId), job.output!])
  );

  // Units arrive ordered by (module, unit) from getCourseRowsForRun; group
  // them into modules the same way the gate-2 viewer does.
  const modules: PreviewModule[] = [];
  for (const unit of units) {
    let module = modules.find((m) => m.moduleKey === unit.moduleKey);
    if (!module) {
      module = {
        moduleKey: unit.moduleKey,
        moduleTitle: unit.moduleTitle ?? unit.moduleKey,
        units: [],
      };
      modules.push(module);
    }
    module.units.push({
      _id: unit._id,
      unitKey: unit.unitKey,
      concept: unit.concept,
      state: unit.state,
      error: unit.error ?? null,
      narration: unit.narration,
      cards: unit.cards,
      meta: unit.meta,
      script: unit.script ?? null,
      timing: currentVersionTiming(unit.timing),
      qa: unit.qa ?? null,
      avatarTrack: (() => {
        const output = avatarByUnit.get(String(unit._id));
        return output ? { objectKey: output.objectKey, durationMs: output.durationMs } : null;
      })(),
    });
  }

  let ready = 0;
  let blocked = 0;
  let failed = 0;
  let totalDurationMs = 0;
  let totalCharacters = 0;
  for (const unit of units) {
    if (unit.state === "blocked") blocked += 1;
    else if (unit.error !== undefined) failed += 1;
    else if (unit.state === "assets_ready" || unit.state === "published") {
      ready += 1;
    }
    const timing = currentVersionTiming(unit.timing) as UnitTiming | null;
    if (timing?.totalDurationMs) totalDurationMs += timing.totalDurationMs;
    const script = unit.script as UnitScript | undefined;
    if (script) {
      totalCharacters += script.sentences.reduce(
        (sum, sentence) => sum + sentence.speakText.length,
        0
      );
    }
  }

  // assetRef → object-store keys for every media card/anchor in the course
  // (M6). Keys only — presigning stays with the client's batch action.
  const assetRefs = new Set<string>();
  const collectRefs = (cards: unknown) => {
    if (!Array.isArray(cards)) return;
    for (const card of cards) {
      const props = (card as { props?: { assetRef?: unknown; bgAssetRef?: unknown } })
        .props;
      if (typeof props?.assetRef === "string" && props.assetRef.length > 0) {
        assetRefs.add(props.assetRef);
      }
      if (
        typeof props?.bgAssetRef === "string" &&
        props.bgAssetRef.length > 0
      ) {
        assetRefs.add(props.bgAssetRef);
      }
    }
  };
  for (const unit of units) {
    collectRefs(unit.cards);
    const anchor = (unit.meta as {
      anchor?: { props?: { assetRef?: unknown; bgAssetRef?: unknown } };
    } | undefined)?.anchor;
    if (typeof anchor?.props?.assetRef === "string") {
      assetRefs.add(anchor.props.assetRef);
    }
    if (typeof anchor?.props?.bgAssetRef === "string") {
      assetRefs.add(anchor.props.bgAssetRef);
    }
  }
  const assets: Record<
    string,
    { objectKey: string; thumbKey?: string; kind: string; durationMs?: number }
  > = {};
  for (const ref of assetRefs) {
    const assetId = ctx.db.normalizeId("assets", ref);
    if (!assetId) continue;
    const asset = await ctx.db.get(assetId);
    if (!asset || (asset.kind !== "image" && asset.kind !== "video")) continue;
    assets[ref] = {
      objectKey: asset.objectKey,
      ...(asset.thumbKey !== undefined ? { thumbKey: asset.thumbKey } : {}),
      kind: asset.kind,
      ...(asset.durationMs !== undefined ? { durationMs: asset.durationMs } : {}),
    };
  }

  const gate3Items = await ctx.db
    .query("reviewItems")
    .withIndex("by_run_and_gate", (q) => q.eq("runId", runId).eq("gate", 3))
    .take(1000);

  const meta = course.definitionMeta as
    | {
        courseId?: string;
        brandRef?: string;
        language?: string;
        voice?: unknown;
        ttsVoice?: unknown;
      }
    | undefined;

  return {
    run: { state: run.state, promptVersions: run.promptVersions },
    course: {
      _id: course._id,
      title: course.title,
      version: course.version,
      level: course.level,
      status: course.status,
      courseId: meta?.courseId ?? null,
      brandRef: meta?.brandRef ?? null,
      language: meta?.language ?? null,
      voice: meta?.voice ?? null,
      ttsVoice: meta?.ttsVoice ?? null,
    },
    institution: institution
      ? {
          name: institution.name,
          brandTokens: institution.brandTokens,
          voiceConfig: institution.voiceConfig ?? null,
        }
      : null,
    modules,
    assets,
    questions: questions.map((q) => ({
      _id: q._id,
      conceptTag: q.conceptTag,
      body: q.body,
    })),
    summary: {
      ready,
      blocked,
      failed,
      total: units.length,
      totalDurationMs,
      totalCharacters,
    },
    gate3Items: gate3Items.map((item) => ({
      _id: item._id,
      kind: item.kind,
      status: item.status,
      payload: item.payload,
    })),
  };
}

/** Admin: the gate-3 studio's single data source. */
export const adminGetRunPreview = query({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    return await buildRunPreview(ctx, args.runId);
  },
});

/** Internal sibling for the walkthrough/eval harnesses. */
export const getRunPreviewInternal = internalQuery({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    return await buildRunPreview(ctx, args.runId);
  },
});
