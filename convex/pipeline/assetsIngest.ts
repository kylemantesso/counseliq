import { v } from "convex/values";
import {
  deriveAspect,
  type AssetIngestManifest,
  type PdfImageManifest,
} from "@counseliq/course-schema";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
} from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { AppErrorCode, appError } from "../errors";
import { hmacSha256Hex, SIGNATURE_HEADER } from "./hmac";

/**
 * Asset-library ingestion (M6): the admin page uploads content-addressed
 * files (browser-side sha256 → presigned PUT), then this module dispatches
 * a signed /ingest-assets job to the converter and applies the manifest it
 * posts back. Every catalogued asset lands with rights "unknown" — the
 * operator declares rights in the library page; nothing else ever writes
 * that field to a usable value.
 */

const ACTOR_STATUS = { DISPATCHED: "dispatched", COMPLETE: "complete", FAILED: "failed" } as const;

export const createIngestJob = internalMutation({
  args: {
    institutionId: v.id("institutions"),
    files: v.array(
      v.object({ sourceKey: v.string(), originalName: v.string() })
    ),
    createdBy: v.string(),
  },
  handler: async (ctx, args) => {
    const institution = await ctx.db.get(args.institutionId);
    if (!institution) appError(AppErrorCode.INSTITUTION_NOT_FOUND);
    return await ctx.db.insert("assetIngestJobs", {
      institutionId: args.institutionId,
      files: args.files,
      status: ACTOR_STATUS.DISPATCHED,
      createdBy: args.createdBy,
    });
  },
});

export const markIngestJobFailed = internalMutation({
  args: { jobId: v.id("assetIngestJobs"), error: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.jobId, {
      status: ACTOR_STATUS.FAILED,
      error: args.error,
    });
    return null;
  },
});

/**
 * Admin entry point: register the job and dispatch it to the converter.
 * Files must already be uploaded (adminPresignPutBatch → PUT).
 */
export const adminIngestAssets = action({
  args: {
    institutionId: v.id("institutions"),
    files: v.array(
      v.object({ sourceKey: v.string(), originalName: v.string() })
    ),
  },
  handler: async (ctx, args): Promise<{ jobId: Id<"assetIngestJobs"> }> => {
    const admin: { email: string } = await ctx.runQuery(
      internal.pipeline.queries.assertAdmin,
      {}
    );

    const converterUrl = process.env.CONVERTER_URL;
    const secret = process.env.CONVERTER_CALLBACK_SECRET;
    const callbackUrl =
      process.env.CONVERTER_ASSET_CALLBACK_URL ??
      `${process.env.CONVEX_SITE_URL}/converter/asset-callback`;
    if (!converterUrl || !secret) {
      appError(AppErrorCode.CONVERTER_NOT_CONFIGURED);
    }

    const jobId: Id<"assetIngestJobs"> = await ctx.runMutation(
      internal.pipeline.assetsIngest.createIngestJob,
      {
        institutionId: args.institutionId,
        files: args.files,
        createdBy: admin.email,
      }
    );

    const body = JSON.stringify({ jobId, files: args.files, callbackUrl });
    const signature = await hmacSha256Hex(body, secret);
    const response = await fetch(
      `${converterUrl.replace(/\/$/, "")}/ingest-assets`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [SIGNATURE_HEADER]: signature,
        },
        body,
      }
    );
    if (!response.ok) {
      await ctx.runMutation(internal.pipeline.assetsIngest.markIngestJobFailed, {
        jobId,
        error: `converter dispatch failed: HTTP ${response.status}`,
      });
      appError(AppErrorCode.CONVERTER_NOT_CONFIGURED);
    }
    return { jobId };
  },
});

/**
 * Upsert one catalogue row keyed (institutionId, objectKey). Re-delivered
 * manifests patch identical values; crucially, an existing row's `rights`
 * (and any operator edits) are never clobbered back to "unknown".
 */
export async function upsertCatalogueAsset(
  ctx: MutationCtx,
  institutionId: Id<"institutions">,
  fields: {
    objectKey: string;
    kind: "image" | "video";
    /** Absent only for deck-extracted images from pre-thumbnail manifests. */
    thumbKey?: string;
    width: number;
    height: number;
    durationMs?: number;
    origin: "deck_extracted" | "uploaded";
    originalName?: string;
    sourceProvenance?: string;
  }
): Promise<Id<"assets">> {
  let existing = await ctx.db
    .query("assets")
    .withIndex("by_institution_and_object", (q) =>
      q.eq("institutionId", institutionId).eq("objectKey", fields.objectKey)
    )
    .first();
  if (!existing) {
    // Adopt a pre-M6 bookkeeping row for the same object (no institution
    // yet) instead of duplicating it — the backfill may not have run.
    const unowned = await ctx.db
      .query("assets")
      .withIndex("by_object_key", (q) => q.eq("objectKey", fields.objectKey))
      .first();
    if (unowned && unowned.institutionId === undefined) {
      await ctx.db.patch(unowned._id, { institutionId });
      existing = { ...unowned, institutionId };
    }
  }
  const derived = {
    kind: fields.kind,
    ...(fields.thumbKey !== undefined ? { thumbKey: fields.thumbKey } : {}),
    width: fields.width,
    height: fields.height,
    aspect: deriveAspect(fields.width, fields.height),
    ...(fields.durationMs !== undefined ? { durationMs: fields.durationMs } : {}),
    origin: fields.origin,
    ...(fields.originalName !== undefined
      ? { originalName: fields.originalName }
      : {}),
    ...(fields.sourceProvenance !== undefined
      ? { sourceProvenance: fields.sourceProvenance }
      : {}),
  };
  if (existing) {
    await ctx.db.patch(existing._id, derived);
    return existing._id;
  }
  return await ctx.db.insert("assets", {
    objectKey: fields.objectKey,
    institutionId,
    rights: "unknown",
    ...derived,
  });
}

