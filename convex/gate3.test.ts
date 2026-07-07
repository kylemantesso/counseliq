/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeAll, describe, expect, test, vi } from "vitest";
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
 * Seeds a run at GATE_3_PREVIEW with a two-unit course. Assets are generated
 * through the real stages (generateScripts + runAssetGeneration) so timing,
 * caches and review items are in their true post-GENERATING_ASSETS shape.
 */
async function seedGate3(options?: { sentinelLexicon?: boolean }) {
  const t = convexTest(schema, modules);
  const lexicon: Record<string, string> = { Geelong: "juh-LONG" };
  if (options?.sentinelLexicon) {
    lexicon["Thanthiriwattage"] = "CONFIRM_WITH_INSTITUTION";
  }
  const ids = await t.run(async (ctx) => {
    const institutionId = await ctx.db.insert("institutions", {
      name: "La Trobe University",
      brandTokens: { placeholder: true },
      pronunciationLexicon: lexicon,
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
          pronunciationLexicon: lexicon,
        },
      },
    });
    const runId = await ctx.db.insert("runs", {
      institutionId,
      courseId,
      state: "GENERATING_ASSETS",
      promptVersions: {},
    });
    const unitAId = await ctx.db.insert("microUnits", {
      courseId,
      moduleKey: "m1-welcome",
      moduleTitle: "Welcome",
      unitKey: "mu-101",
      concept: "scale",
      meta: { order: { module: 0, unit: 0 } },
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
    const unitBId = await ctx.db.insert("microUnits", {
      courseId,
      moduleKey: "m2-place",
      moduleTitle: "Place",
      unitKey: "mu-201",
      concept: "welcome",
      meta: { order: { module: 1, unit: 0 } },
      narration: [
        {
          id: "n1",
          text: options?.sentinelLexicon
            ? "Professor Thanthiriwattage leads the Geelong campus tour."
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
    return { runId, courseId, unitAId, unitBId };
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

describe("gate 3 decisions", () => {
  test("approve with a blocked unit refuses with UNITS_BLOCKED", async () => {
    const { t, runId } = await seedGate3({ sentinelLexicon: true });
    await expect(
      t.mutation(internal.pipeline.runs.decideGate, {
        runId,
        gate: 3,
        decision: "approve",
      })
    ).rejects.toThrow(/UNITS_BLOCKED/);
  });

  test("approve with a failed unit refuses with UNITS_BLOCKED", async () => {
    const { t, runId, unitBId } = await seedGate3();
    await t.run(async (ctx) => {
      await ctx.db.patch(unitBId, {
        error: { retryable: true, cause: "provider 500" },
      });
    });
    await expect(
      t.mutation(internal.pipeline.runs.decideGate, {
        runId,
        gate: 3,
        decision: "approve",
      })
    ).rejects.toThrow(/UNITS_BLOCKED/);
  });

  test("clean approve reaches the publish workflow start", async () => {
    const { t, runId } = await seedGate3();
    // The workflow component is not registered under convex-test; reaching
    // this error proves every gate-3 approval check passed.
    await expect(
      t.mutation(internal.pipeline.runs.decideGate, {
        runId,
        gate: 3,
        decision: "approve",
      })
    ).rejects.toThrow(/Component "workflow" is not registered/);
  });

  test("reject returns to gate 2 with notes journaled and a gate3_rejection item", async () => {
    const { t, runId } = await seedGate3();
    await t.mutation(internal.pipeline.runs.decideGate, {
      runId,
      gate: 3,
      decision: "reject",
      reviewer: "reviewer@example.com",
      notes: "  Unit two pacing is off; tighten the second sentence.  ",
    });

    const { run, events } = await t.query(
      internal.pipeline.queries.getRunInternal,
      { runId }
    );
    expect(run?.state).toBe("GATE_2_COURSE_REVIEW");
    expect(run?.error).toBeUndefined();
    expect(events.at(-1)).toMatchObject({
      fromState: "GATE_3_PREVIEW",
      toState: "GATE_2_COURSE_REVIEW",
      actor: "reviewer@example.com",
    });
    expect(events.at(-1)?.detail).toContain(
      "Unit two pacing is off; tighten the second sentence."
    );

    const gate2Items = await t.query(
      internal.pipeline.reviewItems.listReviewItemsForRun,
      { runId, gate: 2 }
    );
    const rejection = gate2Items.find((i) => i.kind === "gate3_rejection");
    expect(rejection?.status).toBe("pending");
    expect(rejection?.payload).toMatchObject({
      notes: "Unit two pacing is off; tighten the second sentence.",
      rejectedBy: "reviewer@example.com",
    });
  });
});

describe("adminGetRunPreview payload (via internal sibling)", () => {
  test("modules ordered, summary counts, brand tokens present", async () => {
    const { t, runId } = await seedGate3();
    const preview = await t.query(
      internal.pipeline.tts.preview.getRunPreviewInternal,
      { runId }
    );
    expect(preview?.run.state).toBe("GATE_3_PREVIEW");
    expect(preview?.institution?.brandTokens).toEqual({ placeholder: true });
    expect(preview?.modules.map((m) => m.moduleKey)).toEqual([
      "m1-welcome",
      "m2-place",
    ]);
    expect(preview?.summary).toMatchObject({
      ready: 2,
      blocked: 0,
      failed: 0,
      total: 2,
    });
    expect(preview?.summary.totalDurationMs).toBeGreaterThan(0);
    expect(preview?.summary.totalCharacters).toBeGreaterThan(0);
    const unit = preview?.modules[0]?.units[0];
    expect(unit?.timing).toBeTruthy();
    expect(unit?.script).toBeTruthy();
  });
});

describe("single-sentence edit loop", () => {
  test("edit at gate 3 re-synthesises exactly one sentence and re-resolves beats", async () => {
    const { t, runId, unitAId } = await seedGate3();
    const before = await t.run(async (ctx) => {
      const unit = await ctx.db.get(unitAId);
      const timing = unit?.timing as UnitTiming;
      const calls = await ctx.db
        .query("ttsCalls")
        .withIndex("by_run", (q) => q.eq("runId", runId))
        .take(100);
      return {
        n1AudioKey: timing.sentences[0].audioKey,
        n2AudioKey: timing.sentences[1].audioKey,
        calls: calls.length,
      };
    });

    vi.useFakeTimers();
    const result = await t.mutation(
      internal.pipeline.tts.edit.updateNarrationSentence,
      {
        runId,
        unitId: unitAId,
        narrationId: "n2",
        text: "Learners arrive from 120 countries every single year.",
      }
    );
    expect(result.status).toBe("resynthesizing");
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    vi.useRealTimers();

    await t.run(async (ctx) => {
      const unit = await ctx.db.get(unitAId);
      expect(unit?.state).toBe("assets_ready");
      const narration = unit?.narration as Array<{ id: string; text: string }>;
      expect(narration[1].text).toBe(
        "Learners arrive from 120 countries every single year."
      );
      const timing = unit?.timing as UnitTiming;
      // Unchanged sentence keeps its audio; the edited one re-synthesised.
      expect(timing.sentences[0].audioKey).toBe(before.n1AudioKey);
      expect(timing.sentences[1].audioKey).not.toBe(before.n2AudioKey);
      expect(timing.cardBeats).toHaveLength(2);
      const calls = await ctx.db
        .query("ttsCalls")
        .withIndex("by_run", (q) => q.eq("runId", runId))
        .take(100);
      expect(calls).toHaveLength(before.calls + 1); // exactly one new call
    });
  });

  test("edit that removes a card anchor word is rejected", async () => {
    const { t, runId, unitAId } = await seedGate3();
    await expect(
      t.mutation(internal.pipeline.tts.edit.updateNarrationSentence, {
        runId,
        unitId: unitAId,
        narrationId: "n2",
        text: "Learners arrive from all over the world.", // drops "countries"
      })
    ).rejects.toThrow(/NARRATION_EDIT_BREAKS_CARD/);
  });

  test("edit introducing a sentinel term blocks the unit with a review item", async () => {
    const { t, runId, unitBId } = await seedGate3({ sentinelLexicon: true });
    // mu-201 is blocked from seeding; unblock it first by removing the name.
    const unblock = await t.mutation(
      internal.pipeline.tts.edit.updateNarrationSentence,
      {
        runId,
        unitId: unitBId,
        narrationId: "n1",
        text: "Our professor leads the Geelong campus tour.",
      }
    );
    expect(unblock.status).toBe("resynthesizing");
    let items = await t.query(
      internal.pipeline.reviewItems.listReviewItemsForRun,
      { runId, gate: 3 }
    );
    expect(items.filter((i) => i.kind === "blocked_unit")).toHaveLength(0);

    // Now re-introduce the unresolved name: the unit re-blocks.
    const reblock = await t.mutation(
      internal.pipeline.tts.edit.updateNarrationSentence,
      {
        runId,
        unitId: unitBId,
        narrationId: "n1",
        text: "Professor Thanthiriwattage leads the Geelong campus tour.",
      }
    );
    expect(reblock.status).toBe("blocked");
    await t.run(async (ctx) => {
      const unit = await ctx.db.get(unitBId);
      expect(unit?.state).toBe("blocked");
    });
    items = await t.query(
      internal.pipeline.reviewItems.listReviewItemsForRun,
      { runId, gate: 3 }
    );
    const blockedItems = items.filter((i) => i.kind === "blocked_unit");
    expect(blockedItems).toHaveLength(1);
    expect(blockedItems[0].payload).toMatchObject({
      unitKey: "mu-201",
      blockedTerms: ["Thanthiriwattage"],
    });
  });

  test("edit outside gates 2/3 is refused", async () => {
    const { t, runId, unitAId } = await seedGate3();
    await t.run(async (ctx) => {
      await ctx.db.patch(runId, { state: "PUBLISHED" });
    });
    await expect(
      t.mutation(internal.pipeline.tts.edit.updateNarrationSentence, {
        runId,
        unitId: unitAId,
        narrationId: "n1",
        text: "Any new text.",
      })
    ).rejects.toThrow(/RUN_NOT_EDITABLE/);
  });

  test("retry clears the failed_unit review item on success", async () => {
    const { t, runId, unitBId } = await seedGate3();
    // Simulate a prior failure: error on the unit + a failed_unit item.
    await t.run(async (ctx) => {
      const unit = await ctx.db.get(unitBId);
      await ctx.db.patch(unitBId, {
        error: { retryable: true, cause: "provider 500" },
        timing: undefined,
        contentHash: undefined,
        state: "script_ready",
      });
      await ctx.db.insert("reviewItems", {
        runId,
        gate: 3,
        kind: "failed_unit",
        payload: {
          unitKey: unit!.unitKey,
          moduleKey: unit!.moduleKey,
          concept: unit!.concept,
          cause: "provider 500",
          retryable: true,
        },
        status: "pending",
      });
    });

    vi.useFakeTimers();
    const result = await t.mutation(internal.pipeline.tts.edit.retryUnitTts, {
      runId,
      unitId: unitBId,
    });
    expect(result.status).toBe("scheduled");
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    vi.useRealTimers();

    await t.run(async (ctx) => {
      const unit = await ctx.db.get(unitBId);
      expect(unit?.state).toBe("assets_ready");
      expect(unit?.error).toBeUndefined();
    });
    const items = await t.query(
      internal.pipeline.reviewItems.listReviewItemsForRun,
      { runId, gate: 3 }
    );
    expect(items.filter((i) => i.kind === "failed_unit")).toHaveLength(0);
  });
});
