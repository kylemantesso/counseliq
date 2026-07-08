/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeAll, describe, expect, test } from "vitest";
import type { UnitTiming } from "@counseliq/course-schema";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

beforeAll(() => {
  process.env.TTS_PROVIDER = "mock";
  process.env.TTS_MODE = "sequential";
});

/**
 * THE M6 swap guarantee, test-proven: swapping a media card's asset at
 * gate 2/3 re-validates (cleared, kind/aspect) and updates the timing
 * artifact's media windows — while the narration audio (every audioKey),
 * card beats, contentHash, and ttsCalls count stay byte-identical.
 */
async function seedWithMedia() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const institutionId = await ctx.db.insert("institutions", {
      name: "Banksia University",
      brandTokens: { placeholder: true },
      pronunciationLexicon: {},
      market: "AU",
    });
    const mkAsset = (fields: Record<string, unknown>) =>
      ctx.db.insert("assets", {
        institutionId,
        origin: "uploaded",
        ...fields,
      } as never);
    const videoA = await mkAsset({
      objectKey: `sha256/${"a".repeat(64)}.mp4`,
      kind: "video",
      thumbKey: `sha256/${"1".repeat(64)}.jpg`,
      width: 1920,
      height: 1080,
      aspect: "landscape",
      durationMs: 1200,
      rights: "institution_owned",
      rightsDeclaredBy: "op@test",
      rightsDeclaredAt: 1,
    });
    const videoB = await mkAsset({
      objectKey: `sha256/${"b".repeat(64)}.mp4`,
      kind: "video",
      thumbKey: `sha256/${"2".repeat(64)}.jpg`,
      width: 1280,
      height: 720,
      aspect: "landscape",
      durationMs: 60000, // longer than any card window — must be trimmed
      rights: "licensed",
      rightsDeclaredBy: "op@test",
      rightsDeclaredAt: 1,
    });
    const unclearedVideo = await mkAsset({
      objectKey: `sha256/${"c".repeat(64)}.mp4`,
      kind: "video",
      thumbKey: `sha256/${"3".repeat(64)}.jpg`,
      width: 1280,
      height: 720,
      aspect: "landscape",
      durationMs: 2000,
      rights: "unknown",
    });
    const image = await mkAsset({
      objectKey: `sha256/${"d".repeat(64)}.jpg`,
      kind: "image",
      thumbKey: `sha256/${"4".repeat(64)}.jpg`,
      width: 1600,
      height: 900,
      aspect: "landscape",
      rights: "institution_owned",
      rightsDeclaredBy: "op@test",
      rightsDeclaredAt: 1,
    });

    const courseId = await ctx.db.insert("courses", {
      institutionId,
      title: "Banksia Essentials",
      level: 1,
      version: 1,
      status: "in_review",
      definitionMeta: {
        voice: {
          provider: "elevenlabs",
          voiceRef: "banksia-narrator-01",
          pronunciationLexicon: {},
        },
      },
    });
    const runId = await ctx.db.insert("runs", {
      institutionId,
      courseId,
      state: "GENERATING_ASSETS",
      promptVersions: {},
    });
    const unitId = await ctx.db.insert("microUnits", {
      courseId,
      moduleKey: "m1",
      moduleTitle: "Welcome",
      unitKey: "mu-101",
      concept: "campus",
      meta: { order: { module: 0, unit: 0 } },
      narration: [
        { id: "n1", text: "The campus spans the river valley." },
        { id: "n2", text: "Students train in simulated wards." },
      ],
      cards: [
        {
          template: "video-card",
          props: { assetRef: String(videoA), overlayText: "The campus" },
          enterAt: { narration: "n1", word: "campus" },
          provenance: "compiler:derived",
        },
        {
          template: "stat-card",
          props: { headline: "1 river valley" },
          enterAt: { narration: "n2", word: "wards" },
          provenance: "fact:1",
        },
      ],
      state: "draft" as const,
    });
    return { runId, unitId, videoA, videoB, unclearedVideo, image };
  });

  await t.mutation(internal.pipeline.tts.script.generateScripts, {
    runId: ids.runId,
  });
  await t.action(internal.pipeline.tts.synthesize.runAssetGeneration, {
    runId: ids.runId,
  });
  await t.run(async (ctx) => {
    await ctx.db.patch(ids.runId, { state: "GATE_3_PREVIEW" });
  });
  return { t, ...ids };
}

