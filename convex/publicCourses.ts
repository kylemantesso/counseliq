import { v } from "convex/values";
import { internalQuery, query, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { AppErrorCode, appError } from "./errors";

type QuestionBody = {
  id: string;
  type: string;
  prompt: string;
  options: string[];
  correctIndex: number;
  explanation: string;
};

type UnitMeta = {
  hook?: { questionRef: string } | null;
  retrieve?: string[];
  anchor?: { template: string; props: Record<string, unknown> } | null;
  secondsBudget?: number;
  order?: { module: number; unit: number };
};

type VideoStatus = "queued" | "dispatched" | "rendering" | "failed" | "cancelled" | "missing";

type RenderOutput = NonNullable<Doc<"renderJobs">["output"]>;

function renderVariants(output: RenderOutput) {
  return output.variants && output.variants.length > 0
    ? output.variants
    : [
        {
          label: `${output.width}x${output.height}`,
          objectKey: output.objectKey,
          sha256: output.sha256,
          sizeBytes: output.sizeBytes,
          durationMs: output.durationMs,
          width: output.width,
          height: output.height,
          fps: output.fps,
        },
      ];
}

function latestVersion(rows: Doc<"courseVersions">[]) {
  return rows.length > 0
    ? rows.reduce((latest, row) => (row.version > latest.version ? row : latest))
    : null;
}

async function getLatestCourseVersion(ctx: QueryCtx, courseId: Id<"courses">) {
  const versions = await ctx.db
    .query("courseVersions")
    .withIndex("by_course", (q) => q.eq("courseId", courseId))
    .take(100);
  return latestVersion(versions);
}

function sortedUnits(units: Doc<"microUnits">[]) {
  return [...units].sort((a, b) => {
    const orderA = (a.meta as UnitMeta | undefined)?.order;
    const orderB = (b.meta as UnitMeta | undefined)?.order;
    return (
      (orderA?.module ?? 0) - (orderB?.module ?? 0) ||
      (orderA?.unit ?? 0) - (orderB?.unit ?? 0)
    );
  });
}

function questionMap(questions: Doc<"questions">[]) {
  const map = new Map<string, QuestionBody>();
  for (const question of questions) {
    const body = question.body as QuestionBody;
    if (typeof body.id === "string") map.set(body.id, body);
  }
  return map;
}

function publicQuestion(question: QuestionBody | undefined) {
  if (!question) return null;
  return {
    id: question.id,
    type: question.type,
    prompt: question.prompt,
    options: question.options,
    correctIndex: question.correctIndex,
    explanation: question.explanation,
  };
}

function playbackStatus(totalUnits: number, readyUnits: number) {
  if (totalUnits === 0) return "unavailable" as const;
  if (readyUnits === totalUnits) return "ready" as const;
  if (readyUnits > 0) return "processing" as const;
  return "processing" as const;
}

export const listPublishedCourses = query({
  args: {},
  handler: async (ctx) => {
    const courses = await ctx.db
      .query("courses")
      .withIndex("by_status", (q) => q.eq("status", "published"))
      .take(100);

    const items = [];
    for (const course of courses) {
      const version = await getLatestCourseVersion(ctx, course._id);
      if (!version) continue;
      const institution = await ctx.db.get(course.institutionId);
      const renderJobs = await ctx.db
        .query("renderJobs")
        .withIndex("by_course_version", (q) =>
          q.eq("courseVersionId", version._id)
        )
        .take(500);
      const readyUnits = renderJobs.filter(
        (job) => job.status === "succeeded" && job.output
      ).length;

      items.push({
        courseId: course._id,
        courseVersionId: version._id,
        title: course.title,
        level: course.level,
        version: version.version,
        publishedAt: version.publishedAt,
        institution: {
          id: course.institutionId,
          name: institution?.name ?? "Institution",
        },
        counts: {
          modules: version.counts.modules,
          units: version.counts.units,
          questions: version.counts.questions,
          readyUnits,
        },
        playbackStatus: playbackStatus(version.counts.units, readyUnits),
      });
    }

    return items.sort((a, b) => b.publishedAt - a.publishedAt);
  },
});

export const getPublishedCourse = query({
  args: { courseId: v.id("courses") },
  handler: async (ctx, args) => {
    const course = await ctx.db.get(args.courseId);
    if (!course || course.status !== "published") {
      appError(AppErrorCode.COURSE_NOT_FOUND);
    }
    const version = await getLatestCourseVersion(ctx, args.courseId);
    if (!version) appError(AppErrorCode.COURSE_NOT_FOUND);
    const institution = await ctx.db.get(course.institutionId);

    const [units, questions, renderJobs] = await Promise.all([
      ctx.db
        .query("microUnits")
        .withIndex("by_course", (q) => q.eq("courseId", course._id))
        .take(500),
      ctx.db
        .query("questions")
        .withIndex("by_course", (q) => q.eq("courseId", course._id))
        .take(2000),
      ctx.db
        .query("renderJobs")
        .withIndex("by_course_version", (q) =>
          q.eq("courseVersionId", version._id)
        )
        .take(500),
    ]);

    const questionsById = questionMap(questions);
    const renderByUnitId = new Map(renderJobs.map((job) => [job.unitId, job]));
    const modules: Array<{
      moduleId: string;
      moduleIndex: number;
      title: string;
      units: Array<{
        unitId: string;
        unitIndex: number;
        unitIndexInModule: number;
        concept: string;
        video:
          | {
              status: "ready";
              durationMs: number;
              width: number;
              height: number;
              fps: number;
              sizeBytes: number;
              variants: Array<{
                label: string;
                width: number;
                height: number;
                fps: number;
                sizeBytes: number;
              }>;
            }
          | { status: "queued" | "dispatched" | "rendering" | "failed" | "cancelled" | "missing" };
        hookQuestion: ReturnType<typeof publicQuestion>;
        retrieveQuestions: Array<NonNullable<ReturnType<typeof publicQuestion>>>;
        anchor: { template: string; props: Record<string, unknown> } | null;
      }>;
    }> = [];

    let unitIndex = 0;
    for (const unit of sortedUnits(units)) {
      const meta = (unit.meta ?? {}) as UnitMeta;
      let module = modules.find((item) => item.moduleId === unit.moduleKey);
      if (!module) {
        module = {
          moduleId: unit.moduleKey,
          moduleIndex: modules.length,
          title: unit.moduleTitle ?? unit.moduleKey,
          units: [],
        };
        modules.push(module);
      }

      const job = renderByUnitId.get(unit.unitKey);
      let video:
        | {
            status: "ready";
            durationMs: number;
            width: number;
            height: number;
            fps: number;
            sizeBytes: number;
            variants: Array<{
              label: string;
              width: number;
              height: number;
              fps: number;
              sizeBytes: number;
            }>;
          }
        | { status: VideoStatus };
      if (job?.status === "succeeded" && job.output) {
        const variants = renderVariants(job.output);
        video = {
          status: "ready",
          durationMs: job.output.durationMs,
          width: job.output.width,
          height: job.output.height,
          fps: job.output.fps,
          sizeBytes: job.output.sizeBytes,
          variants: variants.map((variant) => ({
            label: variant.label,
            width: variant.width,
            height: variant.height,
            fps: variant.fps,
            sizeBytes: variant.sizeBytes,
          })),
        };
      } else {
        video = {
          status:
            job?.status === "queued" ||
              job?.status === "dispatched" ||
              job?.status === "rendering" ||
              job?.status === "failed" ||
              job?.status === "cancelled"
              ? job.status
              : "missing",
        };
      }
      const retrieveQuestions = (meta.retrieve ?? [])
        .map((questionId) => publicQuestion(questionsById.get(questionId)))
        .filter((question): question is NonNullable<typeof question> => Boolean(question));

      module.units.push({
        unitId: unit.unitKey,
        unitIndex,
        unitIndexInModule: module.units.length,
        concept: unit.concept,
        video,
        hookQuestion: publicQuestion(
          meta.hook?.questionRef ? questionsById.get(meta.hook.questionRef) : undefined
        ),
        retrieveQuestions,
        anchor: meta.anchor ?? null,
      });
      unitIndex += 1;
    }

    const readyUnits = renderJobs.filter(
      (job) => job.status === "succeeded" && job.output
    ).length;

    return {
      course: {
        courseId: course._id,
        courseVersionId: version._id,
        title: course.title,
        level: course.level,
        version: version.version,
        publishedAt: version.publishedAt,
        brandRef:
          (course.definitionMeta as { brandRef?: string } | undefined)
            ?.brandRef ?? null,
      },
      institution: {
        id: course.institutionId,
        name: institution?.name ?? "Institution",
        brandTokens: institution?.brandTokens ?? null,
      },
      render: {
        status: playbackStatus(version.counts.units, readyUnits),
        totalUnits: version.counts.units,
        readyUnits,
      },
      modules,
    };
  },
});

export const getRenderedUnitKeysInternal = internalQuery({
  args: {
    courseVersionId: v.id("courseVersions"),
    unitIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const version = await ctx.db.get(args.courseVersionId);
    if (!version) appError(AppErrorCode.COURSE_NOT_FOUND);
    const course = await ctx.db.get(version.courseId);
    if (!course || course.status !== "published") {
      appError(AppErrorCode.COURSE_NOT_FOUND);
    }

    const requested = args.unitIds.slice(0, 20);
    const jobs = await ctx.db
      .query("renderJobs")
      .withIndex("by_course_version", (q) =>
        q.eq("courseVersionId", args.courseVersionId)
      )
      .take(500);
    const byUnit = new Map(jobs.map((job) => [job.unitId, job]));

    return requested
      .map((unitId) => {
        const job = byUnit.get(unitId);
        if (job?.status !== "succeeded" || !job.output) return null;
        const variants = renderVariants(job.output);
        return {
          unitId,
          key: job.output.objectKey,
          durationMs: job.output.durationMs,
          width: job.output.width,
          height: job.output.height,
          fps: job.output.fps,
          variants: variants.map((variant) => ({
            label: variant.label,
            key: variant.objectKey,
            durationMs: variant.durationMs,
            width: variant.width,
            height: variant.height,
            fps: variant.fps,
            sizeBytes: variant.sizeBytes,
          })),
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
  },
});
