import { z } from "zod";

/**
 * Ingestion contract — shared between the converter service
 * (services/converter, which emits the manifest) and the Convex callback
 * (convex/http.ts, which validates it before writing slides/assets).
 * Both sides import THIS module; the schema is the contract and neither
 * side may drift from it.
 */

/**
 * Every artifact in the object store is content-addressed:
 * `sha256/<64-hex-digest>.<ext>`.
 */
export const OBJECT_KEY_PATTERN = /^sha256\/[0-9a-f]{64}\.[a-z0-9]+$/;

export const contentAddressedKeySchema = z
  .string()
  .regex(
    OBJECT_KEY_PATTERN,
    "object key must be content-addressed: sha256/<64-hex>.<ext>"
  );

const sha256HexSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, "must be a lowercase sha256 hex digest");

export const embeddedImageSchema = z
  .object({
    key: contentAddressedKeySchema,
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    /** Thumbnail key (M6+ converters emit it; absent on older manifests). */
    thumbKey: contentAddressedKeySchema.optional(),
  })
  .strict();

export const manifestPageSchema = z
  .object({
    /** 1-based page/slide number. */
    n: z.number().int().positive(),
    pngKey: contentAddressedKeySchema,
    thumbKey: contentAddressedKeySchema,
    /** Extracted text for the page (empty string when none). */
    text: z.string(),
    /** Speaker notes (empty string for pdf-native docs / slides without notes). */
    notes: z.string(),
    embeddedImages: z.array(embeddedImageSchema),
  })
  .strict();

export const conversionManifestSchema = z
  .object({
    /** sha256 of the source document bytes. */
    sourceDocHash: sha256HexSchema,
    pageCount: z.number().int().positive(),
    pages: z.array(manifestPageSchema),
  })
  .strict()
  .superRefine((manifest, ctx) => {
    if (manifest.pages.length !== manifest.pageCount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pageCount"],
        message: `pageCount ${manifest.pageCount} does not match pages length ${manifest.pages.length}`,
      });
    }
    const seen = new Set<number>();
    for (const [i, page] of manifest.pages.entries()) {
      if (seen.has(page.n)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["pages", i, "n"],
          message: `duplicate page number ${page.n}`,
        });
      }
      seen.add(page.n);
      if (page.n > manifest.pageCount) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["pages", i, "n"],
          message: `page number ${page.n} exceeds pageCount ${manifest.pageCount}`,
        });
      }
    }
  });

/** Source document kinds the converter accepts. */
export const sourceDocKindSchema = z.enum(["pptx", "pdf"]);

/** Body of POST /convert on the converter service. */
export const convertRequestSchema = z
  .object({
    jobId: z.string().min(1),
    sourceKey: contentAddressedKeySchema,
    kind: sourceDocKindSchema,
    callbackUrl: z.string().url(),
  })
  .strict();

/** Body the converter POSTs back to the Convex callback URL. */
export const conversionCallbackSchema = z
  .object({
    jobId: z.string().min(1),
    manifest: conversionManifestSchema,
  })
  .strict();

// ---------------------------------------------------------------------------
// Asset ingestion (M6) — POST /ingest-assets on the converter service
// ---------------------------------------------------------------------------

/** One already-uploaded file to process (zips are expanded server-side). */
export const assetIngestFileSchema = z
  .object({
    sourceKey: contentAddressedKeySchema,
    /** Display name; zip entries arrive namespaced "pack.zip/inner/file.jpg". */
    originalName: z.string().min(1),
  })
  .strict();

/** Body of POST /ingest-assets on the converter service. */
export const assetIngestRequestSchema = z
  .object({
    jobId: z.string().min(1),
    files: z.array(assetIngestFileSchema).min(1),
    callbackUrl: z.string().url(),
  })
  .strict();

/**
 * Per-file processing outcome. Every input file (or zip entry) yields
 * exactly one entry; rejections carry an operator-readable reason (over
 * caps, unsupported format, undecodable).
 */
export const assetManifestEntrySchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("accepted"),
      sourceKey: contentAddressedKeySchema,
      originalName: z.string().min(1),
      kind: z.enum(["image", "video"]),
      /** The normalised/transcoded artifact (video: muted H.264 MP4). */
      objectKey: contentAddressedKeySchema,
      /** Thumbnail for images; poster frame for video. */
      thumbKey: contentAddressedKeySchema,
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      /** Video only. */
      durationMs: z.number().int().positive().optional(),
    })
    .strict(),
  z
    .object({
      status: z.literal("rejected"),
      sourceKey: contentAddressedKeySchema,
      originalName: z.string().min(1),
      reason: z.string().min(1),
    })
    .strict(),
]);

export const assetIngestManifestSchema = z
  .object({
    files: z.array(assetManifestEntrySchema),
  })
  .strict();

/** Body the converter POSTs back to the asset-ingest callback URL. */
export const assetIngestCallbackSchema = z
  .object({
    jobId: z.string().min(1),
    manifest: assetIngestManifestSchema,
  })
  .strict();

// ---------------------------------------------------------------------------
// Retroactive PDF embedded-image extraction (M6) — POST /extract-pdf-images
// ---------------------------------------------------------------------------

/** Body of POST /extract-pdf-images (re-runs extraction on a stored pdf). */
export const pdfImageExtractRequestSchema = z
  .object({
    jobId: z.string().min(1),
    sourceKey: contentAddressedKeySchema,
    callbackUrl: z.string().url(),
  })
  .strict();

export const pdfExtractedImageSchema = z
  .object({
    /** 1-based page numbers the image appears on (post-dedupe). */
    pageNs: z.array(z.number().int().positive()).min(1),
    key: contentAddressedKeySchema,
    thumbKey: contentAddressedKeySchema,
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .strict();

export const pdfImageManifestSchema = z
  .object({
    /** sha256 of the source pdf bytes. */
    sourceDocHash: z
      .string()
      .regex(/^[0-9a-f]{64}$/, "must be a lowercase sha256 hex digest"),
    images: z.array(pdfExtractedImageSchema),
    /** Repeat images (≥ threshold distinct pages) routed to theme logo candidates. */
    logoCandidates: z.array(contentAddressedKeySchema),
  })
  .strict();

export const pdfImagesCallbackSchema = z
  .object({
    jobId: z.string().min(1),
    manifest: pdfImageManifestSchema,
  })
  .strict();

export type EmbeddedImage = z.infer<typeof embeddedImageSchema>;
export type ManifestPage = z.infer<typeof manifestPageSchema>;
export type ConversionManifest = z.infer<typeof conversionManifestSchema>;
export type SourceDocKind = z.infer<typeof sourceDocKindSchema>;
export type ConvertRequest = z.infer<typeof convertRequestSchema>;
export type ConversionCallback = z.infer<typeof conversionCallbackSchema>;
export type AssetIngestFile = z.infer<typeof assetIngestFileSchema>;
export type AssetIngestRequest = z.infer<typeof assetIngestRequestSchema>;
export type AssetManifestEntry = z.infer<typeof assetManifestEntrySchema>;
export type AssetIngestManifest = z.infer<typeof assetIngestManifestSchema>;
export type AssetIngestCallback = z.infer<typeof assetIngestCallbackSchema>;
export type PdfImageExtractRequest = z.infer<typeof pdfImageExtractRequestSchema>;
export type PdfExtractedImage = z.infer<typeof pdfExtractedImageSchema>;
export type PdfImageManifest = z.infer<typeof pdfImageManifestSchema>;
export type PdfImagesCallback = z.infer<typeof pdfImagesCallbackSchema>;
