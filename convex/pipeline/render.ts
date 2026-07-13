import { v } from "convex/values";
import {
  type RenderFailurePayload,
  type RenderProfile,
  type RenderVariantProfile,
  renderJobRequestSchema,
} from "@counseliq/course-schema";
import { internalAction, internalMutation, internalQuery, mutation, query } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { AppErrorCode, appError } from "../errors";
import { requireAdmin } from "../admin";
import { hmacSha256Hex, SIGNATURE_HEADER } from "./hmac";

export const DEFAULT_RENDER_PROFILE: RenderProfile = {
  container: "mp4",
  width: 1080,
  height: 1920,
  fps: 30,
  videoCodec: "h264",
  audioCodec: "aac",
};

export const DEFAULT_RENDER_VARIANTS: RenderVariantProfile[] = [
  { ...DEFAULT_RENDER_PROFILE, label: "legacy-16x9-1080x1920" },
  { ...DEFAULT_RENDER_PROFILE, label: "tall-18x9-1080x2160", height: 2160 },
  { ...DEFAULT_RENDER_PROFILE, label: "android-19_5x9-1080x2340", height: 2340 },
  { ...DEFAULT_RENDER_PROFILE, label: "android-20x9-1080x2400", height: 2400 },
  {
    ...DEFAULT_RENDER_PROFILE,
    label: "iphone-19_5x9-1290x2796",
    width: 1290,
    height: 2796,
  },
];

const renderOutputVariantValidator = v.object({
  label: v.string(),
  objectKey: v.string(),
  sha256: v.string(),
  sizeBytes: v.number(),
  durationMs: v.number(),
  width: v.number(),
  height: v.number(),
  fps: v.number(),
});

const DEFAULT_MAX_ATTEMPTS = 3;

function resolveRendererCallbackUrl(): string | null {
  const explicit = process.env.RENDERER_CALLBACK_URL;
  if (explicit && explicit.length > 0) return explicit;
  const site = process.env.CONVEX_SITE_URL;
  return site ? `${site.replace(/\/$/, "")}/renderer/callback` : null;
}

function rendererDispatchConfig(): {
  rendererUrl: string;
  callbackSecret: string;
  callbackUrl: string;
} | null {
  const rendererUrl = process.env.RENDERER_URL;
  const callbackSecret = process.env.RENDERER_CALLBACK_SECRET;
  const callbackUrl = resolveRendererCallbackUrl();
  if (!rendererUrl || !callbackSecret || !callbackUrl) {
    return null;
  }
  return { rendererUrl: rendererUrl.replace(/\/$/, ""), callbackSecret, callbackUrl };
}

