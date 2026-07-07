"use node";

import { createHash } from "node:crypto";
import { v } from "convex/values";
import { Workpool } from "@convex-dev/workpool";
import type { QuestionBankItem } from "@counseliq/course-schema";
import { internalAction } from "../../_generated/server";
import type { ActionCtx } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import { components, internal } from "../../_generated/api";
import {
  completeStructured,
  createOpenRouterClient,
  type LlmClient,
  type LlmUsage,
} from "../llm/client";
import { currentModelRouting, modelForTask, type LlmTask } from "../llm/models";
import {
  AUTHOR_UNIT_JSON_SCHEMA,
  COMPILE_STRUCTURE_JSON_SCHEMA,
} from "../llm/schemas";
import { PROMPTS } from "../prompts";
import { definitionToWire } from "../courses";
import {
  llmAuthoredUnitSchema,
  llmCompileStructureSchema,
  type LlmAuthoredUnit,
} from "./schemas";
import {
  buildStructureUserText,
  buildUnitUserText,
  factForPrompt,
  tryAssemble,
  unitComplianceViolations,
  type AuthoredUnitWithPlan,
  type ReviewedInventory,
  type UnitPlan,
} from "./assemble";

/**
 * The real COMPILING stage (M4): a two-pass, schema-gated compiler.
 *
 * Pass 1 (structure): ONE LLM call turns the reviewed inventory into a
 * module/unit skeleton (one concept per unit). Pass 2 (authoring): fan-out
 * per unit through the compilePool workpool — each call drafts narration,
 * cards, hook + retrieve questions, and an anchor for one unit, then passes
 * code-enforced compliance rules (banned claims, generic-card cap, card
 * provenance, statistic source labels) with ONE feedback retry. Assembly +
 * Zod validation of the full CourseDefinition happens in code; excluded
 * facts are filtered in code before any prompt is built.
 */

const DEFAULT_PARALLELISM = 3;
const COMPILE_TIMEOUT_MS_DEFAULT = 15 * 60 * 1000;
const POLL_INTERVAL_MS = 2000;
const UNIT_RANGE_DEFAULT: [number, number] = [8, 12];
const MODULE_RANGE_DEFAULT: [number, number] = [3, 5];

function compileParallelism(): number {
  const raw = Number(process.env.COMPILE_PARALLELISM);
  return Number.isFinite(raw) && raw >= 1
    ? Math.floor(raw)
    : DEFAULT_PARALLELISM;
}

function parseRange(
  raw: string | undefined,
  fallback: [number, number]
): [number, number] {
  const match = raw?.match(/^(\d+)-(\d+)$/);
  if (!match) return fallback;
  return [Number(match[1]), Number(match[2])];
}

export const compilePool = new Workpool(components.compilePool, {
  maxParallelism: compileParallelism(),
  retryActionsByDefault: true,
  defaultRetryBehavior: {
    maxAttempts: 3,
    initialBackoffMs: 2000,
    base: 2,
  },
});

function defaultClient(): LlmClient {
  return createOpenRouterClient();
}

