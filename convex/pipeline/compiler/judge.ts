import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import type { ActionCtx } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import { internal } from "../../_generated/api";
import { createOpenRouterClient } from "../llm/client";
import { modelForTask } from "../llm/models";
import { PROMPTS } from "../prompts";
import { reconstructCourseDefinition } from "../courses";
import { judgeCourse } from "./judgeCore";

/**
 * The QA_RUNNING stage (M4): an adversarial judge on a different model
 * family than the author. Mechanical pre-pass in code (redundancy
 * candidates, excluded-fact leak hard fail), then one LLM pass classifying
 * every narration sentence (traced / derived / unsupported), confirming
 * redundancy, and linting pedagogy. The judge only flags — it never edits.
 * Flags persist to microUnits.qa (per unit) and courses.qa (course level);
 * the workflow routes to QA_FLAGGED or QA_PASSED on the returned verdict.
 */

type JudgeResult =
  | {
      status: "passed" | "flagged";
      errorCount: number;
      warningCount: number;
    }
  | { status: "failed"; cause: string };

export const runQaJudge = internalAction({
  args: { runId: v.id("runs") },
  handler: async (ctx, args): Promise<JudgeResult> => {
    try {
      return await runQaJudgeInner(ctx, args.runId);
    } catch (error) {
      const cause = error instanceof Error ? error.message : String(error);
      console.error(`[pipeline] run ${args.runId}: QA judge failed`, cause);
      return { status: "failed", cause };
    }
  },
});

async function runQaJudgeInner(
  ctx: ActionCtx,
  runId: Id<"runs">
): Promise<JudgeResult> {
  const rows = await ctx.runQuery(
    internal.pipeline.courses.getCourseForRunInternal,
    { runId }
  );
  if (!rows) {
    return { status: "failed", cause: "run has no compiled course to judge" };
  }
  const definition = reconstructCourseDefinition(
    rows.course,
    rows.units,
    rows.questions
  );
  const inventory = await ctx.runQuery(
    internal.pipeline.courses.getReviewedInventoryInternal,
    { runId }
  );

  // Resolve media-card asset captions so the judge can assess relevance
  // (media-irrelevant flags) without seeing pixels.
  const assetRefs = definition.modules.flatMap((module) =>
    module.microUnits.flatMap((unit) =>
      unit.content.cards
        .map((card) => card.props.assetRef)
        .filter((ref): ref is string => typeof ref === "string")
    )
  );
  const assetCaptions: Record<string, string> =
    assetRefs.length > 0
      ? await ctx.runQuery(internal.pipeline.assetsCatalogue.getAssetCaptions, {
          assetIds: assetRefs,
        })
      : {};

  const judgeModel = modelForTask("judge-course");
  const result = await judgeCourse(
    createOpenRouterClient(),
    definition,
    {
      concepts: inventory.concepts,
      facts: inventory.facts,
      excludedFacts: inventory.excludedFacts,
    },
    { judgeModel, assetCaptions }
  );

  for (const usage of result.usages) {
    await ctx.runMutation(internal.pipeline.llmCalls.recordLlmCall, {
      runId,
      stage: "judge-course",
      promptVersion: PROMPTS["judge-course"].versionTag,
      model: usage.model,
      tokensIn: usage.tokensIn,
      tokensOut: usage.tokensOut,
      costUsd: usage.costUsd,
      latencyMs: usage.latencyMs,
    });
  }

  // Persist per-unit QA; clean units advance to qa_passed.
  const unitIdByKey = new Map(rows.units.map((unit) => [unit.unitKey, unit._id]));
  for (const [unitKey, qa] of Object.entries(result.unitQas)) {
    const microUnitId = unitIdByKey.get(unitKey);
    if (!microUnitId) continue;
    const clean = qa.flags.every((flag) => flag.severity !== "error");
    await ctx.runMutation(internal.pipeline.courses.setUnitQa, {
      microUnitId,
      qa,
      state: clean ? "qa_passed" : "draft",
    });
  }
  await ctx.runMutation(internal.pipeline.courses.setCourseQa, {
    courseId: rows.course._id,
    qa: {
      pass: result.verdict === "passed",
      courseFlags: result.courseFlags,
      errorCount: result.errorCount,
      warningCount: result.warningCount,
      redundancyCandidates: result.redundancyCandidates,
      judgePromptVersion: PROMPTS["judge-course"].versionTag,
      judgeModel,
      judgedAt: Date.now(),
    },
  });

  console.log(
    `[pipeline] run ${runId}: QA judge ${result.verdict} — ` +
      `${result.errorCount} error(s), ${result.warningCount} warning(s)`
  );
  return {
    status: result.verdict,
    errorCount: result.errorCount,
    warningCount: result.warningCount,
  };
}
