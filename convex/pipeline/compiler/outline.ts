"use node";

import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import type { ActionCtx } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import { internal } from "../../_generated/api";
import { completeStructured, createOpenRouterClient } from "../llm/client";
import type { LlmUsage } from "../llm/client";
import { COURSE_OUTLINE_JSON_SCHEMA } from "../llm/schemas";
import { PROMPTS } from "../prompts";
import {
  llmCourseOutlineSchema,
  type LlmCourseOutline,
} from "./schemas";
import {
  MODULE_RANGE_DEFAULT,
  UNIT_RANGE_DEFAULT,
  buildOutlineUserText,
  parseRange,
  type ReviewedInventory,
} from "./assemble";

/**
 * The OUTLINING stage (M6.5): the structure pass extracted into its own
 * step. Proposes course title, learning outcomes, and the module/unit
 * plan from the approved inventory + the CLEARED asset catalogue,
 * directed by the operator brief — then persists it for editing at
 * OUTLINE_REVIEW. No authoring money is spent until the outline is
 * approved. Mirrors the old inline structure pass's retry + code-check
 * discipline exactly.
 */

const OUTLINE_ATTEMPTS = 3;

type OutlineResult =
  | {
      status: "ok";
      unitCount: number;
      moduleCount: number;
      warning?: string;
    }
  | { status: "failed"; cause: string };

async function recordUsages(
  ctx: ActionCtx,
  runId: Id<"runs">,
  usages: LlmUsage[]
): Promise<void> {
  for (const usage of usages) {
    await ctx.runMutation(internal.pipeline.llmCalls.recordLlmCall, {
      runId,
      stage: "outline-course",
      promptVersion: PROMPTS["outline-course"].versionTag,
      model: usage.model,
      tokensIn: usage.tokensIn,
      tokensOut: usage.tokensOut,
      costUsd: usage.costUsd,
      latencyMs: usage.latencyMs,
    });
  }
}

export const runOutlineGeneration = internalAction({
  args: { runId: v.id("runs") },
  handler: async (ctx, args): Promise<OutlineResult> => {
    const modelRouting = await ctx.runQuery(
      internal.pipeline.queries.getLlmModelRoutingInternal,
      {}
    );
    const inventory: ReviewedInventory = await ctx.runQuery(
      internal.pipeline.courses.getReviewedInventoryInternal,
      { runId: args.runId }
    );
    const context = await ctx.runQuery(
      internal.pipeline.outlineReview.getOutlineGenerationContext,
      { runId: args.runId }
    );
    const catalogue = await ctx.runQuery(
      internal.pipeline.assetsCatalogue.getClearedCatalogueForRun,
      { runId: args.runId }
    );

    const unitRange = parseRange(
      process.env.COMPILE_UNIT_RANGE,
      UNIT_RANGE_DEFAULT
    );
    const moduleRange = parseRange(
      process.env.COMPILE_MODULE_RANGE,
      MODULE_RANGE_DEFAULT
    );
    const baseText = buildOutlineUserText(
      inventory,
      unitRange,
      moduleRange,
      context.brief,
      catalogue,
      context.regenFeedback
    );
    const conceptKeys = new Set(inventory.concepts.map((c) => c.key));
    const catalogueIds = new Set(catalogue.map((asset) => asset.id));
    const client = createOpenRouterClient({ modelRouting });

    // Same retry discipline as the old inline structure pass: providers
    // occasionally truncate mid-JSON, and the model over-plans without
    // seeing the violation — code-check failures carry into the next
    // attempt as feedback.
    let outline: LlmCourseOutline | undefined;
    let outlineWarning: string | undefined;
    let attemptFeedback: string | undefined;
    for (let attempt = 1; attempt <= OUTLINE_ATTEMPTS; attempt++) {
      try {
        const { value, usages } = await completeStructured<LlmCourseOutline>(
          client,
          "outline-course",
          {
            system: PROMPTS["outline-course"].content,
            user: [
              {
                type: "text",
                text: attemptFeedback
                  ? `${baseText}\n\nYour previous outline failed a code-enforced rule — fix it and output the corrected full outline:\n- ${attemptFeedback}`
                  : baseText,
              },
            ],
            schemaName: "course_outline",
            jsonSchema: COURSE_OUTLINE_JSON_SCHEMA,
          },
          llmCourseOutlineSchema
        );
        await recordUsages(ctx, args.runId, usages);

        const units = value.modules.flatMap((m) => m.units);
        if (units.length > unitRange[1]) {
          outlineWarning =
            `outline planned ${units.length} units; target is ${unitRange[0]}-${unitRange[1]} units`;
          console.warn(`[pipeline] run ${args.runId}: ${outlineWarning}`);
        }
        const unknownConcepts = units.filter(
          (u) => !conceptKeys.has(u.conceptKey)
        );
        if (unknownConcepts.length > 0) {
          throw new Error(
            `outline invented concept keys: ${unknownConcepts.map((u) => `${u.unitId}→${u.conceptKey}`).join(", ")} — use ONLY conceptKey values from the inventory`
          );
        }
        const danglingAssets = units.flatMap((u) =>
          (u.mediaAssetIds ?? []).filter((id) => !catalogueIds.has(id))
        );
        if (danglingAssets.length > 0) {
          throw new Error(
            `outline suggested media ids not in the cleared library: ${[...new Set(danglingAssets)].join(", ")} — use ids EXACTLY as listed, or null`
          );
        }
        outline = value;
        break;
      } catch (error) {
        attemptFeedback =
          error instanceof Error ? error.message : String(error);
        console.warn(
          `[pipeline] run ${args.runId}: outline attempt ${attempt}/${OUTLINE_ATTEMPTS} failed — ${attemptFeedback}`
        );
        if (attempt === OUTLINE_ATTEMPTS) {
          return { status: "failed", cause: attemptFeedback };
        }
      }
    }
    if (!outline) {
      return { status: "failed", cause: "outline pass produced no output" };
    }

    await ctx.runMutation(internal.pipeline.outlineReview.saveCourseOutline, {
      runId: args.runId,
      outline,
      promptVersion: PROMPTS["outline-course"].versionTag,
      model: modelRouting["outline-course"],
    });
    const unitCount = outline.modules.reduce((sum, m) => sum + m.units.length, 0);
    console.log(
      `[pipeline] run ${args.runId}: outline proposed ${unitCount} unit(s) across ${outline.modules.length} module(s)`
    );
    return {
      status: "ok",
      unitCount,
      moduleCount: outline.modules.length,
      ...(outlineWarning ? { warning: outlineWarning } : {}),
    };
  },
});