/**
 * Converter callback: catalogue accepted files, record rejections on the
 * job row. Idempotent — re-delivery patches the same rows.
 */
export const applyAssetManifest = internalMutation({
  args: {
    // Validated against the shared Zod contract at the HTTP boundary.
    jobId: v.string(),
    manifest: v.any(),
  },
  handler: async (ctx, args) => {
    const jobId = ctx.db.normalizeId("assetIngestJobs", args.jobId);
    if (!jobId) appError(AppErrorCode.ASSET_JOB_NOT_FOUND);
    const job = await ctx.db.get(jobId);
    if (!job) appError(AppErrorCode.ASSET_JOB_NOT_FOUND);

    const manifest = args.manifest as AssetIngestManifest;
    let acceptedCount = 0;
    const rejected: { originalName: string; reason: string }[] = [];
    for (const entry of manifest.files) {
      if (entry.status === "rejected") {
        rejected.push({ originalName: entry.originalName, reason: entry.reason });
        continue;
      }
      acceptedCount += 1;
      await upsertCatalogueAsset(ctx, job.institutionId, {
        objectKey: entry.objectKey,
        kind: entry.kind,
        thumbKey: entry.thumbKey,
        width: entry.width,
        height: entry.height,
        ...(entry.durationMs !== undefined
          ? { durationMs: entry.durationMs }
          : {}),
        origin: "uploaded",
        originalName: entry.originalName,
      });
    }

    await ctx.db.patch(jobId, {
      status: ACTOR_STATUS.COMPLETE,
      acceptedCount,
      rejected,
    });
    return null;
  },
});

/**
 * Retroactive pdf-image callback: catalogue the extracted images, reflect
 * them onto the doc's slides (gate-1 inspector parity with pptx), and merge
 * repeat images into the doc theme's logoCandidates. jobId is the
 * sourceDocs id (mirrors /convert). Idempotent.
 */
export const applyPdfImagesManifest = internalMutation({
  args: {
    // Validated against the shared Zod contract at the HTTP boundary.
    jobId: v.string(),
    manifest: v.any(),
  },
  handler: async (ctx, args) => {
    const sourceDocId = ctx.db.normalizeId("sourceDocs", args.jobId);
    if (!sourceDocId) appError(AppErrorCode.SOURCE_DOC_NOT_FOUND);
    const doc = await ctx.db.get(sourceDocId);
    if (!doc) appError(AppErrorCode.SOURCE_DOC_NOT_FOUND);

    const manifest = args.manifest as PdfImageManifest;

    for (const image of manifest.images) {
      const firstPage = image.pageNs[0];
      await upsertCatalogueAsset(ctx, doc.institutionId, {
        objectKey: image.key,
        kind: "image",
        thumbKey: image.thumbKey,
        width: image.width,
        height: image.height,
        origin: "deck_extracted",
        sourceProvenance: `doc:${sourceDocId}:page:${firstPage}`,
      });
      for (const pageN of image.pageNs) {
        const slide = await ctx.db
          .query("slides")
          .withIndex("by_source_doc_and_n", (q) =>
            q.eq("sourceDocId", sourceDocId).eq("n", pageN)
          )
          .unique();
        if (!slide) continue;
        const embedded = slide.embeddedImages ?? [];
        if (embedded.some((entry) => entry.key === image.key)) continue;
        await ctx.db.patch(slide._id, {
          embeddedImages: [
            ...embedded,
            {
              key: image.key,
              width: image.width,
              height: image.height,
              thumbKey: image.thumbKey,
            },
          ],
        });
      }
    }

    const docProvenance = `doc:${sourceDocId}`;
    for (const logoKey of manifest.logoCandidates) {
      const existing = await ctx.db
        .query("assets")
        .withIndex("by_object_key", (q) => q.eq("objectKey", logoKey))
        .first();
      if (!existing) {
        await ctx.db.insert("assets", {
          objectKey: logoKey,
          kind: "logo-candidate",
          sourceProvenance: docProvenance,
        });
      }
    }
    if (manifest.logoCandidates.length > 0) {
      const theme = doc.theme ?? {
        method: "llm-inferred" as const,
        colors: [],
        fonts: [],
        logoCandidates: [],
      };
      await ctx.db.patch(sourceDocId, {
        theme: {
          ...theme,
          logoCandidates: [
            ...new Set([...theme.logoCandidates, ...manifest.logoCandidates]),
          ],
        },
      });
    }
    return null;
  },
});

