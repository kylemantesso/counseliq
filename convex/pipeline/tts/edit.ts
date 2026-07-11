import { v } from "convex/values";
import {
  unitScriptSchema,
  unitTimingSchema,
  contentEndMsForTiming,
  typedCardContentSchema,
  type UnitScript,
  type UnitTiming,
  type ScriptSentence,
} from "@counseliq/course-schema";
import { internalMutation, mutation } from "../../_generated/server";
import type { MutationCtx } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import { internal } from "../../_generated/api";
import { AppErrorCode, appError } from "../../errors";
import { requireAdmin } from "../../admin";
import { normalizeSentence } from "./normalize";
import { findBlockedTerms } from "./lexicon";
import {
  computeMediaWindows,
  MEDIA_WINDOW_TEMPLATES,
  resolveCardBeats,
} from "./beats";
import { assertCourseMutable } from "../courses";
import {
  getExplicitRunAssetIds,
  isAssetCleared,
  isCatalogueAsset,
} from "../assetsCatalogue";
import { assetFitsTemplate } from "../compiler/rules";
import {
  replaceGate3BlockedUnitItems,
  type BlockedUnitItem,
} from "../reviewItems";

/**
 * The minimal narration edit loop (M5): edit ONE sentence of one unit at
 * gate 2 or gate 3. The sentence is re-normalised in this mutation (pure
 * string work); at gate 3 the unit is re-synthesised asynchronously — only
 * the edited sentence misses the ttsSentences cache, so exactly one
 * sentence's audio is re-generated and the unit's beats are re-resolved.
 */

interface EditArgs {
  runId: Id<"runs">;
  unitId: Id<"microUnits">;
  narrationId: string;
  text: string;
  actor: string;
}

type EditStatus = "updated" | "blocked" | "resynthesizing";
type RunState = Doc<"runs">["state"];

