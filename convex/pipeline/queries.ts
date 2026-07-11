import { v } from "convex/values";
import { internalQuery, mutation, query } from "../_generated/server";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { reviewGateValidator, runStateValidator } from "../schema";
import { requireAdmin } from "../admin";
import { AppErrorCode, appError } from "../errors";
import {
  findBannedClaimsInText,
  textHasAttribution,
} from "./compiler/rules";
import {
  getSourceDocFactReviewFromDoc,
  listSourceDocFactRows,
  type SourceDocFactCounts,
  type SourceDocFactReviewStatus,
  type StoredExtractionFact,
  type StoredPageExtractionBody,
} from "./sourceDocFacts";
import {
  LLM_TASKS,
  currentModelRouting,
  envOverrideVarForTask,
  isLlmTask,
  modelSourceForTask,
  type LlmTask,
} from "./llm/models";

const OPENROUTER_MODEL_OPTIONS = [
  {
    id: "google/gemini-3-flash-preview",
    label: "Gemini 3 Flash",
    provider: "Google",
    supportsVision: true,
  },
  {
    id: "google/gemini-3.1-flash-lite",
    label: "Gemini 3.1 Flash Lite",
    provider: "Google",
    supportsVision: true,
  },
  {
    id: "google/gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    provider: "Google",
    supportsVision: true,
  },
  {
    id: "google/gemini-2.5-pro",
    label: "Gemini 2.5 Pro",
    provider: "Google",
    supportsVision: true,
  },
  {
    id: "anthropic/claude-sonnet-4.6",
    label: "Claude Sonnet 4.6",
    provider: "Anthropic",
    supportsVision: true,
  },
  {
    id: "anthropic/claude-sonnet-4.5",
    label: "Claude Sonnet 4.5",
    provider: "Anthropic",
    supportsVision: true,
  },
  {
    id: "anthropic/claude-3.7-sonnet",
    label: "Claude 3.7 Sonnet",
    provider: "Anthropic",
    supportsVision: true,
  },
  {
    id: "openai/gpt-4.1",
    label: "GPT-4.1",
    provider: "OpenAI",
    supportsVision: true,
  },
  {
    id: "openai/gpt-4.1-mini",
    label: "GPT-4.1 Mini",
    provider: "OpenAI",
    supportsVision: true,
  },
  {
    id: "openai/gpt-4o-mini",
    label: "GPT-4o Mini",
    provider: "OpenAI",
    supportsVision: true,
  },
  {
    id: "meta-llama/llama-3.3-70b-instruct",
    label: "Llama 3.3 70B Instruct",
    provider: "Meta",
    supportsVision: false,
  },
] as const;

const OPENROUTER_MODEL_BY_ID = new Map<
  string,
  (typeof OPENROUTER_MODEL_OPTIONS)[number]
>(OPENROUTER_MODEL_OPTIONS.map((option) => [option.id, option]));

const LLM_TASK_MODEL_META: Record<
  LlmTask,
  { label: string; description: string; requiresVision: boolean }
> = {
  "extract-page": {
    label: "Extract pages",
    description: "Vision extraction from each page image + text layer.",
    requiresVision: true,
  },
  "merge-inventory": {
    label: "Merge inventory",
    description:
      "Consolidates extracted concepts/facts across all source documents.",
    requiresVision: false,
  },
  "compile-structure": {
    label: "Compile structure",
    description:
      "Legacy structure planner used when no approved outline is present.",
    requiresVision: false,
  },
  "author-unit": {
    label: "Author unit",
    description: "Drafts narration, cards, and questions for each micro-unit.",
    requiresVision: false,
  },
  "judge-course": {
    label: "QA judge",
    description:
      "Adversarial review pass over the full compiled course and inventory.",
    requiresVision: false,
  },
  "tag-asset": {
    label: "Tag assets",
    description: "Vision caption + tag pass for the media library.",
    requiresVision: true,
  },
  "outline-course": {
    label: "Outline course",
    description: "Proposes modules/units before gate-1 outline review.",
    requiresVision: false,
  },
};

const llmTaskModelMapValidator = v.record(v.string(), v.string());

