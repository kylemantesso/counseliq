import { v } from "convex/values";
import { Workpool } from "@convex-dev/workpool";
import type { TimingWord, UnitScript } from "@counseliq/course-schema";
import { internalAction } from "../../_generated/server";
import type { ActionCtx } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import { components, internal } from "../../_generated/api";
import { AppErrorCode, appError } from "../../errors";
import {
  assembleUnitClock,
  deriveWords,
  projectWordsToSpeakText,
  resolveCardBeats,
  buildUnitTiming,
  type SentenceForAssembly,
  type SpokenWord,
} from "./beats";
import { buildSubstitutionMap } from "./lexicon";
import { sentenceHash, sha256Hex, unitContentHash } from "./hashes";
import {
  createProvider,
  ttsModel,
  ttsProviderName,
  ttsParallelism,
  ttsTimeoutMs,
  INTER_SENTENCE_GAP_MS,
  OUTPUT_FORMAT,
} from "./models";
import type { RunVoiceContext } from "./data";

/**
 * GENERATING_ASSETS (M5): per-unit TTS synthesis with word timestamps.
 *
 * Fan-out mirrors the compiler: one idempotent action per unit through the
 * ttsPool workpool, with two cache layers — `ttsSentences` (per spoken
 * sentence, shared across runs/courses) and `microUnits.contentHash` (whole
 * unit skipped when nothing audio-relevant changed). Per-unit failures mark
 * `microUnits.error` and surface as gate-3 failed_unit items; the run only
 * fails when zero units succeed.
 */

const POLL_INTERVAL_MS = 2000;

export const ttsPool = new Workpool(components.ttsPool, {
  maxParallelism: ttsParallelism(),
  retryActionsByDefault: true,
  defaultRetryBehavior: {
    maxAttempts: 3,
    initialBackoffMs: 2000,
    base: 2,
  },
});

/** The model string that participates in hashes, known before any call. */
function plannedModel(): string {
  return ttsProviderName() === "mock" ? "mock-tts-1" : ttsModel();
}

/**
 * Resolve the provider voice ID: dev env override > institution voiceConfig.
 * The mock provider gets a stable default so tests need no configuration.
 */
function resolveVoice(voice: RunVoiceContext): {
  voiceId: string;
  voiceRef: string;
} {
  const voiceRef = voice.voiceConfig?.voiceRef ?? voice.voiceRef ?? "unknown";
  const envOverride = process.env.ELEVENLABS_VOICE_ID;
  if (envOverride && envOverride.trim() !== "") {
    return { voiceId: envOverride.trim(), voiceRef };
  }
  if (voice.voiceConfig?.voiceId) {
    return { voiceId: voice.voiceConfig.voiceId, voiceRef };
  }
  if (ttsProviderName() === "mock") {
    return { voiceId: "mock-voice", voiceRef };
  }
  appError(AppErrorCode.TTS_NOT_CONFIGURED);
}

type UnitSynthesisResult =
  | { status: "ok"; synthesized: number; cachedSentences: number }
  | { status: "cached" }
  | { status: "blocked" }
  | { status: "failed"; cause: string };

/** Upload audio bytes to the content-addressed object store. */
async function uploadAudio(
  ctx: ActionCtx,
  audioKey: string,
  audio: ArrayBuffer
): Promise<void> {
  const { url } = await ctx.runAction(internal.pipeline.objectStore.presignPut, {
    key: audioKey,
    contentType: "audio/mpeg",
  });
  const response = await fetch(url, {
    method: "PUT",
    headers: { "content-type": "audio/mpeg" },
    body: audio,
  });
  if (!response.ok) {
    // Never include the presigned URL in the error.
    throw new Error(
      `audio upload failed for ${audioKey}: HTTP ${response.status}`
    );
  }
}

