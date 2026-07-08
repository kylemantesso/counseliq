import { z } from "zod";
import { contentAddressedKeySchema } from "./ingestion";

/**
 * Asset catalogue contract (M6) — the institution-scoped media library the
 * compiler weaves through courses. One record per catalogued image/video;
 * stored on the Convex `assets` table (catalogue rows are `kind` image |
 * video; conversion bookkeeping rows keep their own kinds and never enter
 * the library).
 *
 * The load-bearing invariant: `rights` is OPERATOR-DECLARED, never written
 * by any model, and defaults to `unknown` at ingestion. Only cleared assets
 * (rights declared + people-consent satisfied) are ever visible to the
 * compiler, the swap picker, or a course — enforcement lives in code
 * (`isAssetCleared` in convex/pipeline/assetsCatalogue.ts), not prompts.
 */

export const MEDIA_ASSET_KINDS = ["image", "video"] as const;
export const mediaAssetKindSchema = z.enum(MEDIA_ASSET_KINDS);

export const ASSET_RIGHTS = [
  "institution_owned",
  "licensed",
  "unknown",
] as const;
export const assetRightsSchema = z.enum(ASSET_RIGHTS);

export const ASSET_ORIGINS = ["deck_extracted", "uploaded"] as const;
export const assetOriginSchema = z.enum(ASSET_ORIGINS);

export const ASSET_SUGGESTED_USES = [
  "hero",
  "inline",
  "background",
  "document",
] as const;
export const assetSuggestedUseSchema = z.enum(ASSET_SUGGESTED_USES);

export const ASSET_ASPECTS = ["portrait", "landscape", "square"] as const;
export const assetAspectSchema = z.enum(ASSET_ASPECTS);

export type MediaAssetKind = z.infer<typeof mediaAssetKindSchema>;
export type AssetRights = z.infer<typeof assetRightsSchema>;
export type AssetOrigin = z.infer<typeof assetOriginSchema>;
export type AssetSuggestedUse = z.infer<typeof assetSuggestedUseSchema>;
export type AssetAspect = z.infer<typeof assetAspectSchema>;

/**
 * Categorical aspect from pixel dimensions. The ±15% band around square
 * keeps near-square crops out of the portrait/landscape buckets.
 */
export function deriveAspect(width: number, height: number): AssetAspect {
  const ratio = width / height;
  if (ratio > 1.15) return "landscape";
  if (ratio < 1 / 1.15) return "portrait";
  return "square";
}

export const assetRecordSchema = z
  .object({
    /** Catalogue id — the Convex assets._id string; cards reference it via `assetRef`. */
    id: z.string().min(1),
    kind: mediaAssetKindSchema,
    objectKey: contentAddressedKeySchema,
    /** Thumbnail for images; poster frame for video. */
    thumbKey: contentAddressedKeySchema,
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    aspect: assetAspectSchema,
    /** Video only. */
    durationMs: z.number().int().positive().optional(),
    caption: z.string(),
    tags: z.array(z.string()),
    subjects: z.array(z.string()),
    setting: z.string().optional(),
    textInImage: z.string().optional(),
    /** 0..1, from the tagging pass. */
    qualityScore: z.number().min(0).max(1),
    /** Conservative: any visible face ⇒ true. Model may raise, only a human lowers. */
    identifiablePeople: z.boolean(),
    suggestedUses: z.array(assetSuggestedUseSchema),
    /** OPERATOR-DECLARED; defaults `unknown` at ingestion. */
    rights: assetRightsSchema,
    rightsDeclaredBy: z.string().optional(),
    rightsDeclaredAt: z.number().optional(),
    origin: assetOriginSchema,
    /** deck_extracted: the page provenance id(s) the image appeared on. */
    provenance: z.string().optional(),
  })
  .strict();

export type AssetRecord = z.infer<typeof assetRecordSchema>;

/**
 * The compact per-asset form injected into the authoring prompt (and hashed
 * into the authoring cache key). Built ONLY from cleared assets — an
 * unknown-rights asset never reaches the model.
 */
export const compactCatalogueAssetSchema = z
  .object({
    id: z.string().min(1),
    kind: mediaAssetKindSchema,
    caption: z.string(),
    tags: z.array(z.string()),
    aspect: assetAspectSchema,
    durationMs: z.number().int().positive().optional(),
    suggestedUses: z.array(assetSuggestedUseSchema),
    /** Source deck page number for deck-extracted assets (provenance match). */
    deckPage: z.number().int().positive().optional(),
  })
  .strict();

export type CompactCatalogueAsset = z.infer<typeof compactCatalogueAssetSchema>;