type LlmTaskModelMap = Record<LlmTask, string>;

function parseTaskModelMap(raw: Record<string, string>): LlmTaskModelMap {
  const parsed = {} as LlmTaskModelMap;
  for (const task of LLM_TASKS) {
    const value = raw[task];
    if (typeof value !== "string" || value.trim().length === 0) {
      appError(AppErrorCode.MODEL_ROUTING_INVALID);
    }
    parsed[task] = value.trim();
  }
  return parsed;
}

async function getConfiguredLlmTaskModels(
  ctx: QueryCtx | MutationCtx
): Promise<{ models: Partial<LlmTaskModelMap>; updatedAt: number | null }> {
  const rows = await ctx.db.query("llmTaskModels").take(50);
  const models: Partial<LlmTaskModelMap> = {};
  let updatedAt: number | null = null;

  for (const row of rows) {
    if (!isLlmTask(row.task)) {
      continue;
    }
    const model = row.model.trim();
    if (model.length === 0) {
      continue;
    }
    models[row.task] = model;
    updatedAt = updatedAt === null ? row.updatedAt : Math.max(updatedAt, row.updatedAt);
  }

  return { models, updatedAt };
}

function validateTaskModelSelection(task: LlmTask, model: string): void {
  const selectedModel = model.trim();
  const option = OPENROUTER_MODEL_BY_ID.get(selectedModel);
  if (!option) {
    appError(AppErrorCode.MODEL_ROUTING_INVALID);
  }
  if (LLM_TASK_MODEL_META[task].requiresVision && !option.supportsVision) {
    appError(AppErrorCode.MODEL_ROUTING_INVALID);
  }
}

async function getRunWithEvents(
  ctx: QueryCtx,
  runId: Id<"runs">
): Promise<{
  run: Doc<"runs"> | null;
  events: Doc<"runEvents">[];
  courseTitle: string | null;
}> {
  const run = await ctx.db.get(runId);
  if (!run) {
    return { run: null, events: [], courseTitle: null };
  }

  const [events, outlineRows, course] = await Promise.all([
    ctx.db
      .query("runEvents")
      .withIndex("by_run", (q) => q.eq("runId", runId))
      .take(200),
    ctx.db
      .query("courseOutlines")
      .withIndex("by_run", (q) => q.eq("runId", runId))
      .order("desc")
      .take(1),
    run.courseId ? ctx.db.get(run.courseId) : Promise.resolve(null),
  ]);

  return {
    run,
    events,
    courseTitle: course?.title ?? outlineRows[0]?.courseTitle ?? null,
  };
}

/** A run plus its full transition history, oldest first. */
export const getRun = query({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    return await getRunWithEvents(ctx, args.runId);
  },
});

/** Internal variant of getRun for scripts and tests (no auth context). */
export const getRunInternal = internalQuery({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    return await getRunWithEvents(ctx, args.runId);
  },
});

type CompileProgressUnitLog = {
  unitId: string;
  label: string;
  status: "ok" | "error";
  warningCount: number;
  createdAt: number;
  cause?: string;
};

/**
 * Live compile progress for the run detail page: unit throughput, rough ETA,
 * and recent unit-level authoring outcomes.
 */
