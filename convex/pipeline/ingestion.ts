import { v } from "convex/values";
import type { ConversionManifest } from "@counseliq/course-schema";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
} from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { requireAdmin } from "../admin";
import { AppErrorCode, appError } from "../errors";
import { upsertCatalogueAsset } from "./assetsIngest";
import { applyRunTransition } from "./transitions";
import { hmacSha256Hex, SIGNATURE_HEADER } from "./hmac";

const ACTOR = "converter-callback";

/** Provenance ID for a converted page: doc:{sourceDocId}:page:{n}. */
export function pageProvenanceId(
  sourceDocId: Id<"sourceDocs">,
  n: number
): string {
  return `doc:${sourceDocId}:page:${n}`;
}

/**
 * Registers an uploaded source document. Multiple sourceDocs per run are
 * legal — docs are registered first, then linked when the run starts.
 */
export const registerSourceDoc = internalMutation({
  args: {
    institutionId: v.id("institutions"),
    objectKey: v.string(),
    kind: v.union(v.literal("pptx"), v.literal("pdf")),
    shape: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const institution = await ctx.db.get(args.institutionId);
    if (!institution) {
      appError(AppErrorCode.INSTITUTION_NOT_FOUND);
    }
    return await ctx.db.insert("sourceDocs", {
      institutionId: args.institutionId,
      kind: args.kind,
      objectKey: args.objectKey,
      ...(args.shape !== undefined ? { shape: args.shape } : {}),
      status: "pending",
    });
  },
});

/**
 * Admin wrapper for the generate-course page: register an uploaded (or
 * re-used, content-addressed) source document. Fresh rows per run keep
 * old runs' doc history intact; conversion/extraction cache-hit on the
 * unchanged bytes.
 */
export const adminRegisterSourceDoc = mutation({
  args: {
    institutionId: v.id("institutions"),
    objectKey: v.string(),
    kind: v.union(v.literal("pptx"), v.literal("pdf")),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const institution = await ctx.db.get(args.institutionId);
    if (!institution) {
      appError(AppErrorCode.INSTITUTION_NOT_FOUND);
    }
    return await ctx.db.insert("sourceDocs", {
      institutionId: args.institutionId,
      kind: args.kind,
      objectKey: args.objectKey,
      status: "pending",
    });
  },
});

export const listSourceDocsForRun = internalQuery({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("sourceDocs")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .take(100);
  },
});

/** Converted pages for one doc, ordered by page number (scripts/tests). */
export const listSlidesForDoc = internalQuery({
  args: { sourceDocId: v.id("sourceDocs") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("slides")
      .withIndex("by_source_doc_and_n", (q) =>
        q.eq("sourceDocId", args.sourceDocId)
      )
      .take(500);
  },
});

export const markSourceDocConverting = internalMutation({
  args: { sourceDocId: v.id("sourceDocs") },
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.sourceDocId);
    if (!doc) {
      appError(AppErrorCode.SOURCE_DOC_NOT_FOUND);
    }
    if (doc.status === "pending") {
      await ctx.db.patch(args.sourceDocId, { status: "converting" });
    }
    return null;
  },
});

/**
 * Ingests a validated conversion manifest for one source doc: idempotently
 * upserts slides (keyed by sourceDocId+n) and assets (keyed by objectKey),
 * records the candidate theme, and — once every doc on the run is converted
 * — transitions the run CONVERTING -> CONVERTED. Re-delivered callbacks are
 * no-ops: they patch identical values and insert nothing new.
 */
