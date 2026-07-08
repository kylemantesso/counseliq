/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

/**
 * The M6.5 outline step: generation saves through one validated write
 * path, the operator edits under state guards, approval is the only door
 * into authoring spend, and regeneration accumulates feedback.
 */

function makeOutline(overrides: Record<string, unknown> = {}) {
  return {
    courseTitle: "Banksia Health Essentials",
    learningOutcomes: [
      "The counsellor can explain the health portfolio's structure.",
      "The counsellor can match a student to a registration track.",
      "The counsellor can attribute every ranking to its source.",
    ],
    modules: [
      {
        moduleId: "m1-why-health",
        title: "Why Banksia for Health",
        rationale: "Orientation before application.",
        units: [
          {
            unitId: "mu-101",
            conceptKey: "campuses",
            conceptTag: "campuses",
            title: "The campus network",
            secondsBudget: 45,
            mediaAssetIds: null,
          },
          {
            unitId: "mu-102",
            conceptKey: "rankings",
            conceptTag: "rankings",
            title: "Rankings, attributed",
            secondsBudget: 40,
            mediaAssetIds: null,
          },
        ],
      },
    ],
    ...overrides,
  };
}

async function seed(state: string = "OUTLINE_REVIEW") {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      tokenIdentifier: "https://convex.test|admin",
      name: "Admin",
      email: "admin@test.dev",
      createdAt: Date.now(),
      isAdmin: true,
    });
    const institutionId = await ctx.db.insert("institutions", {
      name: "Banksia University",
      brandTokens: { placeholder: true },
      pronunciationLexicon: {},
      market: "AU",
    });
    const runId = await ctx.db.insert("runs", {
      institutionId,
      state: state as never,
      promptVersions: {},
      brief: "Focus on health placements.",
    });
    for (const key of ["campuses", "rankings", "placements"]) {
      await ctx.db.insert("inventoryItems", {
        runId,
        kind: "concept",
        body: { type: "concept", key, title: key, summary: `About ${key}.` },
        provenance: ["doc:x:page:1"],
        flagged: false,
      });
    }
    const clearedAsset = await ctx.db.insert("assets", {
      objectKey: `sha256/${"a".repeat(64)}.jpg`,
      kind: "image",
      institutionId,
      aspect: "landscape",
      width: 800,
      height: 600,
      origin: "uploaded",
      rights: "institution_owned",
      rightsDeclaredBy: "op@test",
      rightsDeclaredAt: 1,
    });
    const unclearedAsset = await ctx.db.insert("assets", {
      objectKey: `sha256/${"b".repeat(64)}.jpg`,
      kind: "image",
      institutionId,
      aspect: "landscape",
      width: 800,
      height: 600,
      origin: "uploaded",
      rights: "unknown",
    });
    return { institutionId, runId, clearedAsset, unclearedAsset };
  });
  return { t, asAdmin: t.withIdentity({ subject: "admin" }), ...ids };
}

async function seedWithOutline(state = "OUTLINE_REVIEW") {
  const seeded = await seed(state);
  await seeded.t.mutation(internal.pipeline.outlineReview.saveCourseOutline, {
    runId: seeded.runId,
    outline: makeOutline(),
    promptVersion: "outline-course@1",
    model: "google/gemini-2.5-flash",
  });
  return seeded;
}

describe("saveCourseOutline (generation write path)", () => {
  test("valid outline upserts as an editable draft carrying the brief", async () => {
    const { t, runId } = await seedWithOutline();
    const row = await t.run(async (ctx) =>
      ctx.db
        .query("courseOutlines")
        .withIndex("by_run", (q) => q.eq("runId", runId))
        .unique()
    );
    expect(row).toMatchObject({
      status: "draft",
      courseTitle: "Banksia Health Essentials",
      brief: "Focus on health placements.",
      promptVersion: "outline-course@1",
    });
    // Draft outlines are invisible to compilation.
    const approved = await t.query(
      internal.pipeline.outlineReview.getApprovedOutlineForRun,
      { runId }
    );
    expect(approved).toBeNull();
  });

  test("invented concept keys are rejected", async () => {
    const { t, runId } = await seed();
    const outline = makeOutline();
    (outline.modules as Array<{ units: Array<{ conceptKey: string }> }>)[0].units[0].conceptKey =
      "not-in-inventory";
    await expect(
      t.mutation(internal.pipeline.outlineReview.saveCourseOutline, {
        runId,
        outline,
        promptVersion: "outline-course@1",
        model: "m",
      })
    ).rejects.toThrow(/OUTLINE_INVALID/);
  });

  test("media suggestions must be CLEARED catalogue assets", async () => {
    const { t, runId, clearedAsset, unclearedAsset } = await seed();
    const withCleared = makeOutline();
    (withCleared.modules as Array<{ units: Array<{ mediaAssetIds: unknown }> }>)[0].units[0].mediaAssetIds =
      [clearedAsset];
    await t.mutation(internal.pipeline.outlineReview.saveCourseOutline, {
      runId,
      outline: withCleared,
      promptVersion: "outline-course@1",
      model: "m",
    });

    const withUncleared = makeOutline();
    (withUncleared.modules as Array<{ units: Array<{ mediaAssetIds: unknown }> }>)[0].units[0].mediaAssetIds =
      [unclearedAsset];
    await expect(
      t.mutation(internal.pipeline.outlineReview.saveCourseOutline, {
        runId,
        outline: withUncleared,
        promptVersion: "outline-course@1",
        model: "m",
      })
    ).rejects.toThrow(/ASSET_NOT_CLEARED/);
  });
});