export const getRunCompileProgress = query({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const run = await ctx.db.get(args.runId);
    if (!run) {
      return null;
    }

    const [outlineRows, authorings, events] = await Promise.all([
      ctx.db
        .query("courseOutlines")
        .withIndex("by_run", (q) => q.eq("runId", args.runId))
        .take(10),
      ctx.db
        .query("unitAuthorings")
        .withIndex("by_run_and_unit", (q) => q.eq("runId", args.runId))
        .take(500),
      ctx.db
        .query("runEvents")
        .withIndex("by_run", (q) => q.eq("runId", args.runId))
        .take(200),
    ]);

    const latestOutline =
      outlineRows.length > 0
        ? [...outlineRows].sort((a, b) => a._creationTime - b._creationTime).at(-1)
        : null;

    const unitLabelById = new Map<string, string>();
    let totalUnits = 0;
    if (latestOutline && Array.isArray(latestOutline.modules)) {
      for (const module of latestOutline.modules) {
        if (!module || typeof module !== "object") continue;
        const moduleValue = module as { title?: unknown; units?: unknown };
        const moduleTitle =
          typeof moduleValue.title === "string" ? moduleValue.title : "";
        const units = Array.isArray(moduleValue.units) ? moduleValue.units : [];
        for (const unit of units) {
          if (!unit || typeof unit !== "object") continue;
          const unitValue = unit as { unitId?: unknown; title?: unknown };
          if (typeof unitValue.unitId !== "string") continue;
          totalUnits += 1;
          const unitTitle =
            typeof unitValue.title === "string" ? unitValue.title.trim() : "";
          const label =
            unitTitle.length > 0
              ? unitTitle
              : moduleTitle.length > 0
                ? `${moduleTitle} / ${unitValue.unitId}`
                : unitValue.unitId;
          unitLabelById.set(unitValue.unitId, label);
        }
      }
    }

    const unitLogs: CompileProgressUnitLog[] = authorings
      .map((row) => {
        const result = row.result as {
          status?: unknown;
          cause?: unknown;
          complianceWarnings?: unknown;
        };
        const status: "ok" | "error" = result?.status === "error" ? "error" : "ok";
        const warningCount = Array.isArray(result?.complianceWarnings)
          ? result.complianceWarnings.length
          : 0;
        const cause =
          status === "error" && typeof result?.cause === "string"
            ? result.cause.slice(0, 200)
            : undefined;
        return {
          unitId: row.unitId,
          label: unitLabelById.get(row.unitId) ?? row.unitId,
          status,
          warningCount,
          createdAt: row._creationTime,
          ...(cause !== undefined ? { cause } : {}),
        };
      })
      .sort((a, b) => b.createdAt - a.createdAt);

    const processedUnits = unitLogs.length;
    const completedUnits = unitLogs.filter((log) => log.status === "ok").length;
    const failedUnits = unitLogs.filter((log) => log.status === "error").length;

    const compileStartedAt = [...events]
      .reverse()
      .find((event) => event.toState === "COMPILING")?._creationTime;
    let etaMs: number | null = null;
    if (run.state === "COMPILING" && totalUnits > processedUnits && processedUnits > 0) {
      const elapsedMs =
        compileStartedAt !== undefined
          ? Math.max(Date.now() - compileStartedAt, 1)
          : (() => {
              const oldest = unitLogs.at(-1)?.createdAt;
              const newest = unitLogs.at(0)?.createdAt;
              if (oldest === undefined || newest === undefined || newest <= oldest) return 0;
              return newest - oldest;
            })();

      if (elapsedMs > 0) {
        const unitsPerMs = processedUnits / elapsedMs;
        if (unitsPerMs > 0) {
          etaMs = Math.round((totalUnits - processedUnits) / unitsPerMs);
        }
      }
    }

    return {
      runState: run.state,
      totalUnits: totalUnits > 0 ? totalUnits : null,
      processedUnits,
      completedUnits,
      failedUnits,
      progressPercent:
        totalUnits > 0 ? Math.max(0, Math.min(100, Math.round((processedUnits / totalUnits) * 100))) : null,
      etaMs,
      compileStartedAt: compileStartedAt ?? null,
      lastUnitAt: unitLogs[0]?.createdAt ?? null,
      recentUnits: unitLogs.slice(0, 8),
    };
  },
});

export const listRunsByState = query({
  args: { state: runStateValidator },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    return await ctx.db
      .query("runs")
      .withIndex("by_state", (q) => q.eq("state", args.state))
      .order("desc")
      .take(100);
  },
});

/** Internal variant for scripts (eval-compile reuse detection). */
export const listRunsByStateInternal = internalQuery({
  args: { state: runStateValidator },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("runs")
      .withIndex("by_state", (q) => q.eq("state", args.state))
      .order("desc")
      .take(100);
  },
});

/** Auth check for admin-only actions (actions have no db access). */
export const assertAdmin = internalQuery({
  args: {},
  handler: async (ctx): Promise<{ email: string }> => {
    const admin = await requireAdmin(ctx);
    return { email: admin.email };
  },
});

