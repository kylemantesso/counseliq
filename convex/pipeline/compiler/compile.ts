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
import { type LlmModelRouting, type LlmTask } from "../llm/models";
import { supportsAvatarOverlay, type CoursePresentation } from "@counseliq/course-schema";
import {
  AUTHOR_UNIT_JSON_SCHEMA,
  COMPILE_STRUCTURE_JSON_SCHEMA,
  DRAFT_QUESTION_JSON_SCHEMA,
} from "../llm/schemas";
import { PROMPTS } from "../prompts";
import { definitionToWire } from "../courses";
import {
  llmAuthoredUnitLenientSchema,
  llmAuthoredUnitSchema,
  llmCompileStructureSchema,
  llmDraftQuestionSchema,
  type LlmAuthoredUnit,
  type LlmCompileStructure,
} from "./schemas";
import {
  MODULE_RANGE_DEFAULT,
  UNIT_RANGE_DEFAULT,
  buildStructureUserText,
  buildUnitUserText,
  factForPrompt,
  mediaContextFromCatalogue,
  normalizeOpeningTitleCard,
  normalizeCardEnterAtAnchors,
  parseRange,
  partitionComplianceViolations,
  plansFromOutline,
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
function compileParallelism(): number {
  const raw = Number(process.env.COMPILE_PARALLELISM);
  return Number.isFinite(raw) && raw >= 1
    ? Math.floor(raw)
    : DEFAULT_PARALLELISM;
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

function defaultClient(modelRouting?: Partial<LlmModelRouting>): LlmClient {
  return createOpenRouterClient({ modelRouting });
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
  | {
      status: "ok";
      authored: LlmAuthoredUnit;
      promptVersion: string;
      model: string;
      /** Non-blocking rule violations, surfaced at gate 2. */
      complianceWarnings?: string[];
    }
  | { status: "error"; cause: string };

// --- Per-unit authoring (used by the workpool action and direct retries) ---

async function authorOneUnit(
  ctx: ActionCtx,
  client: LlmClient,
  args: {
    runId: Id<"runs">;
    plan: UnitPlan;
    courseTitle: string;
    authorModel: string;
    feedback?: string;
    bypassCache?: boolean;
  }
): Promise<AuthoringRecord> {
  const isRecoverableAuthorValidationFailure = (message: string): boolean =>
    message.includes("cards[0] must be a title-card") ||
    message.includes("opening title-card must anchor") ||
    message.includes("enterAt.word") ||
    message.includes("full-card display type") ||
    message.includes("anchor takeaway text is");

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
  const presentation = inventory.presentation as CoursePresentation | undefined;

  // The cleared catalogue is part of the authoring input: new uploads or
  // rights declarations change its hash, so a recompile re-authors with
  // the richer library instead of hitting a stale cache entry.
  const catalogue = await ctx.runQuery(
    internal.pipeline.assetsCatalogue.getClearedCatalogueForRun,
    { runId: args.runId }
  );
  const media = mediaContextFromCatalogue(catalogue);

  const promptVersion = PROMPTS["author-unit"].versionTag;
  const model = args.authorModel;
  const approvedSourceLabels = new Set(
    facts
      .map((fact) => (typeof fact.sourceLabel === "string" ? fact.sourceLabel.trim() : ""))
      .filter((label) => label.length > 0)
  );
  const cacheKey = sha256(
    JSON.stringify({
      plan: args.plan,
      facts: facts.map(factForPrompt),
      promptVersion,
      model,
      feedback: args.feedback ?? null,
      catalogueHash: sha256(JSON.stringify(catalogue)),
      brief: inventory.brief ?? null,
    })
  );

  const normalizeGeneratedUnit = (unit: LlmAuthoredUnit) => {
    const opened = normalizeOpeningTitleCard(unit, {
      unitTitle: args.plan.title,
      moduleId: args.plan.moduleId,
      institutionName: inventory.institution.name,
      courseTitle: args.courseTitle,
    });
    const normalized = normalizeCardEnterAtAnchors(opened);
    if (presentation?.mode !== "avatar") return normalized;

    // The title is always video-backed. Limit additional overlays to a
    // readable mixed sequence even when an author model over-selects them.
    let nonTitleOverlays = 0;
    const cards = normalized.authored.cards.map((card, index) => {
      if (index === 0 && card.template === "title-card") {
        return { ...card, visualTreatment: "avatar-overlay" as const };
      }
      if (!supportsAvatarOverlay(card.template)) {
        return { ...card, visualTreatment: "standard" as const };
      }
      const requested = card.visualTreatment === "avatar-overlay";
      const cadenceSlot = index > 1 && index % 3 === 2;
      const useOverlay = nonTitleOverlays < 2 && (requested || cadenceSlot);
      if (useOverlay) nonTitleOverlays += 1;
      return { ...card, visualTreatment: useOverlay ? ("avatar-overlay" as const) : ("standard" as const) };
    });
    return { ...normalized, authored: { ...normalized.authored, cards } };
  };

  if (!args.bypassCache) {
    const cached = (await ctx.runQuery(
      internal.pipeline.courses.getUnitAuthoring,
      { runId: args.runId, unitId: args.plan.unitId, cacheKey }
    )) as AuthoringRecord | null;
    if (cached !== null && cached.status === "ok") {
      const normalized = normalizeGeneratedUnit(cached.authored);
      const allWarnings = [
        ...(cached.complianceWarnings ?? []),
        ...normalized.warnings,
      ];
      return {
        ...cached,
        authored: normalized.authored,
        ...(allWarnings.length > 0
          ? { complianceWarnings: [...new Set(allWarnings)] }
          : {}),
      };
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
    catalogue,
    inventory.brief ?? undefined,
    args.feedback
  );

  const callAuthorOnce = async (
    feedback: string | undefined,
    schema: typeof llmAuthoredUnitSchema
  ) => {
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
      schema
    );
    await recordUsages(ctx, args.runId, "author-unit", usages);
    return value;
  };

  // Same provider flake as the structure pass (see runCompilation): the
  // model occasionally emits a broken JSON fragment on BOTH of
  // completeStructured's attempts. Feedback can't fix a decode flake, so
  // re-issue the call fresh a couple of times before giving up.
  const AUTHOR_JSON_ATTEMPTS = 3;
  const callAuthor = async (feedback?: string) => {
    let lastError: unknown;
    let lastMessage = "";
    for (let attempt = 1; attempt <= AUTHOR_JSON_ATTEMPTS; attempt++) {
      try {
        return await callAuthorOnce(feedback, llmAuthoredUnitSchema);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        lastMessage = message;
        // Re-roll decode flakes AND schema near-misses (e.g. a 162-char
        // anchor): a fresh sample usually lands inside the caps, and a
        // run must not die on one bad roll.
        if (
          !message.includes("invalid JSON") &&
          !message.includes("failed validation")
        ) {
          throw error;
        }
        lastError = error;
        console.log(
          `[pipeline] run ${args.runId}: unit ${args.plan.unitId} author attempt ${attempt}/${AUTHOR_JSON_ATTEMPTS} failed (${message.includes("invalid JSON") ? "broken JSON" : "schema validation"}), re-issuing`
        );
      }
    }

    if (
      lastError !== undefined &&
      lastMessage.includes("failed validation") &&
      isRecoverableAuthorValidationFailure(lastMessage)
    ) {
      console.log(
        `[pipeline] run ${args.runId}: unit ${args.plan.unitId} strict validation exhausted; trying lenient validation fallback`
      );
      return await callAuthorOnce(feedback, llmAuthoredUnitLenientSchema);
    }

    throw lastError;
  };

  let record: AuthoringRecord;
  try {
    let normalized = normalizeGeneratedUnit(await callAuthor());
    let authored = normalized.authored;
    let anchorWarnings = normalized.warnings;
    let violations = unitComplianceViolations(
      authored,
      knownProvenanceIds,
      media,
      approvedSourceLabels
    );
    if (violations.length > 0) {
      console.log(
        `[pipeline] run ${args.runId}: unit ${args.plan.unitId} failed compliance, retrying once — ${violations.join("; ")}`
      );
      normalized = normalizeGeneratedUnit(
        await callAuthor(
          `Your previous draft violated these code-enforced rules — fix ALL of them and output the full corrected unit:\n- ${violations.join("\n- ")}`
        )
      );
      authored = normalized.authored;
      anchorWarnings = normalized.warnings;
      violations = unitComplianceViolations(
        authored,
        knownProvenanceIds,
        media,
        approvedSourceLabels
      );
    }
    // Fail-open: every remaining compliance violation ships as a gate-2
    // warning on the unit.
    const { blocking, warnings } = partitionComplianceViolations(violations);
    if (blocking.length > 0) {
      record = {
        status: "error",
        cause: `unit ${args.plan.unitId} failed compliance after retry: ${blocking.join("; ")}`,
      };
    } else {
      const allWarnings = [...new Set([...warnings, ...anchorWarnings])];
      if (anchorWarnings.length > 0) {
        console.log(
          `[pipeline] run ${args.runId}: unit ${args.plan.unitId} repaired ${anchorWarnings.length} timing anchor(s)`
        );
      }
      if (allWarnings.length > 0) {
        console.log(
          `[pipeline] run ${args.runId}: unit ${args.plan.unitId} accepted with ${allWarnings.length} warning(s) for gate-2 review`
        );
      }
      record = {
        status: "ok",
        authored,
        promptVersion,
        model,
        ...(allWarnings.length > 0 ? { complianceWarnings: allWarnings } : {}),
      };
    }
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
      mediaAssetIds: v.optional(v.array(v.string())),
    }),
    courseTitle: v.string(),
    feedback: v.optional(v.string()),
    authorModel: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const authorModel =
      args.authorModel ??
      (
        await ctx.runQuery(internal.pipeline.queries.getLlmModelRoutingInternal, {})
      )["author-unit"];
    const record = await authorOneUnit(
      ctx,
      defaultClient({ "author-unit": authorModel }),
      {
      runId: args.runId,
      plan: args.plan,
      courseTitle: args.courseTitle,
      authorModel,
      ...(args.feedback !== undefined ? { feedback: args.feedback } : {}),
      }
    );
    return { status: record.status };
  },
});

