import { v } from "convex/values";
import { internalAction } from "../_generated/server";

/**
 * M1 no-op pipeline stage. Sleeps ~1s and logs, standing in for the real
 * work (document conversion, LLM compilation, TTS, QA) of later milestones.
 */
export const runNoopStage = internalAction({
  args: {
    runId: v.id("runs"),
    stage: v.string(),
  },
  handler: async (_ctx, args) => {
    console.log(`[pipeline] run ${args.runId}: stage "${args.stage}" started (no-op)`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    console.log(`[pipeline] run ${args.runId}: stage "${args.stage}" finished (no-op)`);
    return null;
  },
});
