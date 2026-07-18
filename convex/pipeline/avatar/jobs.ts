import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "../../_generated/server";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import { internal } from "../../_generated/api";
import { AppErrorCode, appError } from "../../errors";
import { requireAdmin } from "../../admin";
import { applyRunTransition } from "../transitions";
import type { CoursePresentation } from "@counseliq/course-schema";

const MAX_ATTEMPTS = 3;

type AvatarPresentation = Extract<CoursePresentation, { mode: "avatar" }>;

function avatarPresentation(value: unknown): AvatarPresentation | null {
  if (!value || typeof value !== "object") return null;
  const presentation = (value as { presentation?: unknown }).presentation;
  if (!presentation || typeof presentation !== "object") return null;
  return (presentation as { mode?: string }).mode === "avatar"
    ? (presentation as AvatarPresentation)
    : null;
}

function avatarInputHash(unitId: string, audioKey: string, lookId: string, engine: string) {
  return `avatar:v2:${unitId}:${audioKey}:${lookId}:${engine}:9x16:1080p`;
}

const lookInputValidator = v.object({
  groupId: v.string(),
  lookId: v.string(),
  name: v.string(),
  previewImageUrl: v.optional(v.union(v.string(), v.null())),
  preferredOrientation: v.optional(
    v.union(v.literal("portrait"), v.literal("landscape"), v.literal("square"), v.null())
  ),
  supportedEngines: v.optional(v.array(v.string())),
  avatarType: v.optional(
    v.union(
      v.literal("photo_avatar"),
      v.literal("digital_twin"),
      v.literal("studio_avatar")
    )
  ),
});

const assignmentInputValidator = v.object({
  look: lookInputValidator,
  source: v.union(v.literal("ai"), v.literal("fallback")),
  reason: v.string(),
  promptVersion: v.optional(v.string()),
  model: v.optional(v.string()),
  assignedAt: v.number(),
});

export const prepareAvatarGeneration = internalMutation({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run?.courseId) appError(AppErrorCode.COURSE_NOT_FOUND);
    const course = await ctx.db.get(run.courseId);
    if (!course) appError(AppErrorCode.COURSE_NOT_FOUND);
    if (!avatarPresentation(course.definitionMeta)) return { enabled: false, queued: 0 };

    const units = await ctx.db
      .query("microUnits")
      .withIndex("by_course", (q) => q.eq("courseId", course._id))
      .take(500);
    const queued = units.filter(
      (unit) => unit.state === "assets_ready" && Boolean(unit.audioKey)
    ).length;
    return { enabled: true, queued };
  },
});