// --- Single-question regeneration (gate-2 UI) ---

export const regenerateQuestion = internalAction({
  args: {
    runId: v.id("runs"),
    questionId: v.id("questions"),
  },
  handler: async (ctx, args) => {
    const context = await ctx.runQuery(
      internal.pipeline.courses.getQuestionContextInternal,
      { questionId: args.questionId }
    );
    const body = context.question.body as QuestionBankItem;
    const inventory: ReviewedInventory = await ctx.runQuery(
      internal.pipeline.courses.getReviewedInventoryInternal,
      { runId: args.runId }
    );
    const facts = inventory.facts.filter(
      (fact) => fact.conceptKey === (context.unit?.meta?.conceptKey ?? body.conceptTag)
        || fact.conceptKey === body.conceptTag
    );

    const userText = [
      `Regenerate ONE ${body.type === "commit" ? "commit (hook)" : "retrieve (MCQ)"} question for a micro-learning unit.`,
      `Concept tag: ${body.conceptTag}`,
      context.unit
        ? `Unit narration:\n${JSON.stringify(context.unit.narration, null, 2)}`
        : "",
      ``,
      `Approved facts (the ONLY factual grounding):`,
      JSON.stringify(facts.map(factForPrompt), null, 2),
      ``,
      `The current question (write a DIFFERENT question testing the same concept):`,
      JSON.stringify(
        {
          prompt: body.prompt,
          options: body.options,
          correctIndex: body.correctIndex,
          explanation: body.explanation,
        },
        null,
        2
      ),
      ``,
      `Prompts already used elsewhere in this course (yours must not duplicate any):`,
      JSON.stringify(context.otherPrompts, null, 2),
      ``,
      `Output ONLY a JSON object with prompt, options (2-4), correctIndex, explanation.`,
    ].join("\n");

    const modelRouting = await ctx.runQuery(
      internal.pipeline.queries.getLlmModelRoutingInternal,
      {}
    );
    const client = defaultClient(modelRouting);
    const { value, usages } = await completeStructured(
      client,
      "author-unit",
      {
        system: PROMPTS["author-unit"].content,
        user: [{ type: "text", text: userText }],
        schemaName: "draft_question",
        jsonSchema: DRAFT_QUESTION_JSON_SCHEMA,
      },
      llmDraftQuestionSchema
    );
    await recordUsages(ctx, args.runId, "author-unit", usages);

    await ctx.runMutation(internal.pipeline.courses.replaceQuestionBody, {
      questionId: args.questionId,
      prompt: value.prompt,
      options: value.options,
      correctIndex: value.correctIndex,
      explanation: value.explanation,
    });
    console.log(
      `[pipeline] run ${args.runId}: regenerated question ${body.id}`
    );
    return null;
  },
});

