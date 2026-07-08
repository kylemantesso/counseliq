/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

/** Admin identity + an institution with two catalogue assets and one bookkeeping row. */
async function seedLibrary() {
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
    const imageId = await ctx.db.insert("assets", {
      objectKey: `sha256/${"a".repeat(64)}.jpg`,
      kind: "image",
      institutionId,
      thumbKey: `sha256/${"b".repeat(64)}.jpg`,
      width: 640,
      height: 360,
      aspect: "landscape",
      origin: "uploaded",
      rights: "unknown",
    });
    const videoId = await ctx.db.insert("assets", {
      objectKey: `sha256/${"c".repeat(64)}.mp4`,
      kind: "video",
      institutionId,
      thumbKey: `sha256/${"d".repeat(64)}.jpg`,
      width: 1920,
      height: 1080,
      aspect: "landscape",
      durationMs: 2100,
      origin: "uploaded",
      rights: "unknown",
      identifiablePeople: true,
    });
    await ctx.db.insert("assets", {
      objectKey: `sha256/${"e".repeat(64)}.png`,
      kind: "page-png",
      institutionId,
      sourceProvenance: "doc:x:page:1",
    });
    return { institutionId, imageId, videoId };
  });
  return { t, asAdmin: t.withIdentity({ subject: "admin" }), ...ids };
}

describe("asset library admin surface", () => {
  test("adminListAssets returns catalogue rows only, with the cleared verdict", async () => {
    const { asAdmin, institutionId } = await seedLibrary();
    const assets = await asAdmin.query(
      api.pipeline.assetsCatalogue.adminListAssets,
      { institutionId }
    );
    expect(assets).toHaveLength(2); // page-png bookkeeping never surfaces
    expect(assets.every((a) => a.cleared === false)).toBe(true); // all unknown
  });

  test("bulk rights declaration stamps declarer and clears assets", async () => {
    const { t, asAdmin, institutionId, imageId, videoId } = await seedLibrary();
    await asAdmin.mutation(api.pipeline.assetsCatalogue.adminDeclareAssetRights, {
      assetIds: [imageId, videoId] as Id<"assets">[],
      rights: "institution_owned",
    });

    const assets = await asAdmin.query(
      api.pipeline.assetsCatalogue.adminListAssets,
      { institutionId }
    );
    const image = assets.find((a) => a._id === imageId);
    const video = assets.find((a) => a._id === videoId);
    expect(image?.rights).toBe("institution_owned");
    expect(image?.rightsDeclaredBy).toBe("admin@test.dev");
    expect(image?.rightsDeclaredAt).toBeGreaterThan(0);
    expect(image?.cleared).toBe(true);
    // Video shows identifiable people — rights alone do NOT clear it.
    expect(video?.cleared).toBe(false);

    await asAdmin.mutation(api.pipeline.assetsCatalogue.adminConfirmPeopleConsent, {
      assetId: videoId,
      confirmed: true,
    });
    const after = await asAdmin.query(
      api.pipeline.assetsCatalogue.adminListAssets,
      { institutionId }
    );
    expect(after.find((a) => a._id === videoId)?.cleared).toBe(true);

    // Revoking back to unknown makes it unusable again, mechanically.
    await asAdmin.mutation(api.pipeline.assetsCatalogue.adminDeclareAssetRights, {
      assetIds: [videoId] as Id<"assets">[],
      rights: "unknown",
    });
    const revoked = await asAdmin.query(
      api.pipeline.assetsCatalogue.adminListAssets,
      { institutionId }
    );
    expect(revoked.find((a) => a._id === videoId)?.cleared).toBe(false);
    void t;
  });

  test("only a human can lower identifiablePeople; caption edits persist", async () => {
    const { asAdmin, institutionId, videoId } = await seedLibrary();
    await asAdmin.mutation(api.pipeline.assetsCatalogue.adminSetIdentifiablePeople, {
      assetId: videoId,
      value: false,
    });
    await asAdmin.mutation(api.pipeline.assetsCatalogue.adminUpdateAssetMeta, {
      assetId: videoId,
      caption: "Aerial flyover of the main campus",
      tags: ["campus", "aerial"],
    });
    const assets = await asAdmin.query(
      api.pipeline.assetsCatalogue.adminListAssets,
      { institutionId }
    );
    const video = assets.find((a) => a._id === videoId);
    expect(video?.identifiablePeople).toBe(false);
    expect(video?.caption).toBe("Aerial flyover of the main campus");
    expect(video?.tags).toEqual(["campus", "aerial"]);
  });

  test("non-admin callers are rejected", async () => {
    const { t, institutionId } = await seedLibrary();
    await expect(
      t.query(api.pipeline.assetsCatalogue.adminListAssets, { institutionId })
    ).rejects.toThrow();
  });
});
