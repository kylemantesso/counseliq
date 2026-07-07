import { v } from "convex/values";
import type { UnitScript } from "@counseliq/course-schema";
import { internalMutation, internalQuery } from "../../_generated/server";
import { AppErrorCode, appError } from "../../errors";
import { estimateTtsCostUsd, TTS_PRICING } from "./pricing";
import { ttsModel } from "./models";

/**
 * TTS usage ledger (M5), mirroring llmCalls. costUsd is ESTIMATED from the
 * price sheet at record time — ElevenLabs returns no per-request cost (the
 * one sanctioned deviation from the llmCalls provider-reported invariant).
 */

export const recordTtsCall = internalMutation({
  args: {
    runId: v.id("runs"),
    stage: v.string(),
    unitKey: v.optional(v.string()),
    provider: v.string(),
    model: v.string(),
    voiceId: v.string(),
    characters: v.number(),
    latencyMs: v.number(),
  },
  handler: async (ctx, args) => {
    const costUsd =
      estimateTtsCostUsd({ model: args.model, characters: args.characters }) ??
      0;
    await ctx.db.insert("ttsCalls", { ...args, costUsd });
    return null;
  },
});

/**
 * Pre-synthesis cost estimate for the walkthrough's --yes gate. Exact when
 * normalised scripts already exist (their speakText is what gets billed,
 * modulo lexicon substitution); otherwise a 1.15x expansion heuristic over
 * the raw narration text.
 */
export const estimateTtsCostForRun = internalQuery({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) appError(AppErrorCode.RUN_NOT_FOUND);
    if (!run.courseId) appError(AppErrorCode.COURSE_NOT_FOUND);
    const course = await ctx.db.get(run.courseId);
    if (!course) appError(AppErrorCode.COURSE_NOT_FOUND);
    const units = await ctx.db
      .query("microUnits")
      .withIndex("by_course", (q) => q.eq("courseId", course._id))
      .take(1000);

    let characters = 0;
    let exact = units.length > 0;
    for (const unit of units) {
      const script = unit.script as UnitScript | undefined;
      if (script) {
        for (const sentence of script.sentences) {
          characters += sentence.speakText.length;
        }
      } else {
        exact = false;
        const narration = unit.narration as Array<{ text: string }>;
        for (const sentence of narration) {
          characters += Math.ceil(sentence.text.length * 1.15);
        }
      }
    }

    const meta = course.definitionMeta as
      | { voice?: { voiceRef?: string } }
      | undefined;
    const institution = await ctx.db.get(course.institutionId);
    const model = ttsModel();
    return {
      characters,
      model,
      voiceRef:
        institution?.voiceConfig?.voiceRef ?? meta?.voice?.voiceRef ?? null,
      estimateUsd: estimateTtsCostUsd({ model, characters }),
      priceSheetVerifiedAt: TTS_PRICING[model]?.verifiedAt ?? null,
      exact,
    };
  },
});