/** Internal model routing resolver for actions (actions cannot read ctx.db). */
export const getLlmModelRoutingInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const configured = await getConfiguredLlmTaskModels(ctx);
    return currentModelRouting(configured.models);
  },
});

/** Admin model-routing config (task metadata + effective selections). */
export const adminGetLlmModelRouting = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const configured = await getConfiguredLlmTaskModels(ctx);
    const effective = currentModelRouting(configured.models);

    return {
      updatedAt: configured.updatedAt,
      models: OPENROUTER_MODEL_OPTIONS.map((option) => ({
        id: option.id,
        label: option.label,
        provider: option.provider,
        supportsVision: option.supportsVision,
      })),
      tasks: LLM_TASKS.map((task) => ({
        task,
        label: LLM_TASK_MODEL_META[task].label,
        description: LLM_TASK_MODEL_META[task].description,
        requiresVision: LLM_TASK_MODEL_META[task].requiresVision,
        configuredModel: configured.models[task] ?? null,
        effectiveModel: effective[task],
        source: modelSourceForTask(task, configured.models),
        envVar: envOverrideVarForTask(task),
      })),
      selectedModels: effective,
    };
  },
});

/** Admin write path for model-routing config. */
export const adminSetLlmModelRouting = mutation({
  args: { models: llmTaskModelMapValidator },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const now = Date.now();
    const models = parseTaskModelMap(args.models);

    for (const task of LLM_TASKS) {
      const model = models[task];
      validateTaskModelSelection(task, model);

      const existingRows = await ctx.db
        .query("llmTaskModels")
        .withIndex("by_task", (q) => q.eq("task", task))
        .take(10);
      const existing = existingRows[0] ?? null;

      for (const duplicate of existingRows.slice(1)) {
        await ctx.db.delete(duplicate._id);
      }

      if (existing) {
        await ctx.db.patch(existing._id, {
          model,
          updatedAt: now,
          updatedByUserId: admin._id,
        });
      } else {
        await ctx.db.insert("llmTaskModels", {
          task,
          model,
          updatedAt: now,
          updatedByUserId: admin._id,
        });
      }
    }

    return { updatedAt: now };
  },
});

/** Recent runs of one institution, newest first (generate-course page). */
export const adminListRuns = query({
  args: { institutionId: v.id("institutions") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const runs = await ctx.db.query("runs").order("desc").take(300);
    const filtered = runs
      .filter((run) => run.institutionId === args.institutionId)
      .slice(0, 50);

    const rows = [] as Array<{
      _id: typeof filtered[number]["_id"];
      _creationTime: number;
      state: string;
      error: typeof filtered[number]["error"] | null;
      courseTitle: string | null;
      unitCount: number;
      moduleCount: number;
      sourceCount: number;
      failedFromState: string | null;
    }>;

    for (const run of filtered) {
      let courseTitle: string | null = null;
      let unitCount = 0;
      let moduleCount = 0;
      const [sourceDocs, outlineRows, events] = await Promise.all([
        ctx.db
          .query("sourceDocs")
          .withIndex("by_run", (q) => q.eq("runId", run._id))
          .take(100),
        ctx.db
          .query("courseOutlines")
          .withIndex("by_run", (q) => q.eq("runId", run._id))
          .order("desc")
          .take(1),
        run.state === "FAILED"
          ? ctx.db
              .query("runEvents")
              .withIndex("by_run", (q) => q.eq("runId", run._id))
              .order("desc")
              .take(1)
          : Promise.resolve([]),
      ]);

      const latestOutline = outlineRows[0];
      courseTitle = latestOutline?.courseTitle ?? null;

      if (run.courseId) {
        const course = await ctx.db.get(run.courseId);
        if (course) {
          courseTitle = course.title;
          const units = await ctx.db
            .query("microUnits")
            .withIndex("by_course", (q) => q.eq("courseId", run.courseId!))
            .take(200);
          unitCount = units.length;
          moduleCount = new Set(units.map((unit) => unit.moduleKey)).size;
        }
      }

      const failedFromState =
        run.state === "FAILED"
          ? (events.find((event) => event.toState === "FAILED")?.fromState ?? null)
          : null;

      rows.push({
        _id: run._id,
        _creationTime: run._creationTime,
        state: run.state,
        error: run.error ?? null,
        courseTitle,
        unitCount,
        moduleCount,
        sourceCount: sourceDocs.length,
        failedFromState,
      });
    }

    return rows;
  },
});

