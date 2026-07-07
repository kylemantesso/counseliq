/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { unitScriptSchema, type UnitScript } from "@counseliq/course-schema";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

/**
 * Seeds a run parked after gate 2 with a compiled course of three units:
 * - mu-101 mentions a lexicon name whose pronunciation is unresolved
 *   (CONFIRM_WITH_INSTITUTION) — must block;
 * - mu-102 has digits/currency in narration — must normalise;
 * - mu-103 is plain prose — must pass through.
 */
async function seedRunWithCourse() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const institutionId = await ctx.db.insert("institutions", {
      name: "La Trobe University",
      brandTokens: {},
      pronunciationLexicon: {
        Geelong: "juh-LONG",
        Thanthiriwattage: "CONFIRM_WITH_INSTITUTION",
      },
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
          pronunciationLexicon: {
            Geelong: "juh-LONG",
            Thanthiriwattage: "CONFIRM_WITH_INSTITUTION",
          },
        },
      },
    });
    const runId = await ctx.db.insert("runs", {
      institutionId,
      courseId,
      state: "GENERATING_SCRIPT",
      promptVersions: {},
    });

    const baseUnit = {
      courseId,
      moduleKey: "m1-welcome",
      moduleTitle: "Welcome",
      cards: [],
      state: "draft" as const,
    };
    const blockedUnitId = await ctx.db.insert("microUnits", {
      ...baseUnit,
      unitKey: "mu-101",
      concept: "leadership",
      narration: [
        { id: "n1", text: "Professor Thanthiriwattage leads the program." },
        { id: "n2", text: "The program spans two campuses." },
      ],
    });
    const numericUnitId = await ctx.db.insert("microUnits", {
      ...baseUnit,
      unitKey: "mu-102",
      concept: "scale",
      narration: [
        { id: "n1", text: "The university invested A$82M across 5 campuses." },
      ],
    });
    const plainUnitId = await ctx.db.insert("microUnits", {
      ...baseUnit,
      unitKey: "mu-103",
      concept: "welcome",
      narration: [{ id: "n1", text: "Welcome to the Geelong campus tour." }],
    });
    return { runId, courseId, blockedUnitId, numericUnitId, plainUnitId };
  });
  return { t, ...ids } as {
    t: ReturnType<typeof convexTest>;
    runId: Id<"runs">;
    courseId: Id<"courses">;
    blockedUnitId: Id<"microUnits">;
    numericUnitId: Id<"microUnits">;
    plainUnitId: Id<"microUnits">;
  };
}