export const enqueueRenderJobs = internalMutation({
  args: {
    runId: v.id("runs"),
    courseVersionId: v.id("courseVersions"),
    manifestKey: v.string(),
    exportKey: v.string(),
    specHash: v.string(),
    profile: v.optional(
      v.object({
        container: v.literal("mp4"),
        width: v.number(),
        height: v.number(),
        fps: v.number(),
        videoCodec: v.string(),
        audioCodec: v.string(),
      })
    ),
    units: v.array(
      v.object({
        unitId: v.string(),
        moduleId: v.string(),
        unitIndex: v.number(),
        contentHash: v.string(),
        renderSpecHash: v.string(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || !run.courseId) appError(AppErrorCode.RUN_NOT_FOUND);
    const courseVersion = await ctx.db.get(args.courseVersionId);
    if (!courseVersion) appError(AppErrorCode.COURSE_NOT_FOUND);
    const profile = args.profile ?? DEFAULT_RENDER_PROFILE;
    const callbackUrl = resolveRendererCallbackUrl() ?? undefined;

    let inserted = 0;
    for (const unit of args.units) {
      const existing = await ctx.db
        .query("renderJobs")
        .withIndex("by_run_and_render_spec", (q) =>
          q.eq("runId", args.runId).eq("renderSpecHash", unit.renderSpecHash)
        )
        .first();
      if (existing) continue;

      await ctx.db.insert("renderJobs", {
        runId: args.runId,
        courseId: run.courseId,
        courseVersionId: args.courseVersionId,
        institutionId: run.institutionId,
        unitId: unit.unitId,
        moduleId: unit.moduleId,
        unitIndex: unit.unitIndex,
        contentHash: unit.contentHash,
        renderSpecHash: unit.renderSpecHash,
        profile,
        manifestKey: args.manifestKey,
        exportKey: args.exportKey,
        specHash: args.specHash,
        status: "queued",
        attempts: 0,
        maxAttempts: DEFAULT_MAX_ATTEMPTS,
        ...(callbackUrl ? { callbackUrl } : {}),
      });
      inserted += 1;
    }
    return { inserted };
  },
});

export const listQueuedJobsForRun = internalQuery({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    const jobs = await ctx.db
      .query("renderJobs")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .take(500);
    return jobs
      .filter((job) => job.status === "queued")
      .sort((a, b) => a.unitIndex - b.unitIndex)
      .slice(0, 50)
      .map((job) => ({
        _id: job._id,
        runId: job.runId,
        courseVersionId: job.courseVersionId,
        unitId: job.unitId,
        moduleId: job.moduleId,
        unitIndex: job.unitIndex,
        contentHash: job.contentHash,
        renderSpecHash: job.renderSpecHash,
        manifestKey: job.manifestKey,
        exportKey: job.exportKey,
        specHash: job.specHash,
        profile: job.profile,
        attempts: job.attempts,
        maxAttempts: job.maxAttempts,
        callbackUrl: job.callbackUrl,
      }));
  },
});

export const markDispatched = internalMutation({
  args: { jobId: v.id("renderJobs") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) appError(AppErrorCode.RENDER_JOB_NOT_FOUND);
    await ctx.db.patch(args.jobId, {
      status: "dispatched",
      attempts: job.attempts + 1,
      dispatchedAt: Date.now(),
      error: undefined,
    });
    return null;
  },
});

export const markDispatchFailure = internalMutation({
  args: {
    jobId: v.id("renderJobs"),
    incrementAttempts: v.optional(v.boolean()),
    error: v.object({
      code: v.string(),
      message: v.string(),
      retryable: v.boolean(),
    }),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) appError(AppErrorCode.RENDER_JOB_NOT_FOUND);
    await ctx.db.patch(args.jobId, {
      status: "failed",
      ...(args.incrementAttempts ? { attempts: job.attempts + 1 } : {}),
      error: args.error,
      completedAt: Date.now(),
    });
    return null;
  },
});

export const dispatchQueuedForRun = internalAction({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    const jobs: Array<{
      _id: Id<"renderJobs">;
      runId: Id<"runs">;
      courseVersionId: Id<"courseVersions">;
      unitId: string;
      moduleId: string;
      unitIndex: number;
      contentHash: string;
      renderSpecHash: string;
      manifestKey: string;
      exportKey: string;
      specHash: string;
      profile: RenderProfile;
      attempts: number;
      maxAttempts: number;
      callbackUrl?: string;
    }> = await ctx.runQuery(internal.pipeline.render.listQueuedJobsForRun, {
      runId: args.runId,
    });

    if (jobs.length === 0) {
      return { queued: 0, dispatched: 0, failed: 0 };
    }

    const config = rendererDispatchConfig();
    if (!config) {
      let failed = 0;
      for (const job of jobs) {
        await ctx.runMutation(internal.pipeline.render.markDispatchFailure, {
          jobId: job._id,
          incrementAttempts: false,
          error: {
            code: "renderer_not_configured",
            message:
              "RENDERER_URL / RENDERER_CALLBACK_SECRET / renderer callback URL are not configured",
            retryable: true,
          },
        });
        failed += 1;
      }
      return { queued: jobs.length, dispatched: 0, failed };
    }

    let dispatched = 0;
    let failed = 0;
    for (const job of jobs) {
      if (job.attempts >= job.maxAttempts) {
        await ctx.runMutation(internal.pipeline.render.markDispatchFailure, {
          jobId: job._id,
          incrementAttempts: false,
          error: {
            code: "render_attempts_exhausted",
            message: `render attempts exhausted (${job.maxAttempts})`,
            retryable: false,
          },
        });
        failed += 1;
        continue;
      }

      const callbackUrl = job.callbackUrl ?? config.callbackUrl;
      const request = renderJobRequestSchema.parse({
        jobId: job._id,
        runId: job.runId,
        courseVersionId: job.courseVersionId,
        manifestKey: job.manifestKey,
        exportKey: job.exportKey,
        specHash: job.specHash,
        unitId: job.unitId,
        moduleId: job.moduleId,
        unitIndex: job.unitIndex,
        contentHash: job.contentHash,
        renderSpecHash: job.renderSpecHash,
        profile: job.profile,
        variants: DEFAULT_RENDER_VARIANTS,
        callbackUrl,
      });

      const body = JSON.stringify(request);
      const signature = await hmacSha256Hex(body, config.callbackSecret);
      const response = await fetch(`${config.rendererUrl}/render`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [SIGNATURE_HEADER]: signature,
        },
        body,
      });

      if (!response.ok) {
        await ctx.runMutation(internal.pipeline.render.markDispatchFailure, {
          jobId: job._id,
          incrementAttempts: true,
          error: {
            code: "render_dispatch_failed",
            message: `renderer dispatch failed: HTTP ${response.status}`,
            retryable: true,
          },
        });
        failed += 1;
        continue;
      }

      await ctx.runMutation(internal.pipeline.render.markDispatched, {
        jobId: job._id,
      });
      dispatched += 1;
    }

    return { queued: jobs.length, dispatched, failed };
  },
});