async function recordUsages(
  ctx: ActionCtx,
  runId: Id<"runs">,
  stage: LlmTask,
  usages: LlmUsage[]
): Promise<void> {
  for (const usage of usages) {
    await ctx.runMutation(internal.pipeline.llmCalls.recordLlmCall, {
      runId,
      stage,
      promptVersion: PROMPTS[stage].versionTag,
      model: usage.model,
      tokensIn: usage.tokensIn,
      tokensOut: usage.tokensOut,
      costUsd: usage.costUsd,
      latencyMs: usage.latencyMs,
    });
  }
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

type AuthoringRecord =
  | { status: "ok"; authored: LlmAuthoredUnit; promptVersion: string; model: string }
  | { status: "error"; cause: string };

// --- Per-unit authoring (used by the workpool action and direct retries) ---

async function authorOneUnit(
  ctx: ActionCtx,
  client: LlmClient,
  args: {
    runId: Id<"runs">;
    plan: UnitPlan;
    courseTitle: string;
    feedback?: string;
    bypassCache?: boolean;
  }
): Promise<AuthoringRecord> {
  const inventory: ReviewedInventory = await ctx.runQuery(
    internal.pipeline.courses.getReviewedInventoryInternal,
    { runId: args.runId }
  );
  const concept = inventory.concepts.find(
    (c) => c.key === args.plan.conceptKey
  );
  const facts = inventory.facts.filter(
    (f) => f.conceptKey === args.plan.conceptKey
  );
  const lexicon = inventory.institution.pronunciationLexicon;
  const lexiconNames =
    lexicon !== null && typeof lexicon === "object"
      ? Object.keys(lexicon as Record<string, unknown>)
      : [];

  const promptVersion = PROMPTS["author-unit"].versionTag;
  const model = modelForTask("author-unit");
  const cacheKey = sha256(
    JSON.stringify({
      plan: args.plan,
      facts: facts.map(factForPrompt),
      promptVersion,
      model,
      feedback: args.feedback ?? null,
    })
  );

  if (!args.bypassCache) {
    const cached = (await ctx.runQuery(
      internal.pipeline.courses.getUnitAuthoring,
      { runId: args.runId, unitId: args.plan.unitId, cacheKey }
    )) as AuthoringRecord | null;
    if (cached !== null && cached.status === "ok") {
      return cached;
    }
  }

  const knownProvenanceIds = new Set(inventory.provenanceIds);
  const userText = buildUnitUserText(
    args.plan,
    concept,
    facts,
    args.courseTitle,
    inventory.institution.name,
    lexiconNames,
    args.feedback
  );

  const callAuthor = async (feedback?: string) => {
    const { value, usages } = await completeStructured<LlmAuthoredUnit>(
      client,
      "author-unit",
      {
        system: PROMPTS["author-unit"].content,
        user: [
          { type: "text", text: feedback ? `${userText}\n\n${feedback}` : userText },
        ],
        schemaName: "authored_unit",
        jsonSchema: AUTHOR_UNIT_JSON_SCHEMA,
      },
      llmAuthoredUnitSchema
    );
    await recordUsages(ctx, args.runId, "author-unit", usages);
    return value;
  };

  let record: AuthoringRecord;
  try {
    let authored = await callAuthor();
    let violations = unitComplianceViolations(authored, knownProvenanceIds);
    if (violations.length > 0) {
      console.log(
        `[pipeline] run ${args.runId}: unit ${args.plan.unitId} failed compliance, retrying once — ${violations.join("; ")}`
      );
      authored = await callAuthor(
        `Your previous draft violated these code-enforced rules — fix ALL of them and output the full corrected unit:\n- ${violations.join("\n- ")}`
      );
      violations = unitComplianceViolations(authored, knownProvenanceIds);
    }
    record =
      violations.length > 0
        ? {
            status: "error",
            cause: `unit ${args.plan.unitId} failed compliance after retry: ${violations.join("; ")}`,
          }
        : { status: "ok", authored, promptVersion, model };
  } catch (error) {
    record = {
      status: "error",
      cause: `unit ${args.plan.unitId}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  // Failed authorings store the error marker under a cacheKey that will not
  // match next time (so they are re-attempted); successes are reusable.
  await ctx.runMutation(internal.pipeline.courses.saveUnitAuthoring, {
    runId: args.runId,
    unitId: args.plan.unitId,
    cacheKey: record.status === "ok" ? cacheKey : `failed:${cacheKey}`,
    result: record,
  });
  return record;
}

/** Workpool entry point: author one unit (idempotent via the cache). */
export const authorUnit = internalAction({
  args: {
    runId: v.id("runs"),
    plan: v.object({
      unitId: v.string(),
      conceptKey: v.string(),
      conceptTag: v.string(),
      title: v.string(),
      secondsBudget: v.number(),
      moduleId: v.string(),
      moduleTitle: v.string(),
    }),
    courseTitle: v.string(),
    feedback: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const record = await authorOneUnit(ctx, defaultClient(), {
      runId: args.runId,
      plan: args.plan,
      courseTitle: args.courseTitle,
      ...(args.feedback !== undefined ? { feedback: args.feedback } : {}),
    });
    return { status: record.status };
  },
});

// --- Orchestrator ---

type CompilationResult =
  | { status: "ok"; unitCount: number; moduleCount: number; questionCount: number }
  | { status: "failed"; cause: string };

export const runCompilation = internalAction({
  args: {
    runId: v.id("runs"),
    reAuthorUnitIds: v.optional(v.array(v.id("microUnits"))),
  },
  handler: async (ctx, args): Promise<CompilationResult> => {
    try {
      return await runCompilationInner(ctx, args.runId, args.reAuthorUnitIds);
    } catch (error) {
      const cause = error instanceof Error ? error.message : String(error);
      console.error(`[pipeline] run ${args.runId}: compilation failed`, cause);
      return { status: "failed", cause };
    }
  },
});

async function runCompilationInner(
  ctx: ActionCtx,
  runId: Id<"runs">,
  reAuthorUnitIds?: Id<"microUnits">[]
): Promise<CompilationResult> {
  const client = defaultClient();
  const inventory: ReviewedInventory = await ctx.runQuery(
    internal.pipeline.courses.getReviewedInventoryInternal,
    { runId }
  );
  if (inventory.concepts.length === 0) {
    return { status: "failed", cause: "no concepts in the reviewed inventory" };
  }

  // Record prompt versions + models (merged with the extraction entries).
  const { run } = await ctx.runQuery(internal.pipeline.queries.getRunInternal, {
    runId,
  });
  if (!run) return { status: "failed", cause: "run not found" };
  await ctx.runMutation(internal.pipeline.inventory.setRunPromptVersions, {
    runId,
    promptVersions: {
      ...(run.promptVersions as Record<string, unknown>),
      "compile-structure": PROMPTS["compile-structure"].versionTag,
      "author-unit": PROMPTS["author-unit"].versionTag,
      "judge-course": PROMPTS["judge-course"].versionTag,
      models: currentModelRouting(),
    },
  });

  const partial = reAuthorUnitIds !== undefined && reAuthorUnitIds.length > 0;

  // --- Plan: structure pass (full) or stored structure (re-authoring) ---
  let courseTitle: string;
  let moduleOrder: Array<{ moduleId: string; title: string }>;
  let plans: UnitPlan[];
  /** Untouched units carried over verbatim during partial re-authoring. */
  let preserved: AuthoredUnitWithPlan[] = [];
  const feedbackByUnitId = new Map<string, string>();

  if (partial) {
    const existing = await ctx.runQuery(
      internal.pipeline.courses.getCourseForRunInternal,
      { runId }
    );
    if (!existing) {
      return { status: "failed", cause: "re-authoring requested but the run has no compiled course" };
    }
    courseTitle = existing.course.title;
    const reAuthorSet = new Set(reAuthorUnitIds);
    moduleOrder = [];
    plans = [];
    for (const unitRow of existing.units) {
      const meta = unitRow.meta as {
        secondsBudget: number;
        hook: { questionRef: string };
        retrieve: string[];
        anchor: { template: string; props: Record<string, unknown> };
        conceptKey?: string;
        order: { module: number; unit: number };
      };
      if (!moduleOrder.some((m) => m.moduleId === unitRow.moduleKey)) {
        moduleOrder.push({
          moduleId: unitRow.moduleKey,
          title: unitRow.moduleTitle ?? unitRow.moduleKey,
        });
      }
      const plan: UnitPlan = {
        unitId: unitRow.unitKey,
        conceptKey: meta.conceptKey ?? unitRow.concept,
        conceptTag: unitRow.concept,
        title: unitRow.unitKey,
        secondsBudget: meta.secondsBudget,
        moduleId: unitRow.moduleKey,
        moduleTitle: unitRow.moduleTitle ?? unitRow.moduleKey,
      };
      if (reAuthorSet.has(unitRow._id)) {
        plans.push(plan);
        const qa = unitRow.qa as
          | { flags?: Array<{ code: string; message: string }> }
          | undefined;
        const feedback = (qa?.flags ?? [])
          .map((flag) => `${flag.code}: ${flag.message}`)
          .join("\n- ");
        if (feedback) {
          feedbackByUnitId.set(
            unitRow.unitKey,
            `The QA judge flagged the previous version of this unit:\n- ${feedback}`
          );
        }
      } else {
        // Reconstruct the authored shape from the stored rows so untouched
        // units pass through assembly unchanged.
        const questionById = new Map(
          existing.questions.map((q) => [
            (q.body as QuestionBankItem).id,
            q.body as QuestionBankItem,
          ])
        );
        const hook = questionById.get(meta.hook.questionRef);
        const retrieves = meta.retrieve
          .map((ref) => questionById.get(ref))
          .filter((q): q is QuestionBankItem => q !== undefined);
        if (!hook || retrieves.length !== meta.retrieve.length) {
          return {
            status: "failed",
            cause: `stored unit ${unitRow.unitKey} has dangling question refs`,
          };
        }
        preserved.push({
          plan,
          authored: {
            narration: unitRow.narration,
            cards: unitRow.cards,
            hookQuestion: {
              prompt: hook.prompt,
              options: hook.options,
              correctIndex: hook.correctIndex,
              explanation: hook.explanation,
            },
            retrieveQuestions: retrieves.map((q) => ({
              prompt: q.prompt,
              options: q.options,
              correctIndex: q.correctIndex,
              explanation: q.explanation,
            })),
            anchor: meta.anchor as LlmAuthoredUnit["anchor"],
          },
        });
      }
    }
    if (plans.length === 0) {
      return { status: "failed", cause: "no matching units to re-author" };
    }
    console.log(
      `[pipeline] run ${runId}: re-authoring ${plans.length} unit(s), preserving ${preserved.length}`
    );
  } else {
    const unitRange = parseRange(
      process.env.COMPILE_UNIT_RANGE,
      UNIT_RANGE_DEFAULT
    );
    const moduleRange = parseRange(
      process.env.COMPILE_MODULE_RANGE,
      MODULE_RANGE_DEFAULT
    );
    const { value: structure, usages } = await completeStructured(
      client,
      "compile-structure",
      {
        system: PROMPTS["compile-structure"].content,
        user: [
          {
            type: "text",
            text: buildStructureUserText(inventory, unitRange, moduleRange),
          },
        ],
        schemaName: "compile_structure",
        jsonSchema: COMPILE_STRUCTURE_JSON_SCHEMA,
      },
      llmCompileStructureSchema
    );
    await recordUsages(ctx, runId, "compile-structure", usages);

    // Code check: every planned unit must reference a real inventory concept.
    const conceptKeys = new Set(inventory.concepts.map((c) => c.key));
    const unknown = structure.modules
      .flatMap((m) => m.units)
      .filter((u) => !conceptKeys.has(u.conceptKey));
    if (unknown.length > 0) {
      return {
        status: "failed",
        cause: `structure pass invented concept keys: ${unknown.map((u) => `${u.unitId}→${u.conceptKey}`).join(", ")}`,
      };
    }

    courseTitle = structure.courseTitle;
    moduleOrder = structure.modules.map((m) => ({
      moduleId: m.moduleId,
      title: m.title,
    }));
    plans = structure.modules.flatMap((module) =>
      module.units.map((unit) => ({
        unitId: unit.unitId,
        conceptKey: unit.conceptKey,
        conceptTag: unit.conceptTag,
        title: unit.title,
        secondsBudget: unit.secondsBudget,
        moduleId: module.moduleId,
        moduleTitle: module.title,
      }))
    );
    console.log(
      `[pipeline] run ${runId}: structure pass planned ${plans.length} unit(s) across ${moduleOrder.length} module(s)`
    );
  }

  // --- Authoring fan-out ---
  const sequential = process.env.COMPILE_MODE === "sequential";
  const enqueueArgs = plans.map((plan) => {
    const feedback = feedbackByUnitId.get(plan.unitId);
    return {
      runId,
      plan,
      courseTitle,
      ...(feedback !== undefined ? { feedback } : {}),
    };
  });
  if (sequential) {
    for (const unitArgs of enqueueArgs) {
      await ctx.runAction(internal.pipeline.compiler.compile.authorUnit, unitArgs);
    }
  } else {
    const workIds = await compilePool.enqueueActionBatch(
      ctx,
      internal.pipeline.compiler.compile.authorUnit,
      enqueueArgs
    );
    const timeoutMs = Number(
      process.env.COMPILE_TIMEOUT_MS ?? COMPILE_TIMEOUT_MS_DEFAULT
    );
    const startedAt = Date.now();
    for (;;) {
      const statuses = await compilePool.statusBatch(ctx, workIds);
      const finished = statuses.filter((s) => s.state === "finished").length;
      if (finished === workIds.length) break;
      if (Date.now() - startedAt > timeoutMs) {
        return {
          status: "failed",
          cause: `unit authoring timed out after ${timeoutMs}ms (${finished}/${workIds.length} units finished)`,
        };
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }

  // --- Collect authored units ---
  const rows = (await ctx.runQuery(
    internal.pipeline.courses.listUnitAuthoringsForRun,
    { runId }
  )) as Array<{ unitId: string; result: AuthoringRecord }>;
  const recordsByUnitId = new Map(rows.map((row) => [row.unitId, row.result]));
  const failures: string[] = [];
  const authoredUnits: AuthoredUnitWithPlan[] = [];
  for (const plan of plans) {
    const record = recordsByUnitId.get(plan.unitId);
    if (!record) {
      failures.push(`unit ${plan.unitId}: no authoring result`);
    } else if (record.status === "error") {
      failures.push(record.cause);
    } else {
      authoredUnits.push({ plan, authored: record.authored });
    }
  }
  if (failures.length > 0) {
    return {
      status: "failed",
      cause: `unit authoring failed for ${failures.length} unit(s): ${failures.join(" | ")}`,
    };
  }

  // --- Assemble + course-level checks (one duplicate-prompt retry round) ---
  let allUnits = [...preserved, ...authoredUnits];
  let assembly = tryAssemble(inventory, courseTitle, moduleOrder, allUnits);
  if (assembly.duplicatePromptUnitIds.length > 0) {
    const retryIds = new Set(assembly.duplicatePromptUnitIds);
    console.log(
      `[pipeline] run ${runId}: duplicate question prompts — re-authoring ${retryIds.size} unit(s) once`
    );
    for (const plan of plans) {
      if (!retryIds.has(plan.unitId)) continue;
      const record = await authorOneUnit(ctx, client, {
        runId,
        plan,
        courseTitle,
        feedback:
          "A previous draft produced questions with prompts identical to questions in other units of this course. Write DIFFERENT, unit-specific question prompts.",
        bypassCache: true,
      });
      if (record.status === "error") {
        return { status: "failed", cause: record.cause };
      }
      const index = allUnits.findIndex((u) => u.plan.unitId === plan.unitId);
      allUnits[index] = { plan, authored: record.authored };
    }
    assembly = tryAssemble(inventory, courseTitle, moduleOrder, allUnits);
  }
  if (assembly.status === "failed") {
    return { status: "failed", cause: assembly.cause };
  }

  // --- Persist ---
  const saved: {
    courseId: Id<"courses">;
    unitCount: number;
    moduleCount: number;
    questionCount: number;
  } = await ctx.runMutation(internal.pipeline.courses.saveCompiledCourse, {
    runId,
    definition: definitionToWire(assembly.definition),
    conceptKeysByUnitId: assembly.conceptKeysByUnitId,
  });
  console.log(
    `[pipeline] run ${runId}: compiled course ${saved.courseId} — ` +
      `${saved.unitCount} unit(s), ${saved.moduleCount} module(s), ${saved.questionCount} question(s)`
  );
  return {
    status: "ok",
    unitCount: saved.unitCount,
    moduleCount: saved.moduleCount,
    questionCount: saved.questionCount,
  };
}