/** Converted pdf source docs (retro pdf-image extraction targets). */
export const listConvertedPdfDocs = internalQuery({
  args: {},
  handler: async (ctx) => {
    const docs = await ctx.db.query("sourceDocs").take(500);
    return docs
      .filter((doc) => doc.kind === "pdf" && doc.status === "converted")
      .map((doc) => ({ _id: doc._id, objectKey: doc.objectKey }));
  },
});

/**
 * One-shot retroactive run (M6): dispatch /extract-pdf-images for every
 * already-converted pdf source doc. Callbacks land asynchronously and apply
 * idempotently — verify results in the asset library. Run via
 *   npx convex run pipeline/assetsIngest:backfillPdfImages
 */
export const backfillPdfImages = internalAction({
  args: {},
  handler: async (ctx): Promise<{ dispatched: number }> => {
    const converterUrl = process.env.CONVERTER_URL;
    const secret = process.env.CONVERTER_CALLBACK_SECRET;
    const callbackUrl =
      process.env.CONVERTER_PDF_IMAGES_CALLBACK_URL ??
      `${process.env.CONVEX_SITE_URL}/converter/pdf-images-callback`;
    if (!converterUrl || !secret) {
      appError(AppErrorCode.CONVERTER_NOT_CONFIGURED);
    }
    const docs = await ctx.runQuery(
      internal.pipeline.assetsIngest.listConvertedPdfDocs,
      {}
    );
    let dispatched = 0;
    for (const doc of docs) {
      const body = JSON.stringify({
        jobId: doc._id,
        sourceKey: doc.objectKey,
        callbackUrl,
      });
      const signature = await hmacSha256Hex(body, secret);
      const response = await fetch(
        `${converterUrl.replace(/\/$/, "")}/extract-pdf-images`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            [SIGNATURE_HEADER]: signature,
          },
          body,
        }
      );
      if (!response.ok) {
        console.error(
          `[assets] pdf-image dispatch failed for doc ${doc._id}: HTTP ${response.status}`
        );
        continue;
      }
      dispatched += 1;
    }
    return { dispatched };
  },
});

/**
 * One-shot backfill (M6): promote M2's `embedded-image` bookkeeping rows to
 * catalogue rows (kind "image", origin "deck_extracted", rights "unknown",
 * institution + dimensions joined from the source doc's slides). Idempotent:
 * rows that already carry `origin` are skipped. Run via
 *   npx convex run pipeline/assetsIngest:backfillDeckExtractedAssets
 */
export const backfillDeckExtractedAssets = internalMutation({
  args: {},
  handler: async (ctx) => {
    const candidates = (await ctx.db.query("assets").take(5000)).filter(
      (asset) => asset.kind === "embedded-image" && asset.origin === undefined
    );
    let promoted = 0;
    let skipped = 0;
    for (const asset of candidates) {
      const resolved = await resolveDeckAssetContext(ctx, asset);
      if (!resolved) {
        skipped += 1;
        continue;
      }
      await ctx.db.patch(asset._id, {
        kind: "image",
        origin: "deck_extracted",
        rights: asset.rights ?? "unknown",
        institutionId: resolved.institutionId,
        width: resolved.width,
        height: resolved.height,
        aspect: deriveAspect(resolved.width, resolved.height),
        ...(resolved.thumbKey !== undefined
          ? { thumbKey: resolved.thumbKey }
          : {}),
      });
      promoted += 1;
    }
    return { promoted, skipped };
  },
});

/** Institution + dimensions for an embedded-image row via its page provenance. */
async function resolveDeckAssetContext(
  ctx: MutationCtx,
  asset: Doc<"assets">
): Promise<{
  institutionId: Id<"institutions">;
  width: number;
  height: number;
  thumbKey?: string;
} | null> {
  const match = asset.sourceProvenance?.match(/^doc:([^:]+):page:(\d+)$/);
  if (!match) return null;
  const sourceDocId = ctx.db.normalizeId("sourceDocs", match[1]);
  if (!sourceDocId) return null;
  const doc = await ctx.db.get(sourceDocId);
  if (!doc) return null;
  const slide = await ctx.db
    .query("slides")
    .withIndex("by_source_doc_and_n", (q) =>
      q.eq("sourceDocId", sourceDocId).eq("n", Number(match[2]))
    )
    .unique();
  const image = slide?.embeddedImages?.find(
    (entry) => entry.key === asset.objectKey
  );
  if (!image) return null;
  return {
    institutionId: doc.institutionId,
    width: image.width,
    height: image.height,
    ...(image.thumbKey !== undefined ? { thumbKey: image.thumbKey } : {}),
  };
}