describe("generateScripts (GENERATING_SCRIPT stage)", () => {
  test("normalises narration, blocks sentinel units, creates gate-3 review items", async () => {
    const { t, runId, blockedUnitId, numericUnitId, plainUnitId } =
      await seedRunWithCourse();

    const result = await t.mutation(
      internal.pipeline.tts.script.generateScripts,
      { runId }
    );
    expect(result).toEqual({ scriptReady: 2, blocked: 1, unchanged: 0 });

    await t.run(async (ctx) => {
      const blocked = await ctx.db.get(blockedUnitId);
      expect(blocked?.state).toBe("blocked");
      const blockedScript = unitScriptSchema.parse(blocked?.script);
      expect(blockedScript.sentences[0].blockedTerms).toEqual([
        "Thanthiriwattage",
      ]);
      expect(blockedScript.sentences[1].blockedTerms).toEqual([]);

      const numeric = await ctx.db.get(numericUnitId);
      expect(numeric?.state).toBe("script_ready");
      const numericScript = unitScriptSchema.parse(numeric?.script);
      expect(numericScript.sentences[0].speakText).toContain(
        "eighty-two million Australian dollars"
      );
      expect(numericScript.sentences[0].speakText).toContain("five campuses");
      expect(numericScript.normalizerVersion).toBe("normalize@1");

      const plain = await ctx.db.get(plainUnitId);
      expect(plain?.state).toBe("script_ready");
      const plainScript = unitScriptSchema.parse(plain?.script);
      // Lexicon pronunciations never rewrite the stored speakText.
      expect(plainScript.sentences[0].speakText).toBe(
        "Welcome to the Geelong campus tour."
      );
    });

    const items = await t.query(
      internal.pipeline.reviewItems.listReviewItemsForRun,
      { runId, gate: 3 }
    );
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("blocked_unit");
    expect(items[0].status).toBe("pending");
    expect(items[0].payload).toMatchObject({
      unitKey: "mu-101",
      moduleKey: "m1-welcome",
      blockedTerms: ["Thanthiriwattage"],
      narrationIds: ["n1"],
    });
  });

  test("re-running is idempotent: stable counts, no duplicated review items", async () => {
    const { t, runId } = await seedRunWithCourse();
    await t.mutation(internal.pipeline.tts.script.generateScripts, { runId });
    const second = await t.mutation(
      internal.pipeline.tts.script.generateScripts,
      { runId }
    );
    // Non-blocked units are script_ready (not assets_ready), so they
    // re-normalise rather than count as unchanged.
    expect(second).toEqual({ scriptReady: 2, blocked: 1, unchanged: 0 });

    const items = await t.query(
      internal.pipeline.reviewItems.listReviewItemsForRun,
      { runId, gate: 3 }
    );
    expect(items).toHaveLength(1);
  });

  test("assets_ready units with unchanged speakText keep state and timing", async () => {
    const { t, runId, numericUnitId } = await seedRunWithCourse();
    await t.mutation(internal.pipeline.tts.script.generateScripts, { runId });

    const timingStub = { version: 1, stub: true };
    await t.run(async (ctx) => {
      await ctx.db.patch(numericUnitId, {
        state: "assets_ready",
        timing: timingStub,
        error: { retryable: true, cause: "stale failure to be preserved" },
      });
    });

    const result = await t.mutation(
      internal.pipeline.tts.script.generateScripts,
      { runId }
    );
    expect(result).toEqual({ scriptReady: 1, blocked: 1, unchanged: 1 });

    await t.run(async (ctx) => {
      const unit = await ctx.db.get(numericUnitId);
      expect(unit?.state).toBe("assets_ready");
      expect(unit?.timing).toEqual(timingStub);
    });
  });

  test("editing narration invalidates the skip and clears the unit error", async () => {
    const { t, runId, numericUnitId } = await seedRunWithCourse();
    await t.mutation(internal.pipeline.tts.script.generateScripts, { runId });
    await t.run(async (ctx) => {
      await ctx.db.patch(numericUnitId, {
        state: "assets_ready",
        timing: { version: 1, stub: true },
        error: { retryable: true, cause: "old synthesis failure" },
        narration: [
          { id: "n1", text: "The university invested A$95M across 5 campuses." },
        ],
      });
    });

    const result = await t.mutation(
      internal.pipeline.tts.script.generateScripts,
      { runId }
    );
    expect(result).toEqual({ scriptReady: 2, blocked: 1, unchanged: 0 });

    await t.run(async (ctx) => {
      const unit = await ctx.db.get(numericUnitId);
      expect(unit?.state).toBe("script_ready");
      expect(unit?.error).toBeUndefined();
      const script = unit?.script as UnitScript;
      expect(script.sentences[0].speakText).toContain(
        "ninety-five million Australian dollars"
      );
    });
  });

  test("resolving the lexicon unblocks the unit and clears its review item", async () => {
    const { t, runId, courseId, blockedUnitId } = await seedRunWithCourse();
    await t.mutation(internal.pipeline.tts.script.generateScripts, { runId });

    await t.run(async (ctx) => {
      const course = await ctx.db.get(courseId);
      const meta = course?.definitionMeta as {
        voice: { pronunciationLexicon: Record<string, string> };
      };
      meta.voice.pronunciationLexicon = {
        ...meta.voice.pronunciationLexicon,
        Thanthiriwattage: "tan-tiri-WATT-age",
      };
      await ctx.db.patch(courseId, { definitionMeta: meta });
    });

    const result = await t.mutation(
      internal.pipeline.tts.script.generateScripts,
      { runId }
    );
    expect(result).toEqual({ scriptReady: 3, blocked: 0, unchanged: 0 });

    await t.run(async (ctx) => {
      const unit = await ctx.db.get(blockedUnitId);
      expect(unit?.state).toBe("script_ready");
    });
    const items = await t.query(
      internal.pipeline.reviewItems.listReviewItemsForRun,
      { runId, gate: 3 }
    );
    expect(items).toHaveLength(0);
  });
});
