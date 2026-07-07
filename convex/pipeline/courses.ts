import { v } from "convex/values";
import {
  parseCourseDefinition,
  type Concept,
  type CourseDefinition,
  type Fact,
  type QuestionBankItem,
} from "@counseliq/course-schema";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "../_generated/server";
import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { AppErrorCode, appError } from "../errors";
import { requireAdmin } from "../admin";

/**
 * Data layer for the M4 compiler: reviewed-inventory input, compiled-course
 * persistence (courses / microUnits / questions rows), and lossless
 * reconstruction of the CourseDefinition from those rows. All LLM/network
 * work lives in compiler/compile.ts ("use node"); everything here is plain
 * Convex runtime.
 */

// --- Reviewed inventory (compiler input) ---

/**
 * Everything the compiler consumes: the run's reviewed inventory with
 * EXCLUDED FACTS FILTERED IN CODE (they must never reach a prompt), plus
 * the excluded facts separately (for _pipelineNotes and the leak check) and
 * institution context.
 */
export const getReviewedInventoryInternal = internalQuery({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) appError(AppErrorCode.RUN_NOT_FOUND);
    const institution = await ctx.db.get(run.institutionId);
    if (!institution) appError(AppErrorCode.INSTITUTION_NOT_FOUND);

    const rows = await ctx.db
      .query("inventoryItems")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .take(5000);

    const concepts: Concept[] = [];
    const facts: Fact[] = [];
    const excludedFacts: Fact[] = [];
    const provenanceIds = new Set<string>();
    for (const row of rows) {
      for (const provenanceId of row.provenance) {
        provenanceIds.add(provenanceId);
      }
      if (row.kind === "concept") {
        concepts.push(row.body as Concept);
      } else if (row.kind === "fact") {
        const fact = row.body as Fact;
        if (row.excluded === true || fact.excluded === true) {
          excludedFacts.push(fact);
        } else {
          facts.push(fact);
        }
      }
    }

    return {
      institution: {
        name: institution.name,
        market: institution.market,
        pronunciationLexicon: institution.pronunciationLexicon,
      },
      concepts,
      facts,
      excludedFacts,
      provenanceIds: [...provenanceIds],
    };
  },
});

// --- Wire format ---
//
// Convex reserves `$`-prefixed field names in args, return values, and
// documents, so a CourseDefinition crosses function boundaries with
// `$schema` renamed to `schemaRef`.

export function definitionToWire(
  definition: CourseDefinition
): Record<string, unknown> {
  const { $schema, ...rest } = definition;
  return { schemaRef: $schema, ...rest };
}

export function definitionFromWire(wire: unknown): unknown {
  if (wire === null || typeof wire !== "object") return wire;
  const { schemaRef, ...rest } = wire as Record<string, unknown>;
  return { $schema: schemaRef, ...rest };
}

// --- Persistence ---

/** Unit-level fields stored on microUnits.meta. */
export interface MicroUnitMeta {
  secondsBudget: number;
  hook: { type: "commit-question"; questionRef: string };
  retrieve: string[];
  anchor: { template: string; props: Record<string, unknown> };
  conceptKey?: string;
  order: { module: number; unit: number };
}

/**
 * Course-level fields stored on courses.definitionMeta. `$schema` is stored
 * as `schemaRef` because Convex reserves `$`-prefixed field names.
 */
export interface CourseDefinitionMeta {
  schemaRef: string;
  courseId: string;
  badge: string;
  prerequisite: string;
  brandRef: string;
  language: string;
  voice: CourseDefinition["voice"];
  _pipelineNotes: CourseDefinition["_pipelineNotes"];
  assessment: CourseDefinition["assessment"];
}

/**
 * Persists a validated CourseDefinition as courses / microUnits / questions
 * rows and links runs.courseId. Idempotent full replace: recompiles patch
 * the same course row (version bumped) and rewrite unit/question rows —
 * partial re-authoring preserves untouched units by passing them through
 * unchanged in the definition.
 */