// --- Orchestrator ---

type CompilationResult =
  | {
      status: "ok";
      unitCount: number;
      moduleCount: number;
      questionCount: number;
      warning?: string;
    }
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
  const modelRouting = await ctx.runQuery(
    internal.pipeline.queries.getLlmModelRoutingInternal,
    {}
  );
  const authorModel = modelRouting["author-unit"];
  const client = defaultClient(modelRouting);
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
      models: modelRouting,
    },
  });

  const partial = reAuthorUnitIds !== undefined && reAuthorUnitIds.length > 0;

  // --- Plan: approved outline (M6.5), structure pass (legacy full), or
  // stored structure (re-authoring) ---
  const approvedOutline = partial
    ? null
    : await ctx.runQuery(
        internal.pipeline.outlineReview.getApprovedOutlineForRun,
        { runId }
      );
  let courseTitle: string;
  let moduleOrder: Array<{ moduleId: string; title: string }>;
  let plans: UnitPlan[];
  /** Untouched units carried over verbatim during partial re-authoring. */
  let preserved: AuthoredUnitWithPlan[] = [];
  const feedbackByUnitId = new Map<string, string>();
  /** Authoritative unit sequence for assembly (modules keep planned order). */
  const orderedUnitIds: string[] = [];
  let unitCountWarning: string | undefined;

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
      orderedUnitIds.push(plan.unitId);
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
  } else if (approvedOutline) {
    // M6.5: an approved outline (edited by the operator) IS the plan —
    // skip the inline structure LLM pass entirely.
    const mapped = plansFromOutline(approvedOutline);
    courseTitle = mapped.courseTitle;
    moduleOrder = mapped.moduleOrder;
    plans = mapped.plans;
    orderedUnitIds.push(...plans.map((plan) => plan.unitId));
    console.log(
      `[pipeline] run ${runId}: authoring from the approved outline — ${plans.length} unit(s) across ${moduleOrder.length} module(s)`
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
    // completeStructured already feeds validator errors back once; providers
    // occasionally truncate output mid-JSON on BOTH attempts, so re-issue
    // the whole (single, cheap) structure call a couple of times. Failures
    // carry into the next attempt as feedback — the model systematically
    // over-plans units without seeing the violation.
    const STRUCTURE_ATTEMPTS = 3;
    let structure: LlmCompileStructure | undefined;
    let structureFeedback: string | undefined;
    for (let attempt = 1; attempt <= STRUCTURE_ATTEMPTS; attempt++) {
      try {
        const baseText = buildStructureUserText(inventory, unitRange, moduleRange);
        const { value, usages } = await completeStructured(
          client,
          "compile-structure",
          {
            system: PROMPTS["compile-structure"].content,
            user: [
              {
                type: "text",
                text: structureFeedback
                  ? `${baseText}\n\nYour previous plan failed a code-enforced rule — fix it and output the corrected full plan:\n- ${structureFeedback}`
                  : baseText,
              },
            ],
            schemaName: "compile_structure",
            jsonSchema: COMPILE_STRUCTURE_JSON_SCHEMA,
          },
          llmCompileStructureSchema
        );
        await recordUsages(ctx, runId, "compile-structure", usages);
        // Soft-enforce unit budget as an operational warning only.
        const totalUnits = value.modules.reduce(
          (sum, m) => sum + m.units.length,
          0
        );
        if (totalUnits > unitRange[1]) {
          unitCountWarning =
            `structure pass planned ${totalUnits} units; target is ${unitRange[0]}-${unitRange[1]} units`;
          console.warn(`[pipeline] run ${runId}: ${unitCountWarning}`);
        }
        structure = value;
        break;
      } catch (error) {
        structureFeedback =
          error instanceof Error ? error.message : String(error);
        console.warn(
          `[pipeline] run ${runId}: structure pass attempt ${attempt}/${STRUCTURE_ATTEMPTS} failed — ${structureFeedback}`
        );
        if (attempt === STRUCTURE_ATTEMPTS) throw error;
      }
    }
    if (!structure) {
      return { status: "failed", cause: "structure pass produced no output" };
    }

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
    orderedUnitIds.push(...plans.map((plan) => plan.unitId));
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
      authorModel,
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
  let failures: string[] = [];
  const authoredUnits: AuthoredUnitWithPlan[] = [];
  const failedPlans: UnitPlan[] = [];
  for (const plan of plans) {
    const record = recordsByUnitId.get(plan.unitId);
    if (!record) {
      failures.push(`unit ${plan.unitId}: no authoring result`);
      failedPlans.push(plan);
    } else if (record.status === "error") {
      failures.push(record.cause);
      failedPlans.push(plan);
    } else {
      const repaired = normalizeCardEnterAtAnchors(record.authored);
      const mergedWarnings = [
        ...(record.complianceWarnings ?? []),
        ...repaired.warnings,
      ];
      if (repaired.warnings.length > 0) {
        console.log(
          `[pipeline] run ${runId}: unit ${plan.unitId} repaired ${repaired.warnings.length} cached timing anchor(s)`
        );
      }
      authoredUnits.push({
        plan,
        authored: repaired.authored,
        ...(mergedWarnings.length > 0
          ? { complianceWarnings: [...new Set(mergedWarnings)] }
          : {}),
      });
    }
  }

  // Second-chance round: units that failed their in-pool retry (compliance
  // or parse flakes) get ONE fresh authoring attempt with the failure as
  // feedback before the whole compilation is declared failed.
  if (failedPlans.length > 0 && failedPlans.length <= plans.length) {
    console.log(
      `[pipeline] run ${runId}: re-attempting ${failedPlans.length} failed unit(s) once — ${failures.join(" | ")}`
    );
    const remaining: string[] = [];
    for (const plan of failedPlans) {
      const priorCause = failures.find((f) => f.includes(plan.unitId));
      const record = await authorOneUnit(ctx, client, {
        runId,
        plan,
        courseTitle,
        authorModel,
        ...(priorCause !== undefined
          ? {
              feedback: `A previous attempt at this unit failed: ${priorCause}. Avoid that failure mode.`,
            }
          : {}),
        bypassCache: true,
      });
      if (record.status === "ok") {
        authoredUnits.push({
          plan,
          authored: record.authored,
          ...(record.complianceWarnings !== undefined
            ? { complianceWarnings: record.complianceWarnings }
            : {}),
        });
      } else {
        remaining.push(record.cause);
      }
    }
    failures = remaining;
  }
  if (failures.length > 0) {
    return {
      status: "failed",
      cause: `unit authoring failed for ${failures.length} unit(s): ${failures.join(" | ")}`,
    };
  }

  // --- Assemble + course-level checks (one duplicate-prompt retry round) ---
  // Assembly appends units to modules in array order, so restore the planned
  // sequence (second-chance units were pushed to the end above).
  const plannedOrder = new Map<string, number>(
    orderedUnitIds.map((unitId, index) => [unitId, index])
  );
  let allUnits = [...preserved, ...authoredUnits].sort(
    (a, b) =>
      (plannedOrder.get(a.plan.unitId) ?? 0) -
      (plannedOrder.get(b.plan.unitId) ?? 0)
  );
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
        authorModel,
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
    complianceWarningsByUnitId: Object.fromEntries(
      allUnits
        .filter((unit) => (unit.complianceWarnings ?? []).length > 0)
        .map((unit) => [unit.plan.unitId, unit.complianceWarnings ?? []])
    ),
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
    ...(unitCountWarning ? { warning: unitCountWarning } : {}),
  };
}
