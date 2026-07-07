import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { AppErrorCode, appError } from "../errors";
import { requireAdmin } from "../admin";
import { definitionToWire, getCourseRowsForRun, reconstructCourseDefinition } from "./courses";

/**
 * Data layer for the M5 publish path. The "use node" orchestration
 * (reconstruction, hashing, object-store writes) lives in publish.ts;
 * everything here is plain Convex runtime.
 */

/** Everything runPublish needs, in one transactional read. */
export const getPublishInputInternal = internalQuery({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    const rows = await getCourseRowsForRun(ctx, args.runId);
    if (!rows) appError(AppErrorCode.RUN_NOT_FOUND);
    const institution = await ctx.db.get(rows.run.institutionId);
    if (!institution) appError(AppErrorCode.INSTITUTION_NOT_FOUND);

    // The gate-3 approver is the publisher: the PUBLISHING transition's
    // actor is the reviewer who approved the gate.
    const events = await ctx.db
      .query("runEvents")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .take(1000);
    const publishingEvent = [...events]
      .reverse()
      .find((event) => event.toState === "PUBLISHING");

    return {
      run: rows.run,
      course: rows.course,
      units: rows.units,
      questions: rows.questions,
      institution: {
        name: institution.name,
        brandTokens: institution.brandTokens,
      },
      definitionWire: definitionToWire(
        reconstructCourseDefinition(rows.course, rows.units, rows.questions)
      ),
      publishedBy: publishingEvent?.actor ?? "system",
    };
  },
});

/**
 * The transactional tail of a publish: one immutable courseVersions row,
 * course status flipped, every unit frozen. Idempotent — re-running the
 * publish action after a crash lands on the existing row; a DIFFERENT
 * snapshot at the same version is a conflict, never an overwrite.
 */
export const finalizePublish = internalMutation({
  args: {
    runId: v.id("runs"),
    exportKey: v.string(),
    manifestKey: v.string(),
    specHash: v.string(),
    counts: v.object({
      modules: v.number(),
      units: v.number(),
      questions: v.number(),
      audioArtifacts: v.number(),
    }),
    publishedBy: v.string(),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || !run.courseId) appError(AppErrorCode.RUN_NOT_FOUND);
    const course = await ctx.db.get(run.courseId);
    if (!course) appError(AppErrorCode.COURSE_NOT_FOUND);

    const existing = await ctx.db
      .query("courseVersions")
      .withIndex("by_course_and_version", (q) =>
        q.eq("courseId", course._id).eq("version", course.version)
      )
      .unique();
    if (existing) {
      if (existing.specHash === args.specHash) {
        return { courseVersionId: existing._id, version: existing.version };
      }
      appError(AppErrorCode.PUBLISH_VERSION_CONFLICT);
    }

    const courseVersionId = await ctx.db.insert("courseVersions", {
      courseId: course._id,
      institutionId: course.institutionId,
      runId: args.runId,
      version: course.version,
      exportKey: args.exportKey,
      manifestKey: args.manifestKey,
      specHash: args.specHash,
      publishedAt: Date.now(),
      publishedBy: args.publishedBy,
      counts: args.counts,
    });

    await ctx.db.patch(course._id, {
      status: "published",
      specHash: args.specHash,
    });
    const units = await ctx.db
      .query("microUnits")
      .withIndex("by_course", (q) => q.eq("courseId", course._id))
      .take(1000);
    for (const unit of units) {
      await ctx.db.patch(unit._id, { state: "published" });
    }

    return { courseVersionId, version: course.version };
  },
});

function versionSummary(row: Doc<"courseVersions">) {
  return {
    _id: row._id,
    courseId: row.courseId,
    runId: row.runId,
    version: row.version,
    exportKey: row.exportKey,
    manifestKey: row.manifestKey,
    specHash: row.specHash,
    publishedAt: row.publishedAt,
    publishedBy: row.publishedBy,
    counts: row.counts,
  };
}

/** Admin: the published snapshot for a course (latest or a given version). */
export const getPublishedCourse = query({
  args: {
    courseId: v.id("courses"),
    version: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const course = await ctx.db.get(args.courseId);
    if (!course) appError(AppErrorCode.COURSE_NOT_FOUND);

    let row: Doc<"courseVersions"> | null;
    if (args.version !== undefined) {
      row = await ctx.db
        .query("courseVersions")
        .withIndex("by_course_and_version", (q) =>
          q.eq("courseId", args.courseId).eq("version", args.version!)
        )
        .unique();
    } else {
      const rows = await ctx.db
        .query("courseVersions")
        .withIndex("by_course", (q) => q.eq("courseId", args.courseId))
        .take(100);
      row =
        rows.length > 0
          ? rows.reduce((a, b) => (a.version >= b.version ? a : b))
          : null;
    }
    if (!row) return null;
    return {
      course: { title: course.title, status: course.status },
      snapshot: versionSummary(row),
    };
  },
});

/** The publish snapshot produced by a run (walkthrough/eval verification). */
export const getPublishedCourseForRunInternal = internalQuery({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("courseVersions")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .unique();
    return row ? versionSummary(row) : null;
  },
});