describe("adminSwapCardAsset (via internal swapCardAsset)", () => {
  test("swap updates the ref + media windows; narration audio untouched, no re-TTS", async () => {
    const { t, runId, unitId, videoB } = await seedWithMedia();

    const before = await t.run(async (ctx) => {
      const unit = await ctx.db.get(unitId);
      const ttsCalls = await ctx.db.query("ttsCalls").take(1000);
      return {
        timing: unit?.timing as UnitTiming,
        contentHash: unit?.contentHash,
        ttsCallCount: ttsCalls.length,
      };
    });
    expect(before.timing.media).toHaveLength(1);
    // videoA (1200ms) is shorter than the card window: trimmed to duration.
    expect(before.timing.media[0].outMs - before.timing.media[0].inMs).toBe(1200);

    await t.mutation(internal.pipeline.tts.edit.swapCardAsset, {
      runId,
      unitId,
      cardIndex: 0,
      assetId: videoB,
    });

    const after = await t.run(async (ctx) => {
      const unit = await ctx.db.get(unitId);
      const ttsCalls = await ctx.db.query("ttsCalls").take(1000);
      return {
        cards: unit?.cards as Array<{ props: Record<string, unknown> }>,
        timing: unit?.timing as UnitTiming,
        contentHash: unit?.contentHash,
        ttsCallCount: ttsCalls.length,
        state: unit?.state,
      };
    });

    // The swap took.
    expect(after.cards[0].props.assetRef).toBe(String(videoB));
    // Media window recomputed: videoB (60s) trims to the full card window.
    expect(after.timing.media).toHaveLength(1);
    expect(after.timing.media[0].outMs - after.timing.media[0].inMs).toBeGreaterThan(1200);

    // THE PROOF: narration audio untouched — every sentence and audioKey
    // byte-identical, beats identical, contentHash identical (assetRef is
    // sanitized out of the hash), zero new TTS calls, state still ready.
    expect(after.timing.sentences).toEqual(before.timing.sentences);
    expect(after.timing.cardBeats).toEqual(before.timing.cardBeats);
    expect(after.contentHash).toBe(before.contentHash);
    expect(after.ttsCallCount).toBe(before.ttsCallCount);
    expect(after.state).toBe("assets_ready");

    // And the hash skip-logic stays coherent: re-running asset generation
    // treats the swapped unit as cached (no synthesis, timing preserved).
    const regen = await t.action(
      internal.pipeline.tts.synthesize.runAssetGeneration,
      { runId }
    );
    expect(regen.status).toBe("ok");
    const finalCalls = await t.run(async (ctx) =>
      (await ctx.db.query("ttsCalls").take(1000)).length
    );
    expect(finalCalls).toBe(before.ttsCallCount);
  });

  test("uncleared and kind-mismatched assets are rejected", async () => {
    const { t, runId, unitId, unclearedVideo, image } = await seedWithMedia();
    await expect(
      t.mutation(internal.pipeline.tts.edit.swapCardAsset, {
        runId,
        unitId,
        cardIndex: 0,
        assetId: unclearedVideo,
      })
    ).rejects.toThrow(/ASSET_NOT_CLEARED/);
    await expect(
      t.mutation(internal.pipeline.tts.edit.swapCardAsset, {
        runId,
        unitId,
        cardIndex: 0, // video-card
        assetId: image,
      })
    ).rejects.toThrow(/ASSET_KIND_MISMATCH/);
    // Non-media card index is rejected too.
    await expect(
      t.mutation(internal.pipeline.tts.edit.swapCardAsset, {
        runId,
        unitId,
        cardIndex: 1, // stat-card
        assetId: image,
      })
    ).rejects.toThrow(/ASSET_KIND_MISMATCH/);
  });

  test("swap is refused outside gate 2/3", async () => {
    const { t, runId, unitId, videoB } = await seedWithMedia();
    await t.run(async (ctx) => ctx.db.patch(runId, { state: "PUBLISHING" }));
    await expect(
      t.mutation(internal.pipeline.tts.edit.swapCardAsset, {
        runId,
        unitId,
        cardIndex: 0,
        assetId: videoB,
      })
    ).rejects.toThrow(/RUN_NOT_EDITABLE/);
  });
});
