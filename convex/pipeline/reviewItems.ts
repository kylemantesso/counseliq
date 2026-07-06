import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { reviewGateValidator } from "../schema";
import type { ReviewGate } from "./states";

const PLACEHOLDER_ITEMS: Record<
  ReviewGate,
  Array<{ kind: string; payload: unknown }>
> = {
  1: [
    {
      kind: "knowledge_fact",
      payload: {
        placeholder: true,
        note: "M1 stub — real knowledge inventory items arrive with the compiler milestone.",
      },
    },
    {
      kind: "withheld_fact",
      payload: {
        placeholder: true,
        note: "M1 stub — withheld/verification-flagged facts surface here for human review.",
      },
    },
  ],
  2: [
    {
      kind: "quiz_question",
      payload: {
        placeholder: true,
        note: "M1 stub — generated quiz questions arrive with the generation milestone.",
      },
    },
  ],
  3: [
    {
      kind: "preview_unit",
      payload: {
        placeholder: true,
        note: "M1 stub — rendered course preview arrives with the assets milestone.",
      },
    },
  ],
};

/** Insert placeholder review items for a gate so the human queue is never empty in M1. */
export async function insertGateReviewItems(
  ctx: MutationCtx,
  runId: Id<"runs">,
  gate: ReviewGate
): Promise<void> {
  for (const item of PLACEHOLDER_ITEMS[gate]) {
    await ctx.db.insert("reviewItems", {
      runId,
      gate,
      kind: item.kind,
      payload: item.payload,
      status: "pending",
    });
  }
}

export const createGateReviewItems = internalMutation({
  args: {
    runId: v.id("runs"),
    gate: reviewGateValidator,
  },
  handler: async (ctx, args) => {
    await insertGateReviewItems(ctx, args.runId, args.gate);
    return null;
  },
});