/** Source documents, newest first — the admin ingestion inspector list. */
export const listSourceDocs = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return await ctx.db.query("sourceDocs").order("desc").take(100);
  },
});

/** One source doc with its converted pages, ordered by page number. */
export const getSourceDoc = query({
  args: { sourceDocId: v.id("sourceDocs") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const doc = await ctx.db.get(args.sourceDocId);
    if (!doc) {
      return null;
    }
    const slides = await ctx.db
      .query("slides")
      .withIndex("by_source_doc_and_n", (q) =>
        q.eq("sourceDocId", args.sourceDocId)
      )
      .take(500);
    return { doc, slides };
  },
});

/** Standalone source-doc facts extracted from upload-time extraction. */
export const getSourceDocFacts = query({
  args: { sourceDocId: v.id("sourceDocs") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const doc = await ctx.db.get(args.sourceDocId);
    if (!doc) {
      return null;
    }
    return await listSourceDocFactRows(ctx, args.sourceDocId);
  },
});

/** Admin curation of one standalone source-doc fact candidate. */
export const adminUpdateSourceDocFact = mutation({
  args: {
    sourceDocId: v.id("sourceDocs"),
    pageN: v.number(),
    factIndex: v.number(),
    statement: v.optional(v.union(v.string(), v.null())),
    sourceLabel: v.optional(v.union(v.string(), v.null())),
    year: v.optional(v.union(v.number(), v.null())),
    excluded: v.optional(v.boolean()),
    institutionAsserted: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const doc = await ctx.db.get(args.sourceDocId);
    if (!doc) appError(AppErrorCode.SOURCE_DOC_NOT_FOUND);

    const extraction = await ctx.db
      .query("pageExtractions")
      .withIndex("by_source_doc_and_n", (q) =>
        q.eq("sourceDocId", args.sourceDocId).eq("n", args.pageN)
      )
      .unique();
    if (!extraction) appError(AppErrorCode.SOURCE_DOC_NOT_FOUND);

    const body = extraction.result as StoredPageExtractionBody;
    const facts = Array.isArray(body.facts) ? [...body.facts] : [];
    const current = facts[args.factIndex];
    if (!current) appError(AppErrorCode.SOURCE_DOC_NOT_FOUND);

    const next: StoredExtractionFact = { ...current };

    if (args.statement !== undefined) {
      const statement = args.statement?.trim();
      if (statement && statement.length > 0) {
        next.statement = statement;
      }
    }

    if (args.sourceLabel !== undefined) {
      const sourceLabel = args.sourceLabel?.trim();
      if (sourceLabel && sourceLabel.length > 0) {
        next.sourceLabel = sourceLabel;
      } else {
        delete next.sourceLabel;
      }
    }

    if (args.year !== undefined) {
      if (typeof args.year === "number") {
        next.year = args.year;
      } else {
        delete next.year;
      }
    }

    if (args.excluded !== undefined) {
      next.excluded = args.excluded;
      if (args.excluded) {
        next.flagged = true;
      }
    }

    if (args.institutionAsserted === true) {
      next.flagged = false;
      delete next.flagReason;
      next.excluded = false;
    }

    if (
      typeof next.sourceLabel === "string" &&
      next.sourceLabel.trim().length > 0 &&
      typeof next.year === "number"
    ) {
      next.flagged = false;
      delete next.flagReason;
      next.excluded = false;
    }

    facts[args.factIndex] = next;

    await ctx.db.patch(extraction._id, {
      result: {
        ...body,
        facts,
      },
    });

    return null;
  },
});

type BulkSourceDocFactApprovalResult = {
  approved: number;
  approvedRisky: number;
  skippedRisky: number;
  skippedExcluded: number;
  alreadyReviewed: number;
};