export const createQueuedAvatarJobs = internalMutation({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run?.courseId) appError(AppErrorCode.COURSE_NOT_FOUND);
    const course = await ctx.db.get(run.courseId);
    if (!course) appError(AppErrorCode.COURSE_NOT_FOUND);
    const presentation = avatarPresentation(course.definitionMeta);
    if (!presentation) return { queued: 0 };
    const units = await ctx.db
      .query("microUnits")
      .withIndex("by_course", (q) => q.eq("courseId", course._id))
      .take(500);
    const compatibleLooks = (
      await ctx.db
        .query("avatarLooks")
        .withIndex("by_provider_and_group", (q) =>
          q.eq("provider", "heygen").eq("groupId", presentation.avatarGroupId)
        )
        .take(100)
    ).filter(
      (look) =>
        look.lookId !== look.groupId &&
        (look.status === null || look.status === undefined || look.status === "completed") &&
        look.supportedEngines.includes(presentation.engine)
    );
    const compatibleLookIds = new Set(compatibleLooks.map((look) => look.lookId));
    const fallbackLookRow =
      compatibleLooks.find((look) => look.lookId === presentation.defaultLook.lookId) ??
      compatibleLooks[0] ??
      null;
    const fallbackLook = fallbackLookRow
      ? {
          groupId: fallbackLookRow.groupId,
          lookId: fallbackLookRow.lookId,
          name: fallbackLookRow.name,
          previewImageUrl: fallbackLookRow.previewImageUrl ?? null,
          preferredOrientation: fallbackLookRow.preferredOrientation ?? null,
          supportedEngines: fallbackLookRow.supportedEngines,
        }
      : null;
    let queued = 0;
    for (const [unitIndex, unit] of units.entries()) {
      if (!unit.audioKey || unit.state !== "assets_ready") continue;
      const selectedLook =
        presentation.unitAssignments?.[unit.unitKey]?.look ??
        presentation.unitLooks[unit.unitKey] ??
        presentation.moduleLooks?.[unit.moduleKey] ??
        presentation.defaultLook;
      const look = compatibleLookIds.has(selectedLook.lookId)
        ? selectedLook
        : fallbackLook;
      if (!look) continue;
      const inputHash = avatarInputHash(unit.unitKey, unit.audioKey, look.lookId, presentation.engine);
      const existing = await ctx.db
        .query("avatarJobs")
        .withIndex("by_run_and_input_hash", (q) =>
          q.eq("runId", args.runId).eq("inputHash", inputHash)
        )
        .first();
      if (existing) continue;
      await ctx.db.insert("avatarJobs", {
        runId: args.runId,
        courseId: course._id,
        unitId: unit._id,
        moduleId: unit.moduleKey,
        unitIndex,
        look,
        engine: presentation.engine,
        inputHash,
        audioKey: unit.audioKey,
        status: "queued",
        attempts: 0,
        maxAttempts: MAX_ATTEMPTS,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      queued += 1;
    }
    return { queued };
  },
});

export const listQueuedAvatarJobs = internalQuery({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) =>
    (await ctx.db
      .query("avatarJobs")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .take(500))
      .filter((job) => job.status === "queued")
      .slice(0, 8),
});

export const listActiveAvatarJobs = internalQuery({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) =>
    (await ctx.db
      .query("avatarJobs")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .take(500))
      .filter((job) => job.status === "submitted" || job.status === "processing")
      .slice(0, 20),
});

export const getAvatarSubmissionContext = internalQuery({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run?.courseId) appError(AppErrorCode.COURSE_NOT_FOUND);
    const [course, units] = await Promise.all([
      ctx.db.get(run.courseId),
      ctx.db
        .query("microUnits")
        .withIndex("by_course", (q) => q.eq("courseId", run.courseId!))
        .take(500),
    ]);
    if (!course) appError(AppErrorCode.COURSE_NOT_FOUND);
    return {
      courseTitle: course.title,
      units: units.map((unit) => ({
        unitId: unit._id,
        unitKey: unit.unitKey,
        title: unit.concept,
      })),
    };
  },
});

