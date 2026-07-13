/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeAll, describe, expect, test } from "vitest";
import { unitTimingSchema, type UnitTiming } from "@counseliq/course-schema";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { MOCK_TTS_FAIL_MARKER } from "./pipeline/tts/mock";

const modules = import.meta.glob("./**/*.ts");

beforeAll(() => {
  process.env.TTS_PROVIDER = "mock";
  process.env.TTS_MODE = "sequential";
});

/**
 * Seeds a run at GENERATING_ASSETS with a compiled course of two units:
 * - mu-201: two sentences with digits/currency plus two cards anchored on
 *   words of each sentence — exercises normalisation, beat resolution, and
 *   per-sentence artifacts;
 * - mu-202: single plain sentence with one card.
 */
async function seedRun(options?: {
  failUnit?: boolean;
  ttsVoice?: {
    provider: string;
    voiceRef: string;
    voiceId: string;
    name: string;
    accent: string;
    settings: {
      stability?: number;
      similarityBoost?: number;
      speakerBoost?: boolean;
      speed?: number;
    };
  };
}) {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const institutionId = await ctx.db.insert("institutions", {
      name: "La Trobe University",
      brandTokens: {},
      pronunciationLexicon: { Geelong: "juh-LONG" },
      market: "AU",
    });
    const courseId = await ctx.db.insert("courses", {
      institutionId,
      title: "La Trobe Essentials",
      level: 1,
      version: 1,
      status: "in_review",
      definitionMeta: {
        schemaRef: "counseliq://course-definition/v1",
        courseId: "latrobe-essentials",
        badge: "Explorer",
        prerequisite: "none",
        brandRef: "latrobe",
        language: "en-AU",
        voice: {
          provider: "elevenlabs",
          voiceRef: "latrobe-narrator-01",
          pronunciationLexicon: { Geelong: "juh-LONG" },
        },
        ...(options?.ttsVoice ? { ttsVoice: options.ttsVoice } : {}),
      },
    });
    const runId = await ctx.db.insert("runs", {
      institutionId,
      courseId,
      state: "GENERATING_ASSETS",
      promptVersions: {},
    });

    const numericUnitId = await ctx.db.insert("microUnits", {
      courseId,
      moduleKey: "m1-welcome",
      moduleTitle: "Welcome",
      unitKey: "mu-201",
      concept: "scale",
      narration: [
        { id: "n1", text: "The university invested A$82M across 5 campuses." },
        { id: "n2", text: "Students arrive from 110 countries." },
      ],
      cards: [
        {
          template: "stat-card",
          props: { headline: "A$82M invested" },
          enterAt: { narration: "n1", word: "campuses" },
          provenance: "fact:1",
        },
        {
          template: "stat-card",
          props: { headline: "110 countries" },
          enterAt: { narration: "n2", word: "countries" },
          provenance: "fact:2",
        },
      ],
      state: "draft" as const,
    });
    const plainUnitId = await ctx.db.insert("microUnits", {
      courseId,
      moduleKey: "m1-welcome",
      moduleTitle: "Welcome",
      unitKey: "mu-202",
      concept: "welcome",
      narration: [
        {
          id: "n1",
          text: options?.failUnit
            ? `Welcome to the campus tour. ${MOCK_TTS_FAIL_MARKER}`
            : "Welcome to the Geelong campus tour.",
        },
      ],
      cards: [
        {
          template: "text-card",
          props: { body: "Welcome" },
          enterAt: { narration: "n1", word: "campus" },
          provenance: "structural",
        },
      ],
      state: "draft" as const,
    });
    return { runId, courseId, numericUnitId, plainUnitId };
  });
  return { t, ...ids };
}

type SeededTest = Awaited<ReturnType<typeof seedRun>>["t"];

async function generateAll(t: SeededTest, runId: Id<"runs">) {
  await t.mutation(internal.pipeline.tts.script.generateScripts, { runId });
  return await t.action(internal.pipeline.tts.synthesize.runAssetGeneration, {
    runId,
  });
}