export const applyConversionManifest = internalMutation({
  args: {
    // The manifest is validated against the shared Zod contract at the HTTP
    // boundary (convex/http.ts) before reaching this mutation.
    sourceDocId: v.string(),
    manifest: v.any(),
  },
  handler: async (ctx, args) => {
    const sourceDocId = ctx.db.normalizeId("sourceDocs", args.sourceDocId);
    if (!sourceDocId) {
      appError(AppErrorCode.SOURCE_DOC_NOT_FOUND);
    }
    const doc = await ctx.db.get(sourceDocId);
    if (!doc) {
      appError(AppErrorCode.SOURCE_DOC_NOT_FOUND);
    }

    const manifest = args.manifest as ConversionManifest;

    let catalogueTouched = false;
    for (const page of manifest.pages) {
      const provenanceId = pageProvenanceId(sourceDocId, page.n);
      const pageHash = page.pngKey.replace(/^sha256\//, "").split(".")[0];
      const slideFields = {
        pngKey: page.pngKey,
        thumbKey: page.thumbKey,
        text: page.text,
        notes: page.notes,
        hash: pageHash,
        provenanceId,
        embeddedImages: page.embeddedImages,
      };
      const existing = await ctx.db
        .query("slides")
        .withIndex("by_source_doc_and_n", (q) =>
          q.eq("sourceDocId", sourceDocId).eq("n", page.n)
        )
        .unique();
      if (existing) {
        await ctx.db.patch(existing._id, slideFields);
      } else {
        await ctx.db.insert("slides", {
          sourceDocId,
          n: page.n,
          ...slideFields,
        });
      }

      const pageAssets: { objectKey: string; kind: string }[] = [
        { objectKey: page.pngKey, kind: "page-png" },
        { objectKey: page.thumbKey, kind: "page-thumb" },
      ];
      for (const asset of pageAssets) {
        await insertAssetIfAbsent(ctx, asset.objectKey, asset.kind, provenanceId);
      }
      // Embedded images enter the media catalogue directly (M6): one
      // library, two origins — rights stay "unknown" until declared.
      for (const image of page.embeddedImages) {
        await upsertCatalogueAsset(ctx, doc.institutionId, {
          objectKey: image.key,
          kind: "image",
          ...(image.thumbKey !== undefined ? { thumbKey: image.thumbKey } : {}),
          width: image.width,
          height: image.height,
          origin: "deck_extracted",
          sourceProvenance: provenanceId,
        });
        catalogueTouched = true;
      }
    }

    const docProvenance = `doc:${sourceDocId}`;
    for (const logoKey of manifest.theme?.logoCandidates ?? []) {
      await insertAssetIfAbsent(ctx, logoKey, "logo-candidate", docProvenance);
    }

    if (catalogueTouched) {
      await ctx.scheduler.runAfter(
        0,
        internal.pipeline.assetsTagging.tagUntaggedAssets,
        { institutionId: doc.institutionId }
      );
    }

    await ctx.db.patch(sourceDocId, {
      status: "converted",
      sourceDocHash: manifest.sourceDocHash,
      pageCount: manifest.pageCount,
      theme: manifest.theme,
      themeExtracted: manifest.theme !== null,
    });

    // When every doc on the run is converted, advance the run. Duplicate
    // callbacks find the run already CONVERTED and skip the transition.
    const runId = doc.runId;
    if (runId) {
      const run = await ctx.db.get(runId);
      if (run && run.state === "CONVERTING") {
        const runDocs = await ctx.db
          .query("sourceDocs")
          .withIndex("by_run", (q) => q.eq("runId", runId))
          .take(100);
        const allConverted = runDocs.every(
          (d) => d._id === sourceDocId || d.status === "converted"
        );
        if (allConverted) {
          await applyRunTransition(ctx, {
            runId,
            toState: "CONVERTED",
            actor: ACTOR,
            detail: `all ${runDocs.length} source doc(s) converted`,
          });
        }
      }
    }

    return null;
  },
});

async function insertAssetIfAbsent(
  ctx: MutationCtx,
  objectKey: string,
  kind: string,
  sourceProvenance: string
): Promise<void> {
  const existing = await ctx.db
    .query("assets")
    .withIndex("by_object_key", (q) => q.eq("objectKey", objectKey))
    .first();
  if (existing) return;
  await ctx.db.insert("assets", { objectKey, kind, sourceProvenance });
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const POLL_INTERVAL_MS = 3000;

type AwaitResult =
  | { status: "converted" }
  | { status: "empty" }
  | { status: "timeout"; cause: string };

async function dispatchDoc(
  doc: { _id: Id<"sourceDocs">; objectKey: string; kind: string },
  converterUrl: string,
  callbackUrl: string,
  secret: string
): Promise<void> {
  const body = JSON.stringify({
    jobId: doc._id,
    sourceKey: doc.objectKey,
    kind: doc.kind,
    callbackUrl,
  });
  const signature = await hmacSha256Hex(body, secret);
  const response = await fetch(`${converterUrl.replace(/\/$/, "")}/convert`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [SIGNATURE_HEADER]: signature,
    },
    body,
  });
  if (!response.ok) {
    throw new Error(
      `converter dispatch failed for doc ${doc._id}: ${response.status}`
    );
  }
}

/**
 * The first real pipeline step: dispatch POST /convert for every source doc
 * on the run, then poll until the converter callback has marked them all
 * converted (the callback also transitions the run to CONVERTED). Bounded
 * retry: one re-dispatch at half the window, then timeout.
 */
export const dispatchAndAwaitConversions = internalAction({
  args: { runId: v.id("runs") },
  handler: async (ctx, args): Promise<AwaitResult> => {
    const docs = await ctx.runQuery(
      internal.pipeline.ingestion.listSourceDocsForRun,
      { runId: args.runId }
    );
    if (docs.length === 0) {
      return { status: "empty" };
    }

    const converterUrl = process.env.CONVERTER_URL;
    const secret = process.env.CONVERTER_CALLBACK_SECRET;
    const callbackUrl =
      process.env.CONVERTER_CALLBACK_URL ??
      `${process.env.CONVEX_SITE_URL}/converter/callback`;
    if (!converterUrl || !secret) {
      return {
        status: "timeout",
        cause:
          "CONVERTER_URL / CONVERTER_CALLBACK_SECRET not configured on deployment",
      };
    }

    const timeoutMs = Number(
      process.env.CONVERTER_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS
    );

    const dispatchAll = async () => {
      for (const doc of docs) {
        if (doc.status === "converted") continue;
        await dispatchDoc(doc, converterUrl, callbackUrl, secret);
        await ctx.runMutation(
          internal.pipeline.ingestion.markSourceDocConverting,
          { sourceDocId: doc._id }
        );
      }
    };

    try {
      await dispatchAll();
    } catch (error) {
      return {
        status: "timeout",
        cause: `dispatch failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    const startedAt = Date.now();
    let redispatched = false;
    while (Date.now() - startedAt < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      const current = await ctx.runQuery(
        internal.pipeline.ingestion.listSourceDocsForRun,
        { runId: args.runId }
      );
      if (current.every((d) => d.status === "converted")) {
        return { status: "converted" };
      }
      if (!redispatched && Date.now() - startedAt > timeoutMs / 2) {
        redispatched = true;
        console.log(
          `[pipeline] run ${args.runId}: re-dispatching unconverted docs (bounded retry)`
        );
        try {
          await dispatchAll();
        } catch (error) {
          console.error(
            `[pipeline] run ${args.runId}: re-dispatch failed`,
            error
          );
        }
      }
    }

    const unconverted = (
      await ctx.runQuery(internal.pipeline.ingestion.listSourceDocsForRun, {
        runId: args.runId,
      })
    ).filter((d) => d.status !== "converted");
    return {
      status: "timeout",
      cause: `no conversion callback within ${timeoutMs}ms for ${unconverted.length} doc(s)`,
    };
  },
});