export const markHeyGenAudioAsset = internalMutation({
  args: { jobId: v.id("avatarJobs"), assetId: v.string() },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) return null;
    await ctx.db.patch(job._id, {
      heygenAudioAssetId: args.assetId,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const markAvatarSubmitted = internalMutation({
  args: { jobId: v.id("avatarJobs"), providerJobId: v.string() },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.status === "succeeded" || job.status === "cancelled") return null;
    await ctx.db.patch(job._id, {
      providerJobId: args.providerJobId,
      status: "submitted",
      attempts: job.attempts + 1,
      error: undefined,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const markAvatarFailure = internalMutation({
  args: {
    jobId: v.id("avatarJobs"),
    error: v.object({ code: v.string(), message: v.string(), retryable: v.boolean() }),
    incrementAttempt: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.status === "succeeded" || job.status === "cancelled") return null;
    await ctx.db.patch(job._id, {
      status: "failed",
      attempts: job.attempts + (args.incrementAttempt ? 1 : 0),
      error: args.error,
      updatedAt: Date.now(),
    });
    await maybeCompleteAvatarGeneration(ctx, job.runId);
    return null;
  },
});

export const getAvatarJobByProviderId = internalQuery({
  args: { providerJobId: v.string() },
  handler: async (ctx, args) =>
    await ctx.db
      .query("avatarJobs")
      .withIndex("by_provider_job", (q) => q.eq("providerJobId", args.providerJobId))
      .first(),
});

export const completeAvatarJob = internalMutation({
  args: {
    jobId: v.id("avatarJobs"),
    output: v.object({ objectKey: v.string(), thumbKey: v.optional(v.string()), sha256: v.string(), sizeBytes: v.number(), durationMs: v.number(), width: v.number(), height: v.number() }),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.status === "succeeded" || job.status === "cancelled") return null;
    await ctx.db.patch(job._id, { status: "succeeded", output: args.output, error: undefined, updatedAt: Date.now() });
    await maybeCompleteAvatarGeneration(ctx, job.runId);
    return null;
  },
});

export const listAvatarJobsForRun = query({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    return await ctx.db.query("avatarJobs").withIndex("by_run", (q) => q.eq("runId", args.runId)).take(500);
  },
});

async function avatarGenerationProgress(ctx: QueryCtx, runId: Id<"runs">) {
  const run = await ctx.db.get(runId);
  if (!run) appError(AppErrorCode.RUN_NOT_FOUND);
  const course = run.courseId ? await ctx.db.get(run.courseId) : null;
  const presentation = avatarPresentation(course?.definitionMeta);

  const [videoJobs, units] = await Promise.all([
    ctx.db
      .query("avatarJobs")
      .withIndex("by_run", (q) => q.eq("runId", runId))
      .take(500),
    run.courseId
      ? ctx.db
          .query("microUnits")
          .withIndex("by_course", (q) => q.eq("courseId", run.courseId!))
          .take(500)
      : Promise.resolve([]),
  ]);

  const videoByUnit = new Map(videoJobs.map((job) => [String(job.unitId), job]));
  const trackedUnitIds = new Set(videoByUnit.keys());
  const items = units
    .filter((unit) => trackedUnitIds.has(String(unit._id)))
    .map((unit) => {
      const video = videoByUnit.get(String(unit._id));
      const timing = unit.timing as { sentences?: Array<{ startMs: number; durationMs: number }> } | undefined;
      const lastSentence = timing?.sentences?.at(-1);
      const order = (unit.meta as { order?: { module?: number; unit?: number } } | undefined)?.order;
      const selectedLook =
        video?.look ??
        presentation?.unitAssignments?.[unit.unitKey]?.look ??
        presentation?.unitLooks[unit.unitKey] ??
        presentation?.moduleLooks?.[unit.moduleKey] ??
        presentation?.defaultLook ??
        null;
      return {
        unitId: unit._id,
        unitKey: unit.unitKey,
        title: unit.concept,
        moduleKey: unit.moduleKey,
        moduleTitle: unit.moduleTitle ?? null,
        moduleNumber: order?.module ?? null,
        unitNumber: order?.unit ?? null,
        lookName: selectedLook?.name ?? null,
        engine: video?.engine ?? presentation?.engine ?? null,
        narrationDurationMs: lastSentence
          ? lastSentence.startMs + lastSentence.durationMs
          : 0,
        video: video
          ? {
              jobId: video._id,
              status: video.status,
              providerJobId: video.providerJobId ?? null,
              attempts: video.attempts,
              maxAttempts: video.maxAttempts,
              lookName: video.look.name,
              engine: video.engine,
              objectKey: video.output?.objectKey ?? null,
              durationMs: video.output?.durationMs ?? null,
              width: video.output?.width ?? null,
              height: video.output?.height ?? null,
              errorCode: video.error?.code ?? null,
              updatedAt: video.updatedAt,
            }
          : null,
      };
    })
    .sort((a, b) => {
      const moduleDelta = (a.moduleNumber ?? Number.MAX_SAFE_INTEGER) - (b.moduleNumber ?? Number.MAX_SAFE_INTEGER);
      if (moduleDelta !== 0) return moduleDelta;
      const unitDelta = (a.unitNumber ?? Number.MAX_SAFE_INTEGER) - (b.unitNumber ?? Number.MAX_SAFE_INTEGER);
      return unitDelta !== 0 ? unitDelta : a.unitKey.localeCompare(b.unitKey);
    });

  const currentVideos = items.map((item) => item.video).filter((job) => job !== null);

  return {
    summary: {
      total: items.length,
      videoQueued: currentVideos.filter((job) => job.status === "queued").length,
      videoGenerating: currentVideos.filter(
        (job) => job.status === "submitted" || job.status === "processing"
      ).length,
      videoReady: currentVideos.filter((job) => job.status === "succeeded").length,
      videoFailed: currentVideos.filter(
        (job) => job.status === "failed" || job.status === "cancelled"
      ).length,
      narrationDurationMs: items.reduce(
        (total, item) => total + item.narrationDurationMs,
        0
      ),
    },
    items,
  };
}

export const getAvatarGenerationProgress = query({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    return await avatarGenerationProgress(ctx, args.runId);
  },
});

export const getAvatarGenerationProgressInternal = internalQuery({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => await avatarGenerationProgress(ctx, args.runId),
});

async function repairInvalidAvatarJobs(ctx: MutationCtx, runId: Id<"runs">) {
  const jobs = await ctx.db
    .query("avatarJobs")
    .withIndex("by_run", (q) => q.eq("runId", runId))
    .take(500);
  let repaired = 0;
  for (const job of jobs) {
    if (job.status === "succeeded" || job.status === "submitted" || job.status === "processing") {
      continue;
    }
    const catalogLook = await ctx.db
      .query("avatarLooks")
      .withIndex("by_provider_and_look", (q) =>
        q.eq("provider", "heygen").eq("lookId", job.look.lookId)
      )
      .first();
    if (catalogLook && catalogLook.lookId !== catalogLook.groupId) continue;

    const fallback = (
      await ctx.db
        .query("avatarLooks")
        .withIndex("by_provider_and_group", (q) =>
          q.eq("provider", "heygen").eq("groupId", job.look.groupId)
        )
        .take(100)
    ).find(
      (look) =>
        look.lookId !== look.groupId &&
        (look.status === null || look.status === undefined || look.status === "completed") &&
        look.supportedEngines.includes(job.engine)
    );
    const unit = await ctx.db.get(job.unitId);
    if (!fallback || !unit) continue;
    const look = {
      groupId: fallback.groupId,
      lookId: fallback.lookId,
      name: fallback.name,
      previewImageUrl: fallback.previewImageUrl ?? null,
      preferredOrientation: fallback.preferredOrientation ?? null,
      supportedEngines: fallback.supportedEngines,
    };
    await ctx.db.patch(job._id, {
      look,
      inputHash: avatarInputHash(unit.unitKey, job.audioKey, look.lookId, job.engine),
      status: "queued",
      attempts: 0,
      providerJobId: undefined,
      error: undefined,
      updatedAt: Date.now(),
    });

    const course = await ctx.db.get(job.courseId);
    const presentation = avatarPresentation(course?.definitionMeta);
    if (course && presentation) {
      const currentAssignment = presentation.unitAssignments?.[unit.unitKey];
      await ctx.db.patch(course._id, {
        definitionMeta: {
          ...(course.definitionMeta as Record<string, unknown>),
          presentation: {
            ...presentation,
            unitLooks: { ...presentation.unitLooks, [unit.unitKey]: look },
            ...(currentAssignment
              ? {
                  unitAssignments: {
                    ...presentation.unitAssignments,
                    [unit.unitKey]: { ...currentAssignment, look },
                  },
                }
              : {}),
          },
        },
      });
    }
    repaired += 1;
  }
  return repaired;
}

export const repairAvatarGeneration = internalMutation({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => ({
    repaired: await repairInvalidAvatarJobs(ctx, args.runId),
  }),
});

export async function requeueRetryableAvatarGeneration(
  ctx: MutationCtx,
  runId: Id<"runs">,
  includeNonRetryable = false
) {
  const repaired = await repairInvalidAvatarJobs(ctx, runId);
  const videoJobs = await ctx.db
    .query("avatarJobs")
    .withIndex("by_run", (q) => q.eq("runId", runId))
    .take(500);
  let videos = 0;
  for (const job of videoJobs) {
    if (
      (job.status !== "failed" && job.status !== "cancelled") ||
      (!includeNonRetryable &&
        (job.error?.retryable === false || job.attempts >= job.maxAttempts))
    ) {
      continue;
    }
    await ctx.db.patch(job._id, {
      status: "queued",
      providerJobId: undefined,
      error: undefined,
      updatedAt: Date.now(),
    });
    videos += 1;
  }
  return { videos, repaired };
}

export const retryAvatarGeneration = internalMutation({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) =>
    await requeueRetryableAvatarGeneration(ctx, args.runId, true),
});

export const retryAvatarJobs = internalMutation({
  args: { jobIds: v.array(v.id("avatarJobs")) },
  handler: async (ctx, args) => {
    const runIds = new Set<Id<"runs">>();
    let queued = 0;
    for (const jobId of args.jobIds.slice(0, 100)) {
      const initial = await ctx.db.get(jobId);
      if (!initial) continue;
      await repairInvalidAvatarJobs(ctx, initial.runId);
      const job = await ctx.db.get(jobId);
      if (
        !job ||
        (job.status !== "failed" && job.status !== "cancelled") ||
        job.attempts >= job.maxAttempts
      ) {
        continue;
      }
      await ctx.db.patch(job._id, {
        status: "queued",
        providerJobId: undefined,
        error: undefined,
        updatedAt: Date.now(),
      });
      runIds.add(job.runId);
      queued += 1;
    }
    for (const runId of runIds) {
      await ctx.scheduler.runAfter(
        0,
        internal.pipeline.avatar.heygen.dispatchQueuedAvatarJobs,
        { runId }
      );
    }
    return { queued };
  },
});

export const adminRetryAvatarGeneration = mutation({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const run = await ctx.db.get(args.runId);
    if (
      !run ||
      (run.state !== "GENERATING_AVATAR" && run.state !== "GATE_3_PREVIEW")
    ) {
      appError(AppErrorCode.RUN_TRANSITION_INVALID);
    }
    const requeued = await requeueRetryableAvatarGeneration(ctx, args.runId, true);
    await ctx.scheduler.runAfter(
      0,
      internal.pipeline.avatar.heygen.dispatchQueuedAvatarJobs,
      { runId: args.runId }
    );
    return requeued;
  },
});