export const saveCompiledCourse = internalMutation({
  args: {
    runId: v.id("runs"),
    /** CourseDefinition in wire format (see definitionToWire). */
    definition: v.any(),
    /** conceptKey per unitId (compiler bookkeeping, kept on meta). */
    conceptKeysByUnitId: v.optional(v.record(v.string(), v.string())),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) appError(AppErrorCode.RUN_NOT_FOUND);

    // Schema gate: an invalid definition never reaches the database.
    const definition = parseCourseDefinition(definitionFromWire(args.definition));
    const conceptKeys = args.conceptKeysByUnitId ?? {};

    const definitionMeta: CourseDefinitionMeta = {
      schemaRef: definition.$schema,
      courseId: definition.courseId,
      badge: definition.badge,
      prerequisite: definition.prerequisite,
      brandRef: definition.brandRef,
      language: definition.language,
      voice: definition.voice,
      _pipelineNotes: definition._pipelineNotes,
      assessment: definition.assessment,
    };

    let courseId: Id<"courses">;
    if (run.courseId) {
      const existing = await ctx.db.get(run.courseId);
      if (!existing) appError(AppErrorCode.RUN_NOT_FOUND);
      courseId = existing._id;
      await ctx.db.patch(courseId, {
        title: definition.courseTitle,
        level: definition.credentialLevel,
        version: existing.version + 1,
        status: "in_review",
        definitionMeta,
      });
      const oldUnits = await ctx.db
        .query("microUnits")
        .withIndex("by_course", (q) => q.eq("courseId", courseId))
        .take(500);
      for (const unit of oldUnits) {
        await ctx.db.delete(unit._id);
      }
      const oldQuestions = await ctx.db
        .query("questions")
        .withIndex("by_course", (q) => q.eq("courseId", courseId))
        .take(2000);
      for (const question of oldQuestions) {
        await ctx.db.delete(question._id);
      }
    } else {
      courseId = await ctx.db.insert("courses", {
        institutionId: run.institutionId,
        title: definition.courseTitle,
        level: definition.credentialLevel,
        version: 1,
        status: "in_review",
        definitionMeta,
      });
      await ctx.db.patch(args.runId, { courseId });
    }

    let unitCount = 0;
    for (const [moduleIndex, module] of definition.modules.entries()) {
      for (const [unitIndex, unit] of module.microUnits.entries()) {
        unitCount += 1;
        const meta: MicroUnitMeta = {
          secondsBudget: unit.secondsBudget,
          hook: unit.hook,
          retrieve: unit.retrieve,
          anchor: unit.anchor,
          ...(conceptKeys[unit.unitId] !== undefined
            ? { conceptKey: conceptKeys[unit.unitId] }
            : {}),
          order: { module: moduleIndex, unit: unitIndex },
        };
        await ctx.db.insert("microUnits", {
          courseId,
          moduleKey: module.moduleId,
          moduleTitle: module.title,
          unitKey: unit.unitId,
          concept: unit.concept,
          narration: unit.content.narration,
          cards: unit.content.cards,
          meta,
          state: "draft",
        });
      }
    }

    for (const question of definition.questionBank) {
      await ctx.db.insert("questions", {
        courseId,
        conceptTag: question.conceptTag,
        body: question,
      });
    }

    return {
      courseId,
      unitCount,
      moduleCount: definition.modules.length,
      questionCount: definition.questionBank.length,
    };
  },
});

// --- Reconstruction + reads ---

/** Rebuilds the CourseDefinition JSON from courses/microUnits/questions rows. */
export function reconstructCourseDefinition(
  course: Doc<"courses">,
  units: Doc<"microUnits">[],
  questions: Doc<"questions">[]
): CourseDefinition {
  const meta = course.definitionMeta as CourseDefinitionMeta;

  const sorted = [...units].sort((a, b) => {
    const orderA = (a.meta as MicroUnitMeta).order;
    const orderB = (b.meta as MicroUnitMeta).order;
    return orderA.module - orderB.module || orderA.unit - orderB.unit;
  });

  const modules: CourseDefinition["modules"] = [];
  for (const unit of sorted) {
    const unitMeta = unit.meta as MicroUnitMeta;
    let module = modules.find((m) => m.moduleId === unit.moduleKey);
    if (!module) {
      module = {
        moduleId: unit.moduleKey,
        title: unit.moduleTitle ?? unit.moduleKey,
        microUnits: [],
      };
      modules.push(module);
    }
    module.microUnits.push({
      unitId: unit.unitKey,
      concept: unit.concept,
      secondsBudget: unitMeta.secondsBudget,
      hook: unitMeta.hook,
      content: {
        narration: unit.narration,
        cards: unit.cards,
      },
      retrieve: unitMeta.retrieve,
      anchor: unitMeta.anchor as CourseDefinition["modules"][number]["microUnits"][number]["anchor"],
    });
  }

  return {
    $schema: meta.schemaRef,
    courseId: meta.courseId,
    courseTitle: course.title,
    credentialLevel: course.level,
    badge: meta.badge,
    prerequisite: meta.prerequisite,
    brandRef: meta.brandRef,
    language: meta.language,
    voice: meta.voice,
    _pipelineNotes: meta._pipelineNotes,
    modules,
    assessment: meta.assessment,
    questionBank: questions.map((q) => q.body as QuestionBankItem),
  };
}