async function bulkApproveSourceDocFacts(
  ctx: MutationCtx,
  sourceDocId: Id<"sourceDocs">,
  includeRisky: boolean
): Promise<BulkSourceDocFactApprovalResult> {
  const doc = await ctx.db.get(sourceDocId);
  if (!doc) appError(AppErrorCode.SOURCE_DOC_NOT_FOUND);

  const extractions = await ctx.db
    .query("pageExtractions")
    .withIndex("by_source_doc_and_n", (q) => q.eq("sourceDocId", sourceDocId))
    .take(500);

  let approved = 0;
  let approvedRisky = 0;
  let skippedRisky = 0;
  let skippedExcluded = 0;
  let alreadyReviewed = 0;

  for (const extraction of extractions) {
    const body = extraction.result as StoredPageExtractionBody;
    const facts = Array.isArray(body.facts) ? [...body.facts] : [];
    let changed = false;

    for (const [index, fact] of facts.entries()) {
      if (fact.excluded === true) {
        skippedExcluded += 1;
        continue;
      }
      if (fact.flagged !== true) {
        alreadyReviewed += 1;
        continue;
      }

      const statement = fact.statement ?? "";
      const risky =
        findBannedClaimsInText(statement).length > 0 &&
        !textHasAttribution(statement);
      if (risky && !includeRisky) {
        skippedRisky += 1;
        continue;
      }

      const nextFact: StoredExtractionFact = {
        ...fact,
        flagged: false,
      };
      delete nextFact.flagReason;
      facts[index] = nextFact;
      approved += 1;
      if (risky) approvedRisky += 1;
      changed = true;
    }

    if (changed) {
      await ctx.db.patch(extraction._id, {
        result: {
          ...body,
          facts,
        },
      });
    }
  }

  return {
    approved,
    approvedRisky,
    skippedRisky,
    skippedExcluded,
    alreadyReviewed,
  };
}

/** Bulk source-doc curation: approve every safe pending fact candidate. */
export const adminApproveAllSafeSourceDocFacts = mutation({
  args: { sourceDocId: v.id("sourceDocs") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    return await bulkApproveSourceDocFacts(ctx, args.sourceDocId, false);
  },
});

/** Bulk source-doc curation: optionally include risky pending facts. */
export const adminApproveAllSourceDocFacts = mutation({
  args: {
    sourceDocId: v.id("sourceDocs"),
    includeRisky: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    return await bulkApproveSourceDocFacts(
      ctx,
      args.sourceDocId,
      args.includeRisky === true
    );
  },
});

/** One source doc's sidebar data: runs, ingest history count, and fact stats. */
export const getSourceDocSummary = query({
  args: { sourceDocId: v.id("sourceDocs") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const doc = await ctx.db.get(args.sourceDocId);
    if (!doc) {
      return null;
    }

    const allDocs = await ctx.db.query("sourceDocs").take(500);
    const relatedDocs = allDocs.filter((candidate) => {
      if (candidate.institutionId !== doc.institutionId) return false;
      if (candidate._id === doc._id) return true;
      if (doc.sourceDocHash && candidate.sourceDocHash) {
        return candidate.sourceDocHash === doc.sourceDocHash;
      }
      return candidate.objectKey === doc.objectKey;
    });

    const runIds = [
      ...new Set(
        relatedDocs
          .map((candidate) => candidate.runId)
          .filter((runId): runId is Id<"runs"> => Boolean(runId))
      ),
    ];

    const runs = [] as Array<{
      _id: Id<"runs">;
      _creationTime: number;
      state: string;
      title: string;
    }>;

    for (const runId of runIds) {
      const run = await ctx.db.get(runId);
      if (!run) continue;

      let title = `Course generation ${String(runId).slice(0, 8)}`;
      if (run.courseId) {
        const course = await ctx.db.get(run.courseId);
        if (course?.title) {
          title = course.title;
        }
      }

      runs.push({
        _id: runId,
        _creationTime: run._creationTime,
        state: run.state,
        title,
      });
    }

    runs.sort((left, right) => right._creationTime - left._creationTime);
    const factReview = await getSourceDocFactReviewFromDoc(ctx, doc);

    return {
      ingestHistoryCount: relatedDocs.length,
      extractedPagesAcrossRuns: relatedDocs.reduce(
        (sum, sourceDoc) => sum + (sourceDoc.pageCount ?? 0),
        0
      ),
      runs,
      facts: factReview.facts,
      factReviewStatus: factReview.status,
      factExtractionComplete: factReview.extractionComplete,
    };
  },
});