async function synthesizeUnitInner(
  ctx: ActionCtx,
  runId: Id<"runs">,
  unit: Doc<"microUnits">,
  voice: RunVoiceContext
): Promise<UnitSynthesisResult> {
  if (unit.state === "blocked") return { status: "blocked" };
  const script = unit.script as UnitScript | undefined;
  if (!script) {
    return { status: "failed", cause: "unit has no normalised script" };
  }

  const model = plannedModel();
  const providerName = ttsProviderName();
  const { voiceId, voiceRef } = resolveVoice(voice);
  const lexicon = voice.lexicon;
  const cards = (unit.cards ?? []) as Array<{
    enterAt: { narration: string; word: string };
  }>;

  // Whole-unit skip: nothing audio-relevant changed since the last pass.
  const contentHash = await unitContentHash({
    speakTexts: script.sentences.map((s) => s.speakText),
    lexicon,
    cards: unit.cards ?? [],
    voiceId,
    model,
    outputFormat: OUTPUT_FORMAT,
    gapMs: INTER_SENTENCE_GAP_MS,
  });
  if (unit.contentHash === contentHash && unit.timing !== undefined) {
    return { status: "cached" };
  }

  const substitutions = script.sentences.map((sentence) =>
    buildSubstitutionMap(sentence.speakText, lexicon)
  );

  let synthesized = 0;
  let cachedSentences = 0;
  const assembly: SentenceForAssembly[] = [];
  for (let i = 0; i < script.sentences.length; i++) {
    const sentence = script.sentences[i];
    const { spokenText, segments } = substitutions[i];
    const hash = await sentenceHash({
      spokenText,
      voiceId,
      model,
      outputFormat: OUTPUT_FORMAT,
    });

    const cached = await ctx.runQuery(
      internal.pipeline.tts.data.getTtsSentenceByHash,
      { sentenceHash: hash }
    );
    let sentenceData: {
      audioKey: string;
      durationMs: number;
      words: SpokenWord[];
    };
    if (!cached) {
      const provider = createProvider();
      const result = await provider.synthesize({
        text: spokenText,
        voiceId,
        ...(i > 0 ? { previousText: substitutions[i - 1].spokenText } : {}),
        ...(i < script.sentences.length - 1
          ? { nextText: substitutions[i + 1].spokenText }
          : {}),
      });
      const words = deriveWords(spokenText, result.timestamps);
      const durationMs = Math.max(
        1,
        Math.round(
          (result.timestamps.endSeconds.at(-1) ?? 0) * 1000
        )
      );
      const audioKey = `sha256/${await sha256Hex(result.audio)}.mp3`;
      if (providerName !== "mock") {
        await uploadAudio(ctx, audioKey, result.audio);
      }
      await ctx.runMutation(internal.pipeline.tts.data.recordTtsAudioAsset, {
        objectKey: audioKey,
        sourceProvenance: `run:${runId}:unit:${unit.unitKey}:sentence:${sentence.narrationId}`,
      });
      await ctx.runMutation(internal.pipeline.tts.data.saveTtsSentence, {
        sentenceHash: hash,
        audioKey,
        durationMs,
        words,
        characters: result.characters,
        provider: providerName,
        model: result.model,
        voiceId,
      });
      await ctx.runMutation(internal.pipeline.tts.calls.recordTtsCall, {
        runId,
        stage: "synthesize-unit",
        unitKey: unit.unitKey,
        provider: providerName,
        model: result.model,
        voiceId,
        characters: result.characters,
        latencyMs: result.latencyMs,
      });
      sentenceData = { audioKey, durationMs, words };
      synthesized += 1;
    } else {
      sentenceData = {
        audioKey: cached.audioKey,
        durationMs: cached.durationMs,
        words: cached.words,
      };
      cachedSentences += 1;
    }

    const captionWords: TimingWord[] = projectWordsToSpeakText(
      sentence.speakText,
      segments,
      sentenceData.words
    );
    assembly.push({
      narrationId: sentence.narrationId,
      speakText: sentence.speakText,
      audioKey: sentenceData.audioKey,
      durationMs: sentenceData.durationMs,
      words: captionWords,
    });
  }

  const timingSentences = assembleUnitClock(assembly, INTER_SENTENCE_GAP_MS);
  const cardBeats = resolveCardBeats(cards, script, timingSentences);
  const timing = buildUnitTiming({
    unitKey: unit.unitKey,
    provider: providerName,
    voiceRef,
    model,
    gapMs: INTER_SENTENCE_GAP_MS,
    sentences: timingSentences,
    cardBeats,
    generatedAt: Date.now(),
  });
  await ctx.runMutation(internal.pipeline.tts.data.saveUnitTiming, {
    runId,
    unitId: unit._id,
    timing,
    contentHash,
  });
  return { status: "ok", synthesized, cachedSentences };
}

/** Workpool entry point: synthesise one unit (idempotent via both caches). */
export const synthesizeUnit = internalAction({
  args: { runId: v.id("runs"), unitId: v.id("microUnits") },
  handler: async (ctx, args): Promise<UnitSynthesisResult> => {
    const { unit, voice } = await ctx.runQuery(
      internal.pipeline.tts.data.getUnitTtsContext,
      { runId: args.runId, unitId: args.unitId }
    );
    try {
      return await synthesizeUnitInner(ctx, args.runId, unit, voice);
    } catch (error) {
      const cause = error instanceof Error ? error.message : String(error);
      const retryable =
        error instanceof Error && "retryable" in error
          ? Boolean((error as { retryable: unknown }).retryable)
          : true;
      console.error(
        `[pipeline] run ${args.runId}: TTS failed for unit ${unit.unitKey} — ${cause}`
      );
      await ctx.runMutation(internal.pipeline.tts.data.setUnitTtsError, {
        unitId: args.unitId,
        error: { retryable, cause },
      });
      return { status: "failed", cause };
    }
  },
});

type AssetGenerationResult = {
  status: "ok" | "failed";
  cause?: string;
  synthesized: number;
  cached: number;
  blockedSkipped: number;
  failed: Array<{ unitKey: string; cause: string }>;
  characters: number;
  costUsd: number;
};

