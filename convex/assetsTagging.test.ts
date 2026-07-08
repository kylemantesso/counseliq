/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import { isAssetCleared } from "./pipeline/assetsCatalogue";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const PROMPT_V1 = "tag-asset@1";
const MODEL = "google/gemini-2.5-flash";

async function seedAsset(fields: Record<string, unknown> = {}) {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const institutionId = await ctx.db.insert("institutions", {
      name: "Banksia University",
      brandTokens: { placeholder: true },
      pronunciationLexicon: {},
      market: "AU",
    });
    const assetId = await ctx.db.insert("assets", {
      objectKey: `sha256/${"a".repeat(64)}.jpg`,
      kind: "image",
      institutionId,
      thumbKey: `sha256/${"b".repeat(64)}.jpg`,
      width: 640,
      height: 360,
      aspect: "landscape",
      origin: "uploaded",
      rights: "unknown",
      ...fields,
    });
    return { institutionId, assetId };
  });
  return { t, ...ids };
}

function tagArgs(overrides: Record<string, unknown> = {}) {
  return {
    caption: "Students in a simulated hospital ward",
    tags: ["clinical-training", "simulation"],
    subjects: ["nursing students", "hospital ward"],
    setting: "simulation ward",
    qualityScore: 0.8,
    identifiablePeople: false,
    suggestedUses: ["hero", "inline"],
    tagPromptVersion: PROMPT_V1,
    tagModel: MODEL,
    taggedAt: 1780000000000,
    ...overrides,
  };
}

describe("saveAssetTags code floors", () => {
  test("writes tag output and the cache stamp; rights untouched", async () => {
    const { t, assetId } = await seedAsset();
    await t.mutation(
      internal.pipeline.assetsCatalogue.saveAssetTags,
      { assetId, ...tagArgs() }
    );
    const asset = await t.run(async (ctx) => ctx.db.get(assetId));
    expect(asset).toMatchObject({
      caption: "Students in a simulated hospital ward",
      qualityScore: 0.8,
      identifiablePeople: false,
      tagPromptVersion: PROMPT_V1,
      tagModel: MODEL,
      rights: "unknown", // the write path cannot even express a rights change
    });
  });

  test("identifiablePeople ratchet: model true raises, model false cannot lower", async () => {
    const { t, assetId } = await seedAsset();
    await t.mutation(internal.pipeline.assetsCatalogue.saveAssetTags, {
      assetId,
      ...tagArgs({ identifiablePeople: true }),
    });
    let asset = await t.run(async (ctx) => ctx.db.get(assetId));
    expect(asset?.identifiablePeople).toBe(true);

    // A later re-tag claiming no people must NOT lower the flag.
    await t.mutation(internal.pipeline.assetsCatalogue.saveAssetTags, {
      assetId,
      ...tagArgs({ identifiablePeople: false }),
    });
    asset = await t.run(async (ctx) => ctx.db.get(assetId));
    expect(asset?.identifiablePeople).toBe(true);
  });
});

describe("listUntaggedAssets", () => {
  test("selects catalogue assets missing the CURRENT stamp; bookkeeping never surfaces", async () => {
    const { t, institutionId, assetId } = await seedAsset();
    await t.run(async (ctx) => {
      // Stale prompt version → needs re-tagging.
      await ctx.db.insert("assets", {
        objectKey: `sha256/${"c".repeat(64)}.mp4`,
        kind: "video",
        institutionId,
        thumbKey: `sha256/${"d".repeat(64)}.jpg`,
        origin: "uploaded",
        rights: "unknown",
        taggedAt: 1,
        tagPromptVersion: "tag-asset@0",
        tagModel: MODEL,
      });
      // Bookkeeping row of the same institution — must never surface.
      await ctx.db.insert("assets", {
        objectKey: `sha256/${"e".repeat(64)}.png`,
        kind: "logo-candidate",
        institutionId,
      });
    });
    // Current stamp on the seeded image → excluded.
    await t.mutation(internal.pipeline.assetsCatalogue.saveAssetTags, {
      assetId,
      ...tagArgs(),
    });

    const untagged = await t.query(
      internal.pipeline.assetsCatalogue.listUntaggedAssets,
      { institutionId, promptVersion: PROMPT_V1, model: MODEL }
    );
    expect(untagged).toHaveLength(1); // just the stale-stamp video
  });
});

describe("isAssetCleared — THE usable-asset predicate", () => {
  test("rights must be explicitly declared; unknown never clears", () => {
    expect(isAssetCleared({ rights: "institution_owned" })).toBe(true);
    expect(isAssetCleared({ rights: "licensed" })).toBe(true);
    expect(isAssetCleared({ rights: "unknown" })).toBe(false);
    expect(isAssetCleared({})).toBe(false); // absent = unknown
  });

  test("identifiable people additionally require confirmed consent", () => {
    expect(
      isAssetCleared({ rights: "institution_owned", identifiablePeople: true })
    ).toBe(false);
    expect(
      isAssetCleared({
        rights: "institution_owned",
        identifiablePeople: true,
        peopleConsentConfirmed: true,
      })
    ).toBe(true);
    expect(
      isAssetCleared({ rights: "unknown", peopleConsentConfirmed: true })
    ).toBe(false); // consent never substitutes for rights
  });
});