describe("runAssetGeneration (GENERATING_ASSETS stage, mock provider)", () => {
  test("full pass: units assets_ready with validated timing, beats, ledger rows", async () => {
    const { t, runId, numericUnitId, plainUnitId } = await seedRun();
    const result = await generateAll(t, runId);
    expect(result.status).toBe("ok");
    expect(result.synthesized).toBe(2);
    expect(result.cached).toBe(0);
    expect(result.failed).toEqual([]);
    expect(result.characters).toBeGreaterThan(0);

    await t.run(async (ctx) => {
      for (const unitId of [numericUnitId, plainUnitId]) {
        const unit = await ctx.db.get(unitId);
        expect(unit?.state).toBe("assets_ready");
        expect(unit?.contentHash).toBeTruthy();
        const timing = unitTimingSchema.parse(unit?.timing);
        expect(timing.cardBeats).toHaveLength(
          (unit?.cards as unknown[]).length
        );
        expect(timing.provider).toBe("mock");
        expect(timing.voiceRef).toBe("latrobe-narrator-01");
        // Every narration sentence carries its own audio artifact.
        const narration = unit?.narration as Array<{ id: string }>;
        expect(timing.sentences.map((s) => s.narrationId)).toEqual(
          narration.map((n) => n.id)
        );
        for (const sentence of timing.sentences) {
          expect(sentence.audioKey).toMatch(/^sha256\/[0-9a-f]{64}\.mp3$/);
        }
      }

      // The mock clock is 50ms/char: the mu-201 n1 card anchored on
      // "campuses" must land exactly at that word's spokenText offset.
      const numeric = await ctx.db.get(numericUnitId);
      const timing = numeric?.timing as UnitTiming;
      const n1 = timing.sentences[0];
      const wordStart = n1.speakText.indexOf("campuses") * 50;
      expect(timing.cardBeats[0].atMs).toBe(n1.startMs + wordStart);
      // Second card anchors into sentence 2 on the unit clock (after gap).
      expect(timing.cardBeats[1].atMs).toBeGreaterThanOrEqual(
        timing.sentences[1].startMs
      );

      const calls = await ctx.db
        .query("ttsCalls")
        .withIndex("by_run", (q) => q.eq("runId", runId))
        .take(100);
      expect(calls).toHaveLength(3); // 2 + 1 sentences
      const sentences = await ctx.db.query("ttsSentences").take(100);
      expect(sentences).toHaveLength(3);
      const assets = await ctx.db.query("assets").take(100);
      expect(assets.filter((a) => a.kind === "tts-audio")).toHaveLength(3);
    });
  });

  test("hash-skip proof: a second pass synthesises nothing", async () => {
    const { t, runId, numericUnitId } = await seedRun();
    await generateAll(t, runId);
    const before = await t.run(async (ctx) => {
      const unit = await ctx.db.get(numericUnitId);
      const calls = await ctx.db
        .query("ttsCalls")
        .withIndex("by_run", (q) => q.eq("runId", runId))
        .take(100);
      return { timing: unit?.timing, contentHash: unit?.contentHash, calls: calls.length };
    });

    const second = await generateAll(t, runId);
    expect(second.status).toBe("ok");
    expect(second.synthesized).toBe(0);
    expect(second.cached).toBe(2);

    await t.run(async (ctx) => {
      const unit = await ctx.db.get(numericUnitId);
      expect(unit?.contentHash).toBe(before.contentHash);
      expect(unit?.timing).toEqual(before.timing);
      const calls = await ctx.db
        .query("ttsCalls")
        .withIndex("by_run", (q) => q.eq("runId", runId))
        .take(100);
      expect(calls).toHaveLength(before.calls); // zero new rows
    });
  });

  test("course-selected voice takes priority over ELEVENLABS_VOICE_ID", async () => {
    const previousEnvVoice = process.env.ELEVENLABS_VOICE_ID;
    process.env.ELEVENLABS_VOICE_ID = "env-american-default";
    try {
      const { t, runId } = await seedRun({
        ttsVoice: {
          provider: "elevenlabs",
          voiceRef: "elevenlabs-charlie",
          voiceId: "charlie-australian-voice",
          name: "Charlie",
          accent: "australian",
          settings: {
            stability: 0.55,
            similarityBoost: 0.85,
            speakerBoost: true,
            speed: 1,
          },
        },
      });

      const result = await generateAll(t, runId);
      expect(result.status).toBe("ok");

      await t.run(async (ctx) => {
        const sentences = await ctx.db.query("ttsSentences").take(100);
        expect(sentences).toHaveLength(3);
        expect(new Set(sentences.map((sentence) => sentence.voiceId))).toEqual(
          new Set(["charlie-australian-voice"])
        );

        const calls = await ctx.db
          .query("ttsCalls")
          .withIndex("by_run", (q) => q.eq("runId", runId))
          .take(100);
        expect(new Set(calls.map((call) => call.voiceId))).toEqual(
          new Set(["charlie-australian-voice"])
        );
      });
    } finally {
      if (previousEnvVoice === undefined) {
        delete process.env.ELEVENLABS_VOICE_ID;
      } else {
        process.env.ELEVENLABS_VOICE_ID = previousEnvVoice;
      }
    }
  });

  test("single-sentence edit re-synthesises exactly one sentence", async () => {
    const { t, runId, numericUnitId } = await seedRun();
    await generateAll(t, runId);
    const before = await t.run(async (ctx) => {
      const unit = await ctx.db.get(numericUnitId);
      const timing = unit?.timing as UnitTiming;
      const calls = await ctx.db
        .query("ttsCalls")
        .withIndex("by_run", (q) => q.eq("runId", runId))
        .take(100);
      return {
        n1AudioKey: timing.sentences[0].audioKey,
        n2AudioKey: timing.sentences[1].audioKey,
        beats: timing.cardBeats,
        calls: calls.length,
      };
    });

    // Edit ONLY n2 (keep the n1 card word "campuses" and n2 word "countries").
    await t.run(async (ctx) => {
      const unit = await ctx.db.get(numericUnitId);
      const narration = unit?.narration as Array<{ id: string; text: string }>;
      await ctx.db.patch(numericUnitId, {
        narration: [
          narration[0],
          { id: "n2", text: "Learners arrive from 120 countries every year." },
        ],
      });
    });
    const result = await generateAll(t, runId);
    expect(result.status).toBe("ok");
    expect(result.synthesized).toBe(1); // only mu-201 re-synthesised

    await t.run(async (ctx) => {
      const calls = await ctx.db
        .query("ttsCalls")
        .withIndex("by_run", (q) => q.eq("runId", runId))
        .take(100);
      expect(calls).toHaveLength(before.calls + 1); // exactly ONE new call

      const unit = await ctx.db.get(numericUnitId);
      const timing = unit?.timing as UnitTiming;
      // Unchanged sentence keeps its artifact; edited one gets a new key.
      expect(timing.sentences[0].audioKey).toBe(before.n1AudioKey);
      expect(timing.sentences[1].audioKey).not.toBe(before.n2AudioKey);
      // Beats recomputed and still one per card.
      expect(timing.cardBeats).toHaveLength(2);
      expect(timing.cardBeats[1].atMs).toBeGreaterThanOrEqual(
        timing.sentences[1].startMs
      );
    });
  });

  test("failed unit: error recorded, siblings ready, run proceeds, review item created", async () => {
    const { t, runId, numericUnitId, plainUnitId } = await seedRun({
      failUnit: true,
    });
    const result = await generateAll(t, runId);
    expect(result.status).toBe("ok"); // one unit still succeeded
    expect(result.synthesized).toBe(1);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].unitKey).toBe("mu-202");

    await t.run(async (ctx) => {
      const failed = await ctx.db.get(plainUnitId);
      expect(failed?.state).toBe("script_ready"); // state preserved
      expect(failed?.error?.cause).toContain("mock TTS failure");
      const ok = await ctx.db.get(numericUnitId);
      expect(ok?.state).toBe("assets_ready");
    });

    const items = await t.query(
      internal.pipeline.reviewItems.listReviewItemsForRun,
      { runId, gate: 3 }
    );
    const failedItems = items.filter((i) => i.kind === "failed_unit");
    expect(failedItems).toHaveLength(1);
    expect(failedItems[0].payload).toMatchObject({
      unitKey: "mu-202",
      retryable: false,
    });
  });

  test("estimateTtsCostForRun: heuristic before scripts, exact after", async () => {
    const { t, runId } = await seedRun();
    const before = await t.query(
      internal.pipeline.tts.calls.estimateTtsCostForRun,
      { runId }
    );
    expect(before.exact).toBe(false);
    expect(before.characters).toBeGreaterThan(0);

    await t.mutation(internal.pipeline.tts.script.generateScripts, { runId });
    const after = await t.query(
      internal.pipeline.tts.calls.estimateTtsCostForRun,
      { runId }
    );
    expect(after.exact).toBe(true);
    expect(after.voiceRef).toBe("latrobe-narrator-01");
    // Normalisation expands digits, so the exact count exceeds raw narration.
    expect(after.characters).toBeGreaterThan(0);
  });

  test("run cost breakdown splits LLM vs TTS with a grand total", async () => {
    const { t, runId } = await seedRun();
    await t.mutation(internal.pipeline.llmCalls.recordLlmCall, {
      runId,
      stage: "author-unit",
      promptVersion: "author-unit@1",
      model: "test-model",
      tokensIn: 100,
      tokensOut: 50,
      costUsd: 0.5,
      latencyMs: 10,
    });
    await generateAll(t, runId);
    // Give the mock ledger a nonzero rate to exercise the sum.
    await t.mutation(internal.pipeline.tts.calls.recordTtsCall, {
      runId,
      stage: "synthesize-unit",
      provider: "mock",
      model: "eleven_multilingual_v2",
      voiceId: "mock-voice",
      characters: 2000,
      latencyMs: 5,
    });

    const cost = await t.query(internal.pipeline.llmCalls.getRunCostInternal, {
      runId,
    });
    expect(cost.totalUsd).toBeCloseTo(0.5);
    expect(cost.tts.totalCalls).toBe(4); // 3 mock sentences + 1 manual row
    expect(cost.tts.totalUsd).toBeCloseTo(0.2); // 2000 chars at $0.10/1k
    expect(cost.grandTotalUsd).toBeCloseTo(0.7);
    expect(cost.tts.byStage[0].stage).toBe("synthesize-unit");
  });
});