export const adminSetUnitLook = mutation({
  args: { runId: v.id("runs"), unitId: v.string(), look: lookInputValidator },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const run = await ctx.db.get(args.runId);
    if (!run?.courseId || run.state !== "GATE_2_COURSE_REVIEW") appError(AppErrorCode.RUN_NOT_AT_GATE);
    const course = await ctx.db.get(run.courseId);
    if (!course) appError(AppErrorCode.COURSE_NOT_FOUND);
    const presentation = avatarPresentation(course.definitionMeta);
    if (!presentation) appError(AppErrorCode.RUN_TRANSITION_INVALID);
    const units = await ctx.db
      .query("microUnits")
      .withIndex("by_course", (q) => q.eq("courseId", course._id))
      .take(500);
    if (!units.some((unit) => unit.unitKey === args.unitId)) {
      appError(AppErrorCode.RUN_TRANSITION_INVALID);
    }
    const catalogLook = await ctx.db
      .query("avatarLooks")
      .withIndex("by_provider_and_look", (q) =>
        q.eq("provider", "heygen").eq("lookId", args.look.lookId)
      )
      .first();
    if (
      !catalogLook ||
      catalogLook.groupId !== presentation.avatarGroupId ||
      (catalogLook.status !== null && catalogLook.status !== "completed") ||
      !catalogLook.supportedEngines.includes(presentation.engine)
    ) {
      appError(AppErrorCode.AVATAR_LOOK_INVALID);
    }
    const look: AvatarPresentation["defaultLook"] = {
      groupId: catalogLook.groupId,
      lookId: catalogLook.lookId,
      name: catalogLook.name,
      previewImageUrl: catalogLook.previewImageUrl ?? null,
      preferredOrientation: catalogLook.preferredOrientation ?? null,
      supportedEngines: catalogLook.supportedEngines,
    };
    const assignment = {
      look,
      source: "manual" as const,
      reason: "Manually selected during course review.",
      assignedAt: Date.now(),
      manuallyLocked: true,
    };
    await ctx.db.patch(course._id, {
      definitionMeta: {
        ...(course.definitionMeta as Record<string, unknown>),
        presentation: {
          ...presentation,
          unitLooks: { ...presentation.unitLooks, [args.unitId]: look },
          unitAssignments: {
            ...(presentation.unitAssignments ?? {}),
            [args.unitId]: assignment,
          },
        },
      },
    });
    return null;
  },
});

