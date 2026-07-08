import { v } from "convex/values";
import { deriveAspect, type AssetIngestManifest } from "@counseliq/course-schema";
import { action, internalMutation } from "../_generated/server";
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
    thumbKey: string;
    width: number;
    height: number;
    durationMs?: number;
    origin: "deck_extracted" | "uploaded";
    originalName?: string;
    sourceProvenance?: string;
  }
): Promise<Id<"assets">> {
  const existing = await ctx.db
    .query("assets")
    .withIndex("by_institution_and_object", (q) =>
      q.eq("institutionId", institutionId).eq("objectKey", fields.objectKey)
    )
    .first();
  const derived = {
    kind: fields.kind,
    thumbKey: fields.thumbKey,
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