type UnitCard = {
  template: string;
  props: Record<string, unknown>;
  enterAt: { narration: string; word: string };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function loadEditableRunUnit(
  ctx: MutationCtx,
  runId: Id<"runs">,
  unitId: Id<"microUnits">,
  allowedStates: RunState[] = ["GATE_2_COURSE_REVIEW", "GATE_3_PREVIEW"]
): Promise<{ run: Doc<"runs">; unit: Doc<"microUnits"> }> {
  const run = await ctx.db.get(runId);
  if (!run) appError(AppErrorCode.RUN_NOT_FOUND);
  if (!allowedStates.includes(run.state)) {
    appError(AppErrorCode.RUN_NOT_EDITABLE);
  }
  const unit = await ctx.db.get(unitId);
  if (!unit || !run.courseId || unit.courseId !== run.courseId) {
    appError(AppErrorCode.UNITS_REQUIRED);
  }
  // Defense in depth: the state gate above should make this unreachable,
  // but published course content must never change.
  await assertCourseMutable(ctx, unit.courseId);
  return { run, unit };
}

/** Rebuild the run's gate-3 blocked_unit items from all course units. */
async function refreshBlockedItems(
  ctx: MutationCtx,
  runId: Id<"runs">,
  courseId: Id<"courses">
): Promise<void> {
  const units = await ctx.db
    .query("microUnits")
    .withIndex("by_course", (q) => q.eq("courseId", courseId))
    .take(1000);
  const items: BlockedUnitItem[] = [];
  for (const unit of units) {
    if (unit.state !== "blocked") continue;
    const script = unit.script as UnitScript | undefined;
    if (!script) continue;
    const blockedSentences = script.sentences.filter(
      (sentence) => sentence.blockedTerms.length > 0
    );
    items.push({
      unitKey: unit.unitKey,
      moduleKey: unit.moduleKey,
      concept: unit.concept,
      blockedTerms: [
        ...new Set(blockedSentences.flatMap((s) => s.blockedTerms)),
      ],
      narrationIds: blockedSentences.map((s) => s.narrationId),
    });
  }
  await replaceGate3BlockedUnitItems(ctx, runId, items);
}

async function updateNarrationSentenceHelper(
  ctx: MutationCtx,
  args: EditArgs
): Promise<{ status: EditStatus }> {
  const { run, unit } = await loadEditableRunUnit(
    ctx,
    args.runId,
    args.unitId
  );

  const text = args.text.trim();
  if (text.length === 0) appError(AppErrorCode.NARRATION_NOT_FOUND);

  const narration = unit.narration as Array<{ id: string; text: string }>;
  const index = narration.findIndex((s) => s.id === args.narrationId);
  if (index === -1) appError(AppErrorCode.NARRATION_NOT_FOUND);

  // Card guard: every card anchored to this sentence must keep its enterAt
  // word verbatim, or beat resolution (and the definition invariant) breaks.
  const cards = unit.cards as Array<{
    enterAt: { narration: string; word: string };
  }>;
  for (const card of cards) {
    if (card.enterAt.narration !== args.narrationId) continue;
    if (!text.includes(card.enterAt.word)) {
      appError(AppErrorCode.NARRATION_EDIT_BREAKS_CARD);
    }
  }

  const updatedNarration = narration.map((sentence, i) =>
    i === index ? { id: sentence.id, text } : sentence
  );
  await ctx.db.patch(unit._id, { narration: updatedNarration });

  const existingScript = unit.script as UnitScript | undefined;
  if (!existingScript) {
    // Run is at gate 2 before GENERATING_SCRIPT has ever run; the compile
    // output was edited in place and normalisation happens on gate approval.
    return { status: "updated" };
  }

  // Re-normalise ONLY the edited sentence.
  const course = await ctx.db.get(run.courseId!);
  const meta = course?.definitionMeta as
    | { voice?: { pronunciationLexicon?: Record<string, string> } }
    | undefined;
  const lexicon = meta?.voice?.pronunciationLexicon ?? {};
  const { speakText, alignment } = normalizeSentence(text);
  const editedSentence: ScriptSentence = {
    narrationId: args.narrationId,
    sourceText: text,
    speakText,
    alignment,
    blockedTerms: findBlockedTerms(text, lexicon),
  };
  const sentences = existingScript.sentences.map((sentence) =>
    sentence.narrationId === args.narrationId ? editedSentence : sentence
  );
  const script = unitScriptSchema.parse({
    ...existingScript,
    sentences,
    generatedAt: Date.now(),
  });

  const nowBlocked = sentences.some((s) => s.blockedTerms.length > 0);
  if (nowBlocked) {
    await ctx.db.patch(unit._id, { script, state: "blocked" });
    await refreshBlockedItems(ctx, args.runId, run.courseId!);
    return { status: "blocked" };
  }

  await ctx.db.patch(unit._id, {
    script,
    state: "script_ready",
    error: undefined,
  });
  if (unit.state === "blocked") {
    // The edit may have been the unblocking one — refresh the item list.
    await refreshBlockedItems(ctx, args.runId, run.courseId!);
  }

  if (run.state === "GATE_3_PREVIEW") {
    await ctx.scheduler.runAfter(
      0,
      internal.pipeline.tts.synthesize.synthesizeUnit,
      { runId: args.runId, unitId: args.unitId }
    );
    return { status: "resynthesizing" };
  }
  return { status: "updated" };
}

async function assetDurationsForCards(
  ctx: MutationCtx,
  cards: UnitCard[]
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const card of cards) {
    const ref = card.props.assetRef;
    if (typeof ref !== "string") continue;
    const refId = ctx.db.normalizeId("assets", ref);
    if (!refId) continue;
    const refAsset = await ctx.db.get(refId);
    if (refAsset?.durationMs !== undefined) {
      out.set(ref, refAsset.durationMs);
    }
  }
  return out;
}

async function updateCardEnterAtWordHelper(
  ctx: MutationCtx,
  args: {
    runId: Id<"runs">;
    unitId: Id<"microUnits">;
    cardIndex: number;
    word: string;
  },
  allowedStates?: RunState[]
): Promise<{ status: "updated" }> {
  const { unit } = await loadEditableRunUnit(ctx, args.runId, args.unitId, allowedStates);

  const word = args.word.trim();
  if (word.length === 0) {
    appError(AppErrorCode.CARD_ENTER_AT_WORD_INVALID);
  }

  const cards = (unit.cards ?? []) as UnitCard[];
  const target = cards[args.cardIndex];
  if (!target) {
    appError(AppErrorCode.CARD_NOT_FOUND);
  }

  const narration = (unit.narration ?? []) as Array<{ id: string; text: string }>;
  const targetSentence = narration.find((entry) => entry.id === target.enterAt.narration);
  if (!targetSentence || !targetSentence.text.includes(word)) {
    appError(AppErrorCode.CARD_ENTER_AT_WORD_INVALID);
  }

  const updatedCards = cards.map((card, index) =>
    index === args.cardIndex
      ? {
          ...card,
          enterAt: { ...card.enterAt, word },
        }
      : card
  );

  const patch: {
    cards: UnitCard[];
    timing?: UnitTiming;
    contentHash?: string;
  } = {
    cards: updatedCards,
    contentHash: undefined,
  };

  const scriptRaw = unit.script as UnitScript | undefined;
  const timingRaw = unit.timing as UnitTiming | undefined;
  if (scriptRaw && timingRaw) {
    const script = unitScriptSchema.parse(scriptRaw);
    const timing = unitTimingSchema.parse(timingRaw);
    const cardBeats = resolveCardBeats(updatedCards, script, timing.sentences);
    const media = computeMediaWindows(
      updatedCards,
      cardBeats,
      contentEndMsForTiming(timing),
      await assetDurationsForCards(ctx, updatedCards)
    );
    patch.timing = unitTimingSchema.parse({
      ...timing,
      totalDurationMs: contentEndMsForTiming(timing),
      cardBeats,
      media,
      generatedAt: Date.now(),
    });
  }

  await ctx.db.patch(unit._id, patch);
  return { status: "updated" };
}