async function getCourseRowsForRun(
  ctx: QueryCtx,
  runId: Id<"runs">
): Promise<{
  run: Doc<"runs">;
  course: Doc<"courses">;
  units: Doc<"microUnits">[];
  questions: Doc<"questions">[];
} | null> {
  const run = await ctx.db.get(runId);
  if (!run || !run.courseId) return null;
  const course = await ctx.db.get(run.courseId);
  if (!course) return null;
  const units = await ctx.db
    .query("microUnits")
    .withIndex("by_course", (q) => q.eq("courseId", course._id))
    .take(500);
  const questions = await ctx.db
    .query("questions")
    .withIndex("by_course", (q) => q.eq("courseId", course._id))
    .take(2000);
  units.sort((a, b) => {
    const orderA = (a.meta as MicroUnitMeta).order;
    const orderB = (b.meta as MicroUnitMeta).order;
    return orderA.module - orderB.module || orderA.unit - orderB.unit;
  });
  return { run, course, units, questions };
}

/** Compiled course rows for a run (compiler re-runs, judge, walkthrough). */
export const getCourseForRunInternal = internalQuery({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    return await getCourseRowsForRun(ctx, args.runId);
  },
});

/**
 * The reconstructed CourseDefinition for a run, in wire format (`schemaRef`
 * in place of `$schema` — see definitionToWire). Used by eval + exports.
 */
export const getCourseDefinitionForRunInternal = internalQuery({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    const rows = await getCourseRowsForRun(ctx, args.runId);
    if (!rows) return null;
    return definitionToWire(
      reconstructCourseDefinition(rows.course, rows.units, rows.questions)
    );
  },
});

/** Admin: compiled course + units + questions for the gate-2 viewer. */
export const getRunCourse = query({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const rows = await getCourseRowsForRun(ctx, args.runId);
    if (!rows) return null;
    return {
      course: rows.course,
      units: rows.units,
      questions: rows.questions,
    };
  },
});

// --- Per-unit authoring cache (compiler fan-out) ---

/** Cached authoring result for a unit, or null when stale/absent. */
export const getUnitAuthoring = internalQuery({
  args: {
    runId: v.id("runs"),
    unitId: v.string(),
    cacheKey: v.string(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("unitAuthorings")
      .withIndex("by_run_and_unit", (q) =>
        q.eq("runId", args.runId).eq("unitId", args.unitId)
      )
      .unique();
    if (!row || row.cacheKey !== args.cacheKey) return null;
    return row.result;
  },
});

/** Upserts the authoring result for one unit (idempotent re-runs replace). */
export const saveUnitAuthoring = internalMutation({
  args: {
    runId: v.id("runs"),
    unitId: v.string(),
    cacheKey: v.string(),
    result: v.any(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("unitAuthorings")
      .withIndex("by_run_and_unit", (q) =>
        q.eq("runId", args.runId).eq("unitId", args.unitId)
      )
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        cacheKey: args.cacheKey,
        result: args.result,
      });
    } else {
      await ctx.db.insert("unitAuthorings", args);
    }
    return null;
  },
});

/** All authoring rows for a run (collected by the compile orchestrator). */
export const listUnitAuthoringsForRun = internalQuery({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("unitAuthorings")
      .withIndex("by_run_and_unit", (q) => q.eq("runId", args.runId))
      .take(500);
  },
});

// --- Unit QA (written by the judge, D4) ---

export const setUnitQa = internalMutation({
  args: {
    microUnitId: v.id("microUnits"),
    qa: v.any(),
    state: v.optional(
      v.union(v.literal("draft"), v.literal("qa_passed"))
    ),
  },
  handler: async (ctx, args) => {
    const unit = await ctx.db.get(args.microUnitId);
    if (!unit) appError(AppErrorCode.RUN_NOT_FOUND);
    await ctx.db.patch(args.microUnitId, {
      qa: args.qa,
      ...(args.state !== undefined ? { state: args.state } : {}),
    });
    return null;
  },
});