export const saveUnitLookAssignments = internalMutation({
  args: {
    runId: v.id("runs"),
    assignments: v.record(v.string(), assignmentInputValidator),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run?.courseId) appError(AppErrorCode.COURSE_NOT_FOUND);
    const course = await ctx.db.get(run.courseId);
    if (!course) appError(AppErrorCode.COURSE_NOT_FOUND);
    const presentation = avatarPresentation(course.definitionMeta);
    if (!presentation) return null;
    const currentAssignments = presentation.unitAssignments ?? {};
    const accepted = Object.fromEntries(
      Object.entries(args.assignments).filter(
        ([unitId]) => !currentAssignments[unitId]?.manuallyLocked
      )
    );
    const looks = Object.fromEntries(
      Object.entries(accepted).map(([unitId, assignment]) => [unitId, assignment.look])
    );
    await ctx.db.patch(course._id, {
      definitionMeta: {
        ...(course.definitionMeta as Record<string, unknown>),
        presentation: {
          ...presentation,
          unitLooks: { ...presentation.unitLooks, ...looks },
          unitAssignments: { ...currentAssignments, ...accepted },
        },
      },
    });
    return null;
  },
});

export const adminRetryAvatarJob = mutation({
  args: { jobId: v.id("avatarJobs") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const initialJob = await ctx.db.get(args.jobId);
    if (initialJob) await repairInvalidAvatarJobs(ctx, initialJob.runId);
    const job = await ctx.db.get(args.jobId);
    if (job?.status === "queued") {
      await ctx.scheduler.runAfter(0, internal.pipeline.avatar.heygen.dispatchQueuedAvatarJobs, {
        runId: job.runId,
      });
      return null;
    }
    if (!job || (job.status !== "failed" && job.status !== "cancelled")) {
      appError(AppErrorCode.AVATAR_GENERATION_FAILED);
    }
    await ctx.db.patch(job._id, {
      status: "queued",
      providerJobId: undefined,
      error: undefined,
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.pipeline.avatar.heygen.dispatchQueuedAvatarJobs, {
      runId: job.runId,
    });
    return null;
  },
});

export const recordWebhookEvent = internalMutation({
  args: { eventId: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("avatarWebhookEvents").withIndex("by_event_id", (q) => q.eq("eventId", args.eventId)).first();
    if (existing) return false;
    await ctx.db.insert("avatarWebhookEvents", { eventId: args.eventId, receivedAt: Date.now() });
    return true;
  },
});

async function maybeCompleteAvatarGeneration(ctx: MutationCtx, runId: Id<"runs">) {
  const run = await ctx.db.get(runId);
  if (!run || run.state !== "GENERATING_AVATAR") return;
  const videos = await ctx.db.query("avatarJobs").withIndex("by_run", (q) => q.eq("runId", runId)).take(500);
  if (videos.length === 0) return;
  const allTerminal = videos.every((job) => job.status === "succeeded" || job.status === "failed" || job.status === "cancelled");
  if (!allTerminal) return;
  await applyRunTransition(ctx, {
    runId,
    toState: "GATE_3_PREVIEW",
    actor: "avatar-workflow",
    detail: `avatar generation complete — ${videos.filter((job) => job.status === "succeeded").length}/${videos.length} video(s) ready`,
  });
}