export const applyRenderCallback = internalMutation({
  args: {
    jobId: v.string(),
    status: v.union(v.literal("succeeded"), v.literal("failed")),
    output: v.optional(
      v.object({
        objectKey: v.string(),
        sha256: v.string(),
        sizeBytes: v.number(),
        durationMs: v.number(),
        width: v.number(),
        height: v.number(),
        fps: v.number(),
        rendererVersion: v.string(),
        renderedAt: v.number(),
        variants: v.optional(v.array(renderOutputVariantValidator)),
      })
    ),
    error: v.optional(
      v.object({
        code: v.string(),
        message: v.string(),
        retryable: v.boolean(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const jobId = ctx.db.normalizeId("renderJobs", args.jobId);
    if (!jobId) appError(AppErrorCode.RENDER_JOB_NOT_FOUND);
    const job = await ctx.db.get(jobId);
    if (!job) appError(AppErrorCode.RENDER_JOB_NOT_FOUND);

    // A cancelled job may still complete in the external renderer. Its output
    // must never resurrect a job the operator deliberately stopped.
    if (job.status === "succeeded" || job.status === "cancelled") {
      return null;
    }

    if (args.status === "succeeded") {
      if (!args.output) {
        appError(AppErrorCode.RUN_TRANSITION_INVALID);
      }
      await ctx.db.patch(jobId, {
        status: "succeeded",
        completedAt: Date.now(),
        rendererVersion: args.output.rendererVersion,
        output: {
          objectKey: args.output.objectKey,
          sha256: args.output.sha256,
          sizeBytes: args.output.sizeBytes,
          durationMs: args.output.durationMs,
          width: args.output.width,
          height: args.output.height,
          fps: args.output.fps,
          ...(args.output.variants !== undefined
            ? { variants: args.output.variants }
            : {}),
        },
        error: undefined,
      });
      return null;
    }

    const failure: RenderFailurePayload =
      args.error ?? {
        code: "render_failed",
        message: "renderer reported a failure",
        retryable: true,
      };

    await ctx.db.patch(jobId, {
      status: "failed",
      completedAt: Date.now(),
      error: failure,
    });
    return null;
  },
});

export const adminGetRunRenderStatus = query({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const jobs = await ctx.db
      .query("renderJobs")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .take(500);
    const sorted = [...jobs].sort((a, b) => a.unitIndex - b.unitIndex);
    return {
      summary: {
        total: sorted.length,
        queued: sorted.filter((job) => job.status === "queued").length,
        dispatched: sorted.filter((job) => job.status === "dispatched").length,
        rendering: sorted.filter((job) => job.status === "rendering").length,
        succeeded: sorted.filter((job) => job.status === "succeeded").length,
        failed: sorted.filter((job) => job.status === "failed").length,
        cancelled: sorted.filter((job) => job.status === "cancelled").length,
      },
      jobs: sorted.map((job) => ({
        _id: job._id,
        unitId: job.unitId,
        moduleId: job.moduleId,
        unitIndex: job.unitIndex,
        status: job.status,
        attempts: job.attempts,
        maxAttempts: job.maxAttempts,
        output: job.output ?? null,
        error: job.error ?? null,
        profile: job.profile,
        rendererVersion: job.rendererVersion ?? null,
        completedAt: job.completedAt ?? null,
      })),
    };
  },
});

export const adminRetryRenderJob = mutation({
  args: { jobId: v.id("renderJobs") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const job = await ctx.db.get(args.jobId);
    if (!job) appError(AppErrorCode.RENDER_JOB_NOT_FOUND);
    if (job.status !== "failed" || job.error?.retryable !== true) {
      appError(AppErrorCode.RENDER_JOB_NOT_RETRYABLE);
    }
    await ctx.db.patch(args.jobId, {
      status: "queued",
      error: undefined,
      completedAt: undefined,
    });
    await ctx.scheduler.runAfter(0, internal.pipeline.render.dispatchQueuedForRun, {
      runId: job.runId,
    });
    return null;
  },
});

export const adminRerenderVideo = mutation({
  args: { jobId: v.id("renderJobs") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const job = await ctx.db.get(args.jobId);
    if (!job) appError(AppErrorCode.RENDER_JOB_NOT_FOUND);
    if (
      (job.status !== "succeeded" || !job.output) &&
      job.status !== "cancelled"
    ) {
      appError(AppErrorCode.RENDER_JOB_NOT_RETRYABLE);
    }
    await ctx.db.patch(args.jobId, {
      status: "queued",
      attempts: 0,
      error: undefined,
      output: undefined,
      rendererVersion: undefined,
      dispatchedAt: undefined,
      startedAt: undefined,
      completedAt: undefined,
    });
    await ctx.scheduler.runAfter(0, internal.pipeline.render.dispatchQueuedForRun, {
      runId: job.runId,
    });
    return null;
  },
});

export const adminRestartDispatchedRenderJob = mutation({
  args: { jobId: v.id("renderJobs") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const job = await ctx.db.get(args.jobId);
    if (!job) appError(AppErrorCode.RENDER_JOB_NOT_FOUND);
    if (job.status !== "dispatched" && job.status !== "rendering") {
      appError(AppErrorCode.RENDER_JOB_NOT_RETRYABLE);
    }

    await ctx.db.patch(args.jobId, {
      status: "queued",
      dispatchedAt: undefined,
      startedAt: undefined,
      completedAt: undefined,
      error: undefined,
    });
    await ctx.scheduler.runAfter(0, internal.pipeline.render.dispatchQueuedForRun, {
      runId: job.runId,
    });
    return null;
  },
});

export const adminCancelRenderJob = mutation({
  args: { jobId: v.id("renderJobs") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const job = await ctx.db.get(args.jobId);
    if (!job) appError(AppErrorCode.RENDER_JOB_NOT_FOUND);
    if (
      job.status !== "queued" &&
      job.status !== "dispatched" &&
      job.status !== "rendering"
    ) {
      appError(AppErrorCode.RENDER_JOB_NOT_RETRYABLE);
    }

    await ctx.db.patch(args.jobId, {
      status: "cancelled",
      completedAt: Date.now(),
      error: {
        code: "render_cancelled",
        message: "Cancelled by an administrator.",
        retryable: false,
      },
    });
    await ctx.scheduler.runAfter(0, internal.pipeline.render.notifyRendererCancellation, {
      jobId: String(args.jobId),
    });
    return null;
  },
});

export const notifyRendererCancellation = internalAction({
  args: { jobId: v.string() },
  handler: async (_ctx, args) => {
    const config = rendererDispatchConfig();
    if (!config) return null;

    const body = JSON.stringify({ jobId: args.jobId });
    try {
      const response = await fetch(`${config.rendererUrl}/cancel`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [SIGNATURE_HEADER]: await hmacSha256Hex(body, config.callbackSecret),
        },
        body,
      });
      if (!response.ok) {
        console.error(`[render] renderer cancellation failed: HTTP ${response.status}`);
      }
    } catch (error) {
      // The database state is already cancelled. A late renderer callback is
      // ignored, so a temporary renderer outage cannot resurrect the job.
      console.error("[render] renderer cancellation request failed", error);
    }
    return null;
  },
});
