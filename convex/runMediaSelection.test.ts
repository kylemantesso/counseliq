/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function seedSelectionFixture() {
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
      brandTokens: {},
      pronunciationLexicon: {},
      market: "AU",
    });
    const otherInstitutionId = await ctx.db.insert("institutions", {
      name: "Other University",
      brandTokens: {},
      pronunciationLexicon: {},
      market: "AU",
    });

    const selectedClearedId = await ctx.db.insert("assets", {
      institutionId,
      objectKey: `sha256/${"a".repeat(64)}.jpg`,
      kind: "image",
      aspect: "landscape",
      caption: "Selected and cleared",
      taggedAt: 1,
      rights: "institution_owned",
    });
    const selectedUnclearedId = await ctx.db.insert("assets", {
      institutionId,
      objectKey: `sha256/${"b".repeat(64)}.jpg`,
      kind: "image",
      aspect: "landscape",
      caption: "Selected with unknown rights",
      taggedAt: 1,
      rights: "unknown",
    });
    const unselectedClearedId = await ctx.db.insert("assets", {
      institutionId,
      objectKey: `sha256/${"c".repeat(64)}.jpg`,
      kind: "image",
      aspect: "landscape",
      caption: "Not selected",
      taggedAt: 1,
      rights: "licensed",
    });
    const selectedUntaggedId = await ctx.db.insert("assets", {
      institutionId,
      objectKey: `sha256/${"d".repeat(64)}.jpg`,
      kind: "image",
      aspect: "landscape",
      rights: "licensed",
    });
    const foreignAssetId = await ctx.db.insert("assets", {
      institutionId: otherInstitutionId,
      objectKey: `sha256/${"e".repeat(64)}.jpg`,
      kind: "image",
      aspect: "landscape",
      caption: "Foreign asset",
      taggedAt: 1,
      rights: "licensed",
    });
    const bookkeepingAssetId = await ctx.db.insert("assets", {
      institutionId,
      objectKey: `sha256/${"f".repeat(64)}.png`,
      kind: "page-png",
    });
    const explicitRunId = await ctx.db.insert("runs", {
      institutionId,
      state: "OUTLINING",
      promptVersions: {},
      hasExplicitAssetSelection: true,
    });
    for (const assetId of [
      selectedClearedId,
      selectedUnclearedId,
      selectedUntaggedId,
    ]) {
      await ctx.db.insert("runAssetSelections", { runId: explicitRunId, assetId });
    }
    const emptyRunId = await ctx.db.insert("runs", {
      institutionId,
      state: "OUTLINING",
      promptVersions: {},
      hasExplicitAssetSelection: true,
    });
    const legacyRunId = await ctx.db.insert("runs", {
      institutionId,
      state: "OUTLINING",
      promptVersions: {},
    });
    return {
      institutionId,
      selectedClearedId,
      selectedUnclearedId,
      unselectedClearedId,
      selectedUntaggedId,
      foreignAssetId,
      bookkeepingAssetId,
      explicitRunId,
      emptyRunId,
      legacyRunId,
    };
  });
  return { t, asAdmin: t.withIdentity({ subject: "admin" }), ...ids };
}