function humanizeFilename(name: string): string {
  return name
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleFromSlideText(text?: string): string | undefined {
  if (!text) return undefined;
  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 6);
  const firstLine = lines.find((line) => /[a-z]/i.test(line));
  if (!firstLine) return undefined;
  return firstLine.slice(0, 96);
}

async function summarizeSourceDocLlmUsage(
  ctx: QueryCtx,
  sourceDocId: Id<"sourceDocs">
): Promise<{
  tracked: boolean;
  calls: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  lastCallAt?: number;
}> {
  const calls = await ctx.db
    .query("llmCalls")
    .withIndex("by_source_doc", (q) => q.eq("sourceDocId", sourceDocId))
    .take(5000);

  if (calls.length === 0) {
    return {
      tracked: false,
      calls: 0,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
    };
  }

  let tokensIn = 0;
  let tokensOut = 0;
  let costUsd = 0;
  let lastCallAt = 0;
  for (const call of calls) {
    tokensIn += call.tokensIn;
    tokensOut += call.tokensOut;
    costUsd += call.costUsd;
    if (call._creationTime > lastCallAt) {
      lastCallAt = call._creationTime;
    }
  }

  return {
    tracked: true,
    calls: calls.length,
    tokensIn,
    tokensOut,
    costUsd,
    ...(lastCallAt > 0 ? { lastCallAt } : {}),
  };
}

/** Source-doc fact-review status for one institution (generate-course gating). */
export const listSourceDocFactReviews = query({
  args: { institutionId: v.id("institutions") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const docs = await ctx.db
      .query("sourceDocs")
      .withIndex("by_institution", (q) => q.eq("institutionId", args.institutionId))
      .take(500);

    const rows: Array<{
      sourceDocId: Id<"sourceDocs">;
      status: SourceDocFactReviewStatus;
      llmConfigured: boolean;
      extractionComplete: boolean;
      extractedPages: number;
      expectedPages: number;
      facts: SourceDocFactCounts;
      titleHint?: string;
      llmUsage: {
        tracked: boolean;
        calls: number;
        tokensIn: number;
        tokensOut: number;
        costUsd: number;
        lastCallAt?: number;
      };
    }> = [];

    const llmConfigured =
      typeof process.env.OPENROUTER_API_KEY === "string" &&
      process.env.OPENROUTER_API_KEY.trim().length > 0;

    for (const doc of docs) {
      const [review, firstSlide, llmUsage] = await Promise.all([
        getSourceDocFactReviewFromDoc(ctx, doc),
        ctx.db
          .query("slides")
          .withIndex("by_source_doc_and_n", (q) =>
            q.eq("sourceDocId", doc._id).eq("n", 1)
          )
          .unique(),
        summarizeSourceDocLlmUsage(ctx, doc._id),
      ]);

      const filenameHint =
        typeof doc.originalFilename === "string" && doc.originalFilename.trim().length > 0
          ? humanizeFilename(doc.originalFilename)
          : undefined;
      const titleHint = filenameHint ?? titleFromSlideText(firstSlide?.text);

      rows.push({
        sourceDocId: doc._id,
        status: review.status,
        llmConfigured,
        extractionComplete: review.extractionComplete,
        extractedPages: review.extractedPages,
        expectedPages: review.expectedPages,
        facts: review.facts,
        ...(titleHint ? { titleHint } : {}),
        llmUsage,
      });
    }

    return rows;
  },
});

/** Pending review items waiting at a gate, oldest first. */
export const gateQueue = query({
  args: { gate: reviewGateValidator },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    return await ctx.db
      .query("reviewItems")
      .withIndex("by_gate_and_status", (q) =>
        q.eq("gate", args.gate).eq("status", "pending")
      )
      .take(100);
  },
});
