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

export const candidateThemeSchema = z
  .object({
    /** Hex colors, e.g. "#1A2B3C", from the document theme. */
    colors: z.array(z.string().regex(/^#[0-9A-Fa-f]{6}$/)),
    /** Font family names from the document theme. */
    fonts: z.array(z.string().min(1)),
    /** Object keys of images that recur on masters / the first slide. */
    logoCandidates: z.array(contentAddressedKeySchema),
  })
  .strict();

export const conversionManifestSchema = z
  .object({
    /** sha256 of the source document bytes. */
    sourceDocHash: sha256HexSchema,
    pageCount: z.number().int().positive(),
    /** Candidate brand theme; null when none could be extracted (e.g. pdf). */
    theme: candidateThemeSchema.nullable(),
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

export type EmbeddedImage = z.infer<typeof embeddedImageSchema>;
export type ManifestPage = z.infer<typeof manifestPageSchema>;
export type CandidateTheme = z.infer<typeof candidateThemeSchema>;
export type ConversionManifest = z.infer<typeof conversionManifestSchema>;
export type SourceDocKind = z.infer<typeof sourceDocKindSchema>;
export type ConvertRequest = z.infer<typeof convertRequestSchema>;
export type ConversionCallback = z.infer<typeof conversionCallbackSchema>;
