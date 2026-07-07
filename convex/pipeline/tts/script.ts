import { v } from "convex/values";
import {
  unitScriptSchema,
  type UnitScript,
  type ScriptSentence,
} from "@counseliq/course-schema";
import { internalMutation } from "../../_generated/server";
import { AppErrorCode, appError } from "../../errors";
import { normalizeSentence, NORMALIZER_VERSION } from "./normalize";
import { findBlockedTerms } from "./lexicon";
import {
  replaceGate3BlockedUnitItems,
  type BlockedUnitItem,
} from "../reviewItems";

/**
 * GENERATING_SCRIPT (M5): the deterministic, non-LLM normalisation pass.
 * Runs as a plain mutation — pure string work over bounded sentence counts,
 * no network — so the whole stage is transactional and idempotent.
 *
 * Per unit:
 * - every narration sentence is normalised into speakText + alignment;
 * - lexicon terms whose pronunciation is the CONFIRM_WITH_INSTITUTION
 *   sentinel block the unit (state "blocked" + a gate-3 review item) —
 *   the run proceeds for all other units, and gate 3 cannot pass while
 *   blocked units exist;
 * - units already assets_ready whose speakTexts are unchanged keep their
 *   state and timing (GENERATING_ASSETS skips them via contentHash);
 * - everything else becomes script_ready with any stale error cleared.
 */
export const generateScripts = internalMutation({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) appError(AppErrorCode.RUN_NOT_FOUND);
    if (!run.courseId) appError(AppErrorCode.COURSE_NOT_FOUND);
    const course = await ctx.db.get(run.courseId);
    if (!course) appError(AppErrorCode.COURSE_NOT_FOUND);

    const meta = course.definitionMeta as
      | { voice?: { pronunciationLexicon?: Record<string, string> } }
      | undefined;
    const lexicon = meta?.voice?.pronunciationLexicon ?? {};

    const units = await ctx.db
      .query("microUnits")
      .withIndex("by_course", (q) => q.eq("courseId", course._id))
      .take(1000);

    let scriptReady = 0;
    let blocked = 0;
    let unchanged = 0;
    const blockedItems: BlockedUnitItem[] = [];

    for (const unit of units) {
      const narration = unit.narration as Array<{ id: string; text: string }>;
      const sentences: ScriptSentence[] = narration.map((sentence) => {
        const { speakText, alignment } = normalizeSentence(sentence.text);
        return {
          narrationId: sentence.id,
          sourceText: sentence.text,
          speakText,
          alignment,
          blockedTerms: findBlockedTerms(sentence.text, lexicon),
        };
      });
      const script: UnitScript = unitScriptSchema.parse({
        version: 1,
        normalizerVersion: NORMALIZER_VERSION,
        sentences,
        generatedAt: Date.now(),
      });

      const blockedTerms = [
        ...new Set(sentences.flatMap((sentence) => sentence.blockedTerms)),
      ];
      if (blockedTerms.length > 0) {
        await ctx.db.patch(unit._id, { script, state: "blocked" });
        blocked += 1;
        blockedItems.push({
          unitKey: unit.unitKey,
          moduleKey: unit.moduleKey,
          concept: unit.concept,
          blockedTerms,
          narrationIds: sentences
            .filter((sentence) => sentence.blockedTerms.length > 0)
            .map((sentence) => sentence.narrationId),
        });
        continue;
      }

      const existing = unit.script as UnitScript | undefined;
      const speakTextsUnchanged =
        unit.state === "assets_ready" &&
        unit.timing !== undefined &&
        existing !== undefined &&
        existing.sentences.length === sentences.length &&
        existing.sentences.every(
          (prev, i) =>
            prev.narrationId === sentences[i].narrationId &&
            prev.speakText === sentences[i].speakText
        );
      if (speakTextsUnchanged) {
        // Keep state and timing; refresh the script so sourceText/alignment
        // stay current for the edit loop.
        await ctx.db.patch(unit._id, { script });
        unchanged += 1;
      } else {
        await ctx.db.patch(unit._id, {
          script,
          state: "script_ready",
          error: undefined,
        });
        scriptReady += 1;
      }
    }

    await replaceGate3BlockedUnitItems(ctx, args.runId, blockedItems);
    return { scriptReady, blocked, unchanged };
  },
});