/** Orchestrator: fan all non-blocked units through the ttsPool. */
export const runAssetGeneration = internalAction({
  args: { runId: v.id("runs") },
  handler: async (ctx, args): Promise<AssetGenerationResult> => {
    const startedAt = Date.now();
    const empty = {
      synthesized: 0,
      cached: 0,
      blockedSkipped: 0,
      failed: [],
      characters: 0,
      costUsd: 0,
    };

    let overview: {
      voice: RunVoiceContext;
      units: Array<{
        _id: Id<"microUnits">;
        unitKey: string;
        state: string;
        error: { retryable: boolean; cause: string } | null;
        timingGeneratedAt: number | null;
      }>;
    };
    try {
      overview = await ctx.runQuery(
        internal.pipeline.tts.data.getRunTtsOverview,
        { runId: args.runId }
      );
    } catch (error) {
      return {
        ...empty,
        status: "failed",
        cause: error instanceof Error ? error.message : String(error),
      };
    }

    // Fail fast on configuration before spending anything.
    const providerName = ttsProviderName();
    if (providerName !== "mock") {
      if (!process.env.ELEVENLABS_API_KEY) {
        return {
          ...empty,
          status: "failed",
          cause: "ELEVENLABS_API_KEY is not configured",
        };
      }
      try {
        resolveVoice(overview.voice);
      } catch (error) {
        return {
          ...empty,
          status: "failed",
          cause: error instanceof Error ? error.message : String(error),
        };
      }
    }

    const blocked = overview.units.filter((u) => u.state === "blocked");
    const eligible = overview.units.filter((u) => u.state !== "blocked");
    if (eligible.length === 0) {
      return { ...empty, status: "ok", blockedSkipped: blocked.length };
    }

    const sequential = process.env.TTS_MODE === "sequential";
    const enqueueArgs = eligible.map((unit) => ({
      runId: args.runId,
      unitId: unit._id,
    }));
    if (sequential) {
      for (const unitArgs of enqueueArgs) {
        await ctx.runAction(
          internal.pipeline.tts.synthesize.synthesizeUnit,
          unitArgs
        );
      }
    } else {
      const workIds = await ttsPool.enqueueActionBatch(
        ctx,
        internal.pipeline.tts.synthesize.synthesizeUnit,
        enqueueArgs
      );
      const timeoutMs = ttsTimeoutMs();
      for (;;) {
        const statuses = await ttsPool.statusBatch(ctx, workIds);
        const finished = statuses.filter((s) => s.state === "finished").length;
        if (finished === workIds.length) break;
        if (Date.now() - startedAt > timeoutMs) {
          return {
            ...empty,
            status: "failed",
            cause: `TTS synthesis timed out after ${timeoutMs}ms (${finished}/${workIds.length} units finished)`,
            blockedSkipped: blocked.length,
          };
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
    }

    // Collect outcomes from the DB (workpool results are not returned).
    const after = await ctx.runQuery(
      internal.pipeline.tts.data.getRunTtsOverview,
      { runId: args.runId }
    );
    const attempted = new Set(eligible.map((u) => String(u._id)));
    const failed: Array<{ unitKey: string; cause: string }> = [];
    let synthesized = 0;
    let cachedUnits = 0;
    const failedItems: Array<{
      unitKey: string;
      moduleKey: string;
      concept: string;
      cause: string;
      retryable: boolean;
    }> = [];
    for (const unit of after.units) {
      if (!attempted.has(String(unit._id))) continue;
      if (unit.state === "assets_ready" && unit.error === null) {
        if (
          unit.timingGeneratedAt !== null &&
          unit.timingGeneratedAt >= startedAt
        ) {
          synthesized += 1;
        } else {
          cachedUnits += 1;
        }
      } else if (unit.error !== null) {
        failed.push({ unitKey: unit.unitKey, cause: unit.error.cause });
      }
    }
    // failed_unit review items (idempotent replace; empty list clears them).
    const failedUnitRows = await ctx.runQuery(
      internal.pipeline.tts.data.getFailedUnitDetails,
      { runId: args.runId }
    );
    await ctx.runMutation(internal.pipeline.tts.data.setGate3FailedUnitItems, {
      runId: args.runId,
      items: failedUnitRows,
    });

    const calls = await ctx.runQuery(
      internal.pipeline.tts.data.listTtsCallsForRun,
      { runId: args.runId }
    );
    const stageCalls = calls.filter((c) => c._creationTime >= startedAt);
    const characters = stageCalls.reduce((sum, c) => sum + c.characters, 0);
    const costUsd = stageCalls.reduce((sum, c) => sum + c.costUsd, 0);

    const succeeded = synthesized + cachedUnits;
    if (succeeded === 0 && eligible.length > 0) {
      return {
        status: "failed",
        cause:
          failed[0]?.cause !== undefined
            ? `all ${eligible.length} unit(s) failed — first cause: ${failed[0].cause}`
            : "no units produced assets",
        synthesized,
        cached: cachedUnits,
        blockedSkipped: blocked.length,
        failed,
        characters,
        costUsd,
      };
    }
    return {
      status: "ok",
      synthesized,
      cached: cachedUnits,
      blockedSkipped: blocked.length,
      failed,
      characters,
      costUsd,
    };
  },
});