/** Course-level QA verdict written by the judge (pass, courseFlags, …). */
export const setCourseQa = internalMutation({
  args: {
    courseId: v.id("courses"),
    qa: v.any(),
  },
  handler: async (ctx, args) => {
    const course = await ctx.db.get(args.courseId);
    if (!course) appError(AppErrorCode.COURSE_NOT_FOUND);
    await ctx.db.patch(args.courseId, { qa: args.qa });
    return null;
  },
});

// --- Question editing + regeneration (gate-2 UI, D5) ---

/**
 * Context for regenerating one question: the question row, the micro-unit
 * that references it, and every other prompt in the course's bank (the
 * replacement must not duplicate any of them).
 */
export const getQuestionContextInternal = internalQuery({
  args: { questionId: v.id("questions") },
  handler: async (ctx, args) => {
    const question = await ctx.db.get(args.questionId);
    if (!question) appError(AppErrorCode.QUESTION_NOT_FOUND);
    const units = await ctx.db
      .query("microUnits")
      .withIndex("by_course", (q) => q.eq("courseId", question.courseId))
      .take(500);
    const body = question.body as QuestionBankItem;
    const unit = units.find((row) => {
      const meta = row.meta as MicroUnitMeta;
      return (
        meta.hook.questionRef === body.id || meta.retrieve.includes(body.id)
      );
    });
    const siblings = await ctx.db
      .query("questions")
      .withIndex("by_course", (q) => q.eq("courseId", question.courseId))
      .take(2000);
    return {
      question,
      unit: unit ?? null,
      otherPrompts: siblings
        .filter((row) => row._id !== question._id)
        .map((row) => (row.body as QuestionBankItem).prompt),
    };
  },
});

/** Replaces a question's editable fields (regeneration result). */
export const replaceQuestionBody = internalMutation({
  args: {
    questionId: v.id("questions"),
    prompt: v.string(),
    options: v.array(v.string()),
    correctIndex: v.number(),
    explanation: v.string(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.questionId);
    if (!row) appError(AppErrorCode.QUESTION_NOT_FOUND);
    const body = row.body as QuestionBankItem;
    await ctx.db.patch(args.questionId, {
      body: {
        ...body,
        prompt: args.prompt,
        options: args.options,
        correctIndex: args.correctIndex,
        explanation: args.explanation,
      },
    });
    return null;
  },
});

/**
 * Admin: regenerate one question via the author model. Validates and
 * schedules the LLM action; the questions query updates reactively when the
 * replacement lands.
 */
export const adminRegenerateQuestion = mutation({
  args: {
    runId: v.id("runs"),
    questionId: v.id("questions"),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const run = await ctx.db.get(args.runId);
    if (!run) appError(AppErrorCode.RUN_NOT_FOUND);
    const question = await ctx.db.get(args.questionId);
    if (!question || question.courseId !== run.courseId) {
      appError(AppErrorCode.QUESTION_NOT_FOUND);
    }
    await ctx.scheduler.runAfter(
      0,
      internal.pipeline.compiler.compile.regenerateQuestion,
      { runId: args.runId, questionId: args.questionId }
    );
    return null;
  },
});

/** Admin: edit one question in place (prompt/options/answer/explanation). */
export const adminUpdateQuestion = mutation({
  args: {
    questionId: v.id("questions"),
    prompt: v.string(),
    options: v.array(v.string()),
    correctIndex: v.number(),
    explanation: v.string(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const row = await ctx.db.get(args.questionId);
    if (!row) appError(AppErrorCode.QUESTION_NOT_FOUND);
    const body = row.body as QuestionBankItem;
    if (
      args.prompt.trim() === "" ||
      args.options.length < 2 ||
      args.options.some((option) => option.trim() === "") ||
      !Number.isInteger(args.correctIndex) ||
      args.correctIndex < 0 ||
      args.correctIndex >= args.options.length ||
      args.explanation.trim() === ""
    ) {
      appError(AppErrorCode.QUESTION_INVALID);
    }
    await ctx.db.patch(args.questionId, {
      body: {
        ...body,
        prompt: args.prompt.trim(),
        options: args.options.map((option) => option.trim()),
        correctIndex: args.correctIndex,
        explanation: args.explanation.trim(),
      },
    });
    return null;
  },
});