async function updateCardPropsHelper(
  ctx: MutationCtx,
  args: {
    runId: Id<"runs">;
    unitId: Id<"microUnits">;
    cardIndex: number;
    props: unknown;
  },
  allowedStates?: RunState[]
): Promise<{ status: EditStatus }> {
  const { run, unit } = await loadEditableRunUnit(ctx, args.runId, args.unitId, allowedStates);
  const cards = (unit.cards ?? []) as UnitCard[];
  const target = cards[args.cardIndex];
  if (!target) appError(AppErrorCode.CARD_NOT_FOUND);
  if (!isRecord(args.props)) appError(AppErrorCode.CARD_PROPS_INVALID);

  const parsed = typedCardContentSchema.safeParse({
    template: target.template,
    props: args.props,
  });
  if (!parsed.success) appError(AppErrorCode.CARD_PROPS_INVALID);

  const updatedCards = cards.map((card, index) =>
    index === args.cardIndex
      ? {
          ...card,
          props: parsed.data.props as Record<string, unknown>,
        }
      : card
  );

  const patch: {
    cards: UnitCard[];
    contentHash?: string;
    state?: Doc<"microUnits">["state"];
    error?: undefined;
  } = {
    cards: updatedCards,
    contentHash: undefined,
  };

  if (run.state === "GATE_3_PREVIEW" && unit.state !== "blocked") {
    patch.state = "script_ready";
    patch.error = undefined;
  }

  await ctx.db.patch(unit._id, patch);

  if (run.state === "GATE_3_PREVIEW" && unit.state !== "blocked") {
    await ctx.scheduler.runAfter(
      0,
      internal.pipeline.tts.synthesize.synthesizeUnit,
      { runId: args.runId, unitId: args.unitId }
    );
    return { status: "resynthesizing" };
  }
  return { status: unit.state === "blocked" ? "blocked" : "updated" };
}

async function updateAnchorPropsHelper(
  ctx: MutationCtx,
  args: {
    runId: Id<"runs">;
    unitId: Id<"microUnits">;
    props: unknown;
  },
  allowedStates?: RunState[]
): Promise<{ status: "updated" }> {
  const { unit } = await loadEditableRunUnit(ctx, args.runId, args.unitId, allowedStates);
  const meta = unit.meta as
    | { anchor?: { template?: unknown; props?: unknown } }
    | undefined;
  const anchor = meta?.anchor;
  if (!anchor || typeof anchor.template !== "string") {
    appError(AppErrorCode.CARD_NOT_FOUND);
  }
  if (!isRecord(args.props)) appError(AppErrorCode.CARD_PROPS_INVALID);

  const parsed = typedCardContentSchema.safeParse({
    template: anchor.template,
    props: args.props,
  });
  if (!parsed.success) appError(AppErrorCode.CARD_PROPS_INVALID);

  await ctx.db.patch(unit._id, {
    meta: {
      ...((unit.meta ?? {}) as Record<string, unknown>),
      anchor: {
        ...anchor,
        props: parsed.data.props as Record<string, unknown>,
      },
    },
  });
  return { status: "updated" };
}

/** Internal variant for scripts/walkthroughs (mirrors decideGate). */
export const updateNarrationSentence = internalMutation({
  args: {
    runId: v.id("runs"),
    unitId: v.id("microUnits"),
    narrationId: v.string(),
    text: v.string(),
    reviewer: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await updateNarrationSentenceHelper(ctx, {
      runId: args.runId,
      unitId: args.unitId,
      narrationId: args.narrationId,
      text: args.text,
      actor: args.reviewer ?? "system",
    });
  },
});