describe("adminUpdateOutline (operator edits)", () => {
  test("edits persist with edit stamps", async () => {
    const { t, asAdmin, runId } = await seedWithOutline();
    const edited = makeOutline({ courseTitle: "Health, Reframed" });
    (edited.modules as Array<{ units: unknown[] }>)[0].units = [
      (edited.modules as Array<{ units: unknown[] }>)[0].units[0],
    ];
    await asAdmin.mutation(api.pipeline.outlineReview.adminUpdateOutline, {
      runId,
      courseTitle: edited.courseTitle as string,
      learningOutcomes: edited.learningOutcomes as string[],
      modules: edited.modules,
    });
    const row = await t.run(async (ctx) =>
      ctx.db
        .query("courseOutlines")
        .withIndex("by_run", (q) => q.eq("runId", runId))
        .unique()
    );
    expect(row?.courseTitle).toBe("Health, Reframed");
    expect(row?.editedBy).toBe("admin@test.dev");
    expect((row?.modules as Array<{ units: unknown[] }>)[0].units).toHaveLength(1);
  });

  test("guarded to OUTLINE_REVIEW; zod rejects out-of-range budgets", async () => {
    const parked = await seedWithOutline("COMPILING");
    const outline = makeOutline();
    await expect(
      parked.asAdmin.mutation(api.pipeline.outlineReview.adminUpdateOutline, {
        runId: parked.runId,
        courseTitle: outline.courseTitle as string,
        learningOutcomes: outline.learningOutcomes as string[],
        modules: outline.modules,
      })
    ).rejects.toThrow(/RUN_NOT_AT_GATE/);

    const editable = await seedWithOutline();
    const bad = makeOutline();
    (bad.modules as Array<{ units: Array<{ secondsBudget: number }> }>)[0].units[0].secondsBudget = 500;
    await expect(
      editable.asAdmin.mutation(api.pipeline.outlineReview.adminUpdateOutline, {
        runId: editable.runId,
        courseTitle: bad.courseTitle as string,
        learningOutcomes: bad.learningOutcomes as string[],
        modules: bad.modules,
      })
    ).rejects.toThrow();
  });
});

describe("approve / regenerate", () => {
  test("approve passes guards and reaches the compile workflow start", async () => {
    const { t, runId } = await seedWithOutline();
    // The workflow component is not registered under convex-test; reaching
    // this error proves the state guard, outline lookup, approval patch,
    // and COMPILING transition all passed.
    await expect(
      t.mutation(internal.pipeline.outlineReview.approveOutline, { runId })
    ).rejects.toThrow(/Component "workflow" is not registered/);
  });

  test("approve refuses runs not parked at OUTLINE_REVIEW", async () => {
    const { t, runId } = await seedWithOutline("GATE_1_KNOWLEDGE_REVIEW");
    await expect(
      t.mutation(internal.pipeline.outlineReview.approveOutline, { runId })
    ).rejects.toThrow(/RUN_NOT_AT_GATE/);
  });

  test("regenerate requires feedback and reaches the outline workflow start", async () => {
    const { t, runId } = await seedWithOutline();
    await expect(
      t.mutation(internal.pipeline.outlineReview.regenerateOutline, {
        runId,
        feedback: "   ",
      })
    ).rejects.toThrow(/OUTLINE_INVALID/);
    await expect(
      t.mutation(internal.pipeline.outlineReview.regenerateOutline, {
        runId,
        feedback: "Drop module 2; focus outcomes on placements.",
      })
    ).rejects.toThrow(/Component "workflow" is not registered/);
  });

  test("gate-1 approval routes to OUTLINING (generateOutline workflow)", async () => {
    const { t, runId } = await seed("GATE_1_KNOWLEDGE_REVIEW");
    await expect(
      t.mutation(internal.pipeline.runs.decideGate, {
        runId,
        gate: 1,
        decision: "approve",
      })
    ).rejects.toThrow(/Component "workflow" is not registered/);
  });
});

describe("adminGetOutline", () => {
  test("returns outline + unused concepts + suggested-asset metadata", async () => {
    const { t, asAdmin, runId, clearedAsset } = await seed();
    const outline = makeOutline();
    (outline.modules as Array<{ units: Array<{ mediaAssetIds: unknown }> }>)[0].units[0].mediaAssetIds =
      [clearedAsset];
    await t.mutation(internal.pipeline.outlineReview.saveCourseOutline, {
      runId,
      outline,
      promptVersion: "outline-course@1",
      model: "m",
    });

    const view = await asAdmin.query(api.pipeline.outlineReview.adminGetOutline, {
      runId,
    });
    expect(view.brief).toBe("Focus on health placements.");
    expect(view.outline?.courseTitle).toBe("Banksia Health Essentials");
    // "placements" is in the inventory but not in the outline.
    expect(view.unusedConcepts.map((c) => c.key)).toEqual(["placements"]);
    expect(view.suggestedAssets[clearedAsset as Id<"assets">]).toMatchObject({
      kind: "image",
    });
  });
});
