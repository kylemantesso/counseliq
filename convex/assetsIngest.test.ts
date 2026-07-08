/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const KEY_A = `sha256/${"a".repeat(64)}.jpg`;
const KEY_A_THUMB = `sha256/${"b".repeat(64)}.jpg`;
const KEY_V = `sha256/${"c".repeat(64)}.mp4`;
const KEY_V_POSTER = `sha256/${"d".repeat(64)}.jpg`;
const KEY_ZIP = `sha256/${"e".repeat(64)}.zip`;

function makeManifest() {
  return {
    files: [
      {
        status: "accepted",
        sourceKey: KEY_A,
        originalName: "quad.jpg",
        kind: "image",
        objectKey: KEY_A,
        thumbKey: KEY_A_THUMB,
        width: 640,
        height: 360,
      },
      {
        status: "accepted",
        sourceKey: KEY_ZIP,
        originalName: "pack.zip/broll.mp4",
        kind: "video",
        objectKey: KEY_V,
        thumbKey: KEY_V_POSTER,
        width: 1920,
        height: 1080,
        durationMs: 2100,
      },
      {
        status: "rejected",
        sourceKey: KEY_ZIP,
        originalName: "pack.zip/too-long.mp4",
        reason: "video is 90s — over the 60s cap",
      },
    ],
  };
}

async function seed() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const institutionId = await ctx.db.insert("institutions", {
      name: "Banksia University",
      brandTokens: { placeholder: true },
      pronunciationLexicon: {},
      market: "AU",
    });
    const jobId = await ctx.db.insert("assetIngestJobs", {
      institutionId,
      files: [
        { sourceKey: KEY_A, originalName: "quad.jpg" },
        { sourceKey: KEY_ZIP, originalName: "pack.zip" },
      ],
      status: "dispatched",
      createdBy: "operator@test",
    });
    return { institutionId, jobId };
  });
  return { t, ...ids };
}

describe("applyAssetManifest", () => {
  test("catalogues accepted files with rights unknown; records rejections", async () => {
    const { t, institutionId, jobId } = await seed();
    await t.mutation(internal.pipeline.assetsIngest.applyAssetManifest, {
      jobId,
      manifest: makeManifest(),
    });

    const { job, catalogued } = await t.run(async (ctx) => ({
      job: await ctx.db.get(jobId),
      catalogued: (await ctx.db.query("assets").take(100)).filter(
        (a) => a.institutionId === institutionId
      ),
    }));

    expect(job?.status).toBe("complete");
    expect(job?.acceptedCount).toBe(2);
    expect(job?.rejected).toEqual([
      {
        originalName: "pack.zip/too-long.mp4",
        reason: "video is 90s — over the 60s cap",
      },
    ]);

    expect(catalogued).toHaveLength(2);
    const image = catalogued.find((a) => a.kind === "image");
    const video = catalogued.find((a) => a.kind === "video");
    expect(image).toMatchObject({
      objectKey: KEY_A,
      thumbKey: KEY_A_THUMB,
      rights: "unknown",
      origin: "uploaded",
      aspect: "landscape",
      width: 640,
      height: 360,
    });
    expect(video).toMatchObject({
      objectKey: KEY_V,
      rights: "unknown",
      durationMs: 2100,
      originalName: "pack.zip/broll.mp4",
    });
  });

  test("re-delivery is idempotent and never resets operator-declared rights", async () => {
    const { t, institutionId, jobId } = await seed();
    await t.mutation(internal.pipeline.assetsIngest.applyAssetManifest, {
      jobId,
      manifest: makeManifest(),
    });

    // Operator declares rights between deliveries.
    await t.run(async (ctx) => {
      const image = (await ctx.db.query("assets").take(100)).find(
        (a) => a.institutionId === institutionId && a.objectKey === KEY_A
      );
      await ctx.db.patch(image!._id, {
        rights: "institution_owned",
        rightsDeclaredBy: "operator@test",
        rightsDeclaredAt: 1780000000000,
      });
    });

    await t.mutation(internal.pipeline.assetsIngest.applyAssetManifest, {
      jobId,
      manifest: makeManifest(),
    });

    const catalogued = await t.run(async (ctx) =>
      (await ctx.db.query("assets").take(100)).filter(
        (a) => a.institutionId === institutionId
      )
    );
    expect(catalogued).toHaveLength(2); // no duplicates
    const image = catalogued.find((a) => a.objectKey === KEY_A);
    expect(image?.rights).toBe("institution_owned");
    expect(image?.rightsDeclaredBy).toBe("operator@test");
  });

  test("unknown jobId errors", async () => {
    const { t, jobId } = await seed();
    await t.run(async (ctx) => ctx.db.delete(jobId));
    await expect(
      t.mutation(internal.pipeline.assetsIngest.applyAssetManifest, {
        jobId,
        manifest: makeManifest(),
      })
    ).rejects.toThrow();
  });
});

describe("backfillDeckExtractedAssets", () => {
  test("promotes embedded-image rows with dims/institution from slides", async () => {
    const t = convexTest(schema, modules);
    const embeddedKey = `sha256/${"1".repeat(64)}.png`;
    const { institutionId, assetId, ttsAssetId } = await t.run(async (ctx) => {
      const institutionId = await ctx.db.insert("institutions", {
        name: "Banksia University",
        brandTokens: { placeholder: true },
        pronunciationLexicon: {},
        market: "AU",
      });
      const sourceDocId = await ctx.db.insert("sourceDocs", {
        institutionId,
        kind: "pptx",
        objectKey: `sha256/${"9".repeat(64)}.pptx`,
        status: "converted",
      });
      await ctx.db.insert("slides", {
        sourceDocId,
        n: 12,
        pngKey: `sha256/${"2".repeat(64)}.png`,
        text: "",
        notes: "",
        hash: "2".repeat(64),
        provenanceId: `doc:${sourceDocId}:page:12`,
        embeddedImages: [{ key: embeddedKey, width: 800, height: 1200 }],
      });
      const assetId = await ctx.db.insert("assets", {
        objectKey: embeddedKey,
        kind: "embedded-image",
        sourceProvenance: `doc:${sourceDocId}:page:12`,
      });
      const ttsAssetId = await ctx.db.insert("assets", {
        objectKey: `sha256/${"3".repeat(64)}.mp3`,
        kind: "tts-audio",
      });
      return { institutionId, assetId, ttsAssetId };
    });

    const result = await t.mutation(
      internal.pipeline.assetsIngest.backfillDeckExtractedAssets,
      {}
    );
    expect(result).toEqual({ promoted: 1, skipped: 0 });

    const { promoted, tts } = await t.run(async (ctx) => ({
      promoted: await ctx.db.get(assetId as Id<"assets">),
      tts: await ctx.db.get(ttsAssetId as Id<"assets">),
    }));
    expect(promoted).toMatchObject({
      kind: "image",
      origin: "deck_extracted",
      rights: "unknown",
      institutionId,
      width: 800,
      height: 1200,
      aspect: "portrait",
    });
    // Bookkeeping rows untouched.
    expect(tts?.kind).toBe("tts-audio");
    expect(tts?.origin).toBeUndefined();

    // Idempotent: a second run promotes nothing.
    const again = await t.mutation(
      internal.pipeline.assetsIngest.backfillDeckExtractedAssets,
      {}
    );
    expect(again).toEqual({ promoted: 0, skipped: 0 });
  });
});