describe("per-run media selection", () => {
  test("adminStartRun rejects duplicate, foreign, and non-catalogue selections", async () => {
    const {
      asAdmin,
      institutionId,
      selectedClearedId,
      foreignAssetId,
      bookkeepingAssetId,
    } = await seedSelectionFixture();

    for (const assetIds of [
      [selectedClearedId, selectedClearedId],
      [foreignAssetId],
      [bookkeepingAssetId],
    ]) {
      await expect(
        asAdmin.mutation(api.pipeline.runs.adminStartRun, {
          institutionId,
          sourceDocIds: [],
          assetIds,
        })
      ).rejects.toThrow(/RUN_ASSET_SELECTION_INVALID/);
    }
  });

  test("compiler catalogue uses selected, cleared, tagged assets and supports empty selection", async () => {
    const {
      t,
      explicitRunId,
      emptyRunId,
      selectedClearedId,
    } = await seedSelectionFixture();

    const explicit = await t.query(
      internal.pipeline.assetsCatalogue.getClearedCatalogueForRun,
      { runId: explicitRunId }
    );
    expect(explicit.map((asset) => asset.id)).toEqual([selectedClearedId]);
    await expect(
      t.query(internal.pipeline.assetsCatalogue.getClearedCatalogueForRun, {
        runId: emptyRunId,
      })
    ).resolves.toEqual([]);
  });

  test("legacy runs retain the institution-wide cleared tagged catalogue", async () => {
    const {
      t,
      legacyRunId,
      selectedClearedId,
      unselectedClearedId,
    } = await seedSelectionFixture();

    const catalogue = await t.query(
      internal.pipeline.assetsCatalogue.getClearedCatalogueForRun,
      { runId: legacyRunId }
    );
    expect(new Set(catalogue.map((asset) => asset.id))).toEqual(
      new Set([selectedClearedId, unselectedClearedId])
    );
  });

  test("admin report and swap picker reflect only the explicit selection", async () => {
    const {
      asAdmin,
      explicitRunId,
      selectedClearedId,
      selectedUnclearedId,
      selectedUntaggedId,
    } = await seedSelectionFixture();

    const report = await asAdmin.query(
      api.pipeline.assetsCatalogue.adminGetRunMediaSelection,
      { runId: explicitRunId }
    );
    expect(report).toMatchObject({
      explicitSelection: true,
      counts: { selected: 3, cleared: 2, needsRights: 1 },
    });
    expect(new Set(report.assets.map((asset) => asset._id))).toEqual(
      new Set([selectedClearedId, selectedUnclearedId, selectedUntaggedId])
    );

    const swappable = await asAdmin.query(
      api.pipeline.assetsCatalogue.adminListSwappableAssets,
      { runId: explicitRunId, template: "image-card" }
    );
    expect(new Set(swappable.map((asset) => asset._id))).toEqual(
      new Set([selectedClearedId, selectedUntaggedId])
    );
  });

  test("gate 3 approval blocks while an explicitly selected asset is uncleared", async () => {
    const { t, institutionId, selectedUnclearedId } = await seedSelectionFixture();
    const runId = await t.run(async (ctx) => {
      const courseId = await ctx.db.insert("courses", {
        institutionId,
        title: "Banksia Essentials",
        level: 1,
        version: 1,
        status: "in_review",
      });
      const runId = await ctx.db.insert("runs", {
        institutionId,
        courseId,
        state: "GATE_3_PREVIEW",
        promptVersions: {},
        hasExplicitAssetSelection: true,
      });
      await ctx.db.insert("runAssetSelections", {
        runId,
        assetId: selectedUnclearedId,
      });
      await ctx.db.insert("microUnits", {
        courseId,
        moduleKey: "m1",
        unitKey: "u1",
        concept: "welcome",
        narration: [],
        cards: [],
        state: "assets_ready",
      });
      return runId;
    });

    await expect(
      t.mutation(internal.pipeline.runs.decideGate, {
        runId,
        gate: 3,
        decision: "approve",
      })
    ).rejects.toThrow(/RUN_SELECTED_ASSETS_NOT_CLEARED/);
  });

  test("run deletion removes normalized selection rows", async () => {
    const { t, asAdmin, emptyRunId, selectedClearedId } =
      await seedSelectionFixture();
    await t.run(async (ctx) => {
      await ctx.db.insert("runAssetSelections", {
        runId: emptyRunId,
        assetId: selectedClearedId,
      });
    });

    await asAdmin.mutation(api.pipeline.runs.adminDeleteRun, {
      runId: emptyRunId,
    });
    const selections = await t.run(async (ctx) =>
      ctx.db
        .query("runAssetSelections")
        .withIndex("by_run", (q) => q.eq("runId", emptyRunId))
        .take(10)
    );
    expect(selections).toEqual([]);
  });
});