/** Admin: edit one narration sentence from the gate-2/gate-3 review UIs. */
export const adminUpdateNarrationSentence = mutation({
  args: {
    runId: v.id("runs"),
    unitId: v.id("microUnits"),
    narrationId: v.string(),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    return await updateNarrationSentenceHelper(ctx, {
      runId: args.runId,
      unitId: args.unitId,
      narrationId: args.narrationId,
      text: args.text,
      actor: admin.email,
    });
  },
});

/** Internal variant for scripts/tests. */
export const updateCardEnterAtWord = internalMutation({
  args: {
    runId: v.id("runs"),
    unitId: v.id("microUnits"),
    cardIndex: v.number(),
    word: v.string(),
  },
  handler: async (ctx, args) => {
    return await updateCardEnterAtWordHelper(ctx, args);
  },
});

/** Admin: update one card beat anchor word (enterAt.word) at gate 2/3. */
export const adminUpdateCardEnterAtWord = mutation({
  args: {
    runId: v.id("runs"),
    unitId: v.id("microUnits"),
    cardIndex: v.number(),
    word: v.string(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    return await updateCardEnterAtWordHelper(ctx, args, ["GATE_3_PREVIEW"]);
  },
});

/** Admin: edit the text/content props of one card at gate 2/3. */
export const adminUpdateCardProps = mutation({
  args: {
    runId: v.id("runs"),
    unitId: v.id("microUnits"),
    cardIndex: v.number(),
    props: v.any(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    return await updateCardPropsHelper(ctx, args, ["GATE_2_COURSE_REVIEW"]);
  },
});

/** Admin: edit the text/content props of a unit's anchor card at gate 2/3. */
export const adminUpdateAnchorProps = mutation({
  args: {
    runId: v.id("runs"),
    unitId: v.id("microUnits"),
    props: v.any(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    return await updateAnchorPropsHelper(ctx, args, ["GATE_2_COURSE_REVIEW"]);
  },
});

async function retryUnitTtsHelper(
  ctx: MutationCtx,
  args: { runId: Id<"runs">; unitId: Id<"microUnits"> },
  allowedStates?: RunState[]
): Promise<{ status: "scheduled" }> {
  const run = await ctx.db.get(args.runId);
  if (!run) appError(AppErrorCode.RUN_NOT_FOUND);
  if (allowedStates && !allowedStates.includes(run.state)) {
    appError(AppErrorCode.RUN_NOT_EDITABLE);
  }
  if (!(await canRetryUnitTtsForRun(ctx, run))) {
    appError(AppErrorCode.RUN_NOT_AT_GATE);
  }
  const unit = await ctx.db.get(args.unitId);
  if (!unit || !run.courseId || unit.courseId !== run.courseId) {
    appError(AppErrorCode.UNITS_REQUIRED);
  }
  await assertCourseMutable(ctx, unit.courseId);
  // synthesizeUnit is idempotent (content-hash + sentence cache), so retry
  // is safe whatever the unit's current condition; success clears the error
  // and the failed_unit review item inside saveUnitTiming.
  await ctx.scheduler.runAfter(
    0,
    internal.pipeline.tts.synthesize.synthesizeUnit,
    { runId: args.runId, unitId: args.unitId }
  );
  return { status: "scheduled" };
}

const TTS_RETRY_ACTIVE_STATES = new Set<Doc<"runs">["state"]>([
  "GENERATING_ASSETS",
  "GATE_3_PREVIEW",
]);

async function canRetryUnitTtsForRun(
  ctx: MutationCtx,
  run: Doc<"runs">
): Promise<boolean> {
  if (TTS_RETRY_ACTIVE_STATES.has(run.state)) {
    return true;
  }
  if (run.state !== "FAILED") {
    return false;
  }

  const events = await ctx.db
    .query("runEvents")
    .withIndex("by_run", (q) => q.eq("runId", run._id))
    .order("desc")
    .take(200);
  const lastFailure = events.find((event) => event.toState === "FAILED");

  return (
    lastFailure !== undefined &&
    TTS_RETRY_ACTIVE_STATES.has(lastFailure.fromState)
  );
}

// --- Gate-2/3 asset swap (M6) — never touches narration audio ---

async function swapCardAssetHelper(
  ctx: MutationCtx,
  args: {
    runId: Id<"runs">;
    unitId: Id<"microUnits">;
    cardIndex: number;
    assetId: Id<"assets">;
  },
  allowedStates?: RunState[]
): Promise<{ status: "swapped" }> {
  const { run, unit } = await loadEditableRunUnit(ctx, args.runId, args.unitId, allowedStates);

  const cards = (unit.cards ?? []) as Array<{
    template: string;
    props: Record<string, unknown>;
    enterAt: { narration: string; word: string };
  }>;
  const card = cards[args.cardIndex];
  if (!card || !MEDIA_WINDOW_TEMPLATES.includes(card.template)) {
    appError(AppErrorCode.ASSET_KIND_MISMATCH);
  }

  const asset = await ctx.db.get(args.assetId);
  const explicitAssetIds = await getExplicitRunAssetIds(ctx, run);
  if (
    !asset ||
    !isCatalogueAsset(asset) ||
    asset.institutionId !== run.institutionId ||
    (explicitAssetIds !== null && !explicitAssetIds.has(args.assetId))
  ) {
    appError(AppErrorCode.ASSET_NOT_FOUND);
  }
  // The mechanical rights gate applies to swaps exactly as to compilation.
  if (!isAssetCleared(asset)) appError(AppErrorCode.ASSET_NOT_CLEARED);
  if (
    assetFitsTemplate(card.template, {
      kind: asset.kind as "image" | "video",
      ...(asset.aspect !== undefined ? { aspect: asset.aspect } : {}),
    }) !== null
  ) {
    appError(AppErrorCode.ASSET_KIND_MISMATCH);
  }

  const updatedCards = cards.map((entry, index) =>
    index === args.cardIndex
      ? { ...entry, props: { ...entry.props, assetRef: String(args.assetId) } }
      : entry
  );
  await ctx.db.patch(unit._id, { cards: updatedCards });

  // Visual-only change by construction: unitContentHash strips assetRef
  // (sanitizeCardsForAudioHash), so unit.contentHash stays valid and no
  // synthesis is ever scheduled. Only the timing artifact's media windows
  // depend on the asset (video duration) — recompute them in place.
  const timing = unit.timing as UnitTiming | undefined;
  if (timing) {
    const durations = new Map<string, number>();
    for (const entry of updatedCards) {
      const ref = entry.props.assetRef;
      if (typeof ref !== "string") continue;
      const refId = ctx.db.normalizeId("assets", ref);
      if (!refId) continue;
      const refAsset =
        String(refId) === String(args.assetId) ? asset : await ctx.db.get(refId);
      if (refAsset?.durationMs !== undefined) {
        durations.set(ref, refAsset.durationMs);
      }
    }
    const media = computeMediaWindows(
      updatedCards,
      timing.cardBeats,
      timing.totalDurationMs,
      durations
    );
    // Single-write-path discipline: the artifact is schema-validated on
    // every write. Sentences/beats are untouched — audio never changes.
    await ctx.db.patch(unit._id, {
      timing: unitTimingSchema.parse({ ...timing, media }),
    });
  }

  return { status: "swapped" };
}

/** Internal variant for scripts/tests. */
export const swapCardAsset = internalMutation({
  args: {
    runId: v.id("runs"),
    unitId: v.id("microUnits"),
    cardIndex: v.number(),
    assetId: v.id("assets"),
  },
  handler: async (ctx, args) => {
    return await swapCardAssetHelper(ctx, args);
  },
});

/** Admin: swap the asset on one media card at gate 2/3 — no re-TTS, ever. */
export const adminSwapCardAsset = mutation({
  args: {
    runId: v.id("runs"),
    unitId: v.id("microUnits"),
    cardIndex: v.number(),
    assetId: v.id("assets"),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    return await swapCardAssetHelper(ctx, args, ["GATE_2_COURSE_REVIEW"]);
  },
});

/** Internal variant for scripts/walkthroughs. */
export const retryUnitTts = internalMutation({
  args: { runId: v.id("runs"), unitId: v.id("microUnits") },
  handler: async (ctx, args) => {
    return await retryUnitTtsHelper(ctx, args);
  },
});

/** Admin: retry synthesis for one failed unit from the gate-3 studio. */
export const adminRetryUnitTts = mutation({
  args: { runId: v.id("runs"), unitId: v.id("microUnits") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    return await retryUnitTtsHelper(ctx, args, ["GATE_3_PREVIEW"]);
  },
});
