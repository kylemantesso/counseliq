import { v } from "convex/values";
import { MEDIA_ASSET_KINDS } from "@counseliq/course-schema";
import { internalMutation, internalQuery } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { AppErrorCode, appError } from "../errors";

/**
 * The institution media catalogue's data layer (M6). The single most
 * important export is `isAssetCleared` — THE definition of "usable asset".
 * The compiler's catalogue filter, the gate-2 swap picker, and the admin
 * library badge all import this one predicate, which is what makes
 * "no unknown-rights asset can appear in any course" a mechanical
 * guarantee rather than a convention.
 */

/** Catalogue rows are media kinds only; bookkeeping rows never surface. */
export function isCatalogueAsset(asset: Doc<"assets">): boolean {
  return (MEDIA_ASSET_KINDS as readonly string[]).includes(asset.kind);
}

/**
 * Usable = rights explicitly declared by an operator AND, when the asset
 * shows identifiable people, consent explicitly confirmed. `unknown` (the
 * ingestion default) is never usable.
 */
export function isAssetCleared(
  asset: Pick<
    Doc<"assets">,
    "rights" | "identifiablePeople" | "peopleConsentConfirmed"
  >
): boolean {
  const rightsCleared =
    asset.rights === "institution_owned" || asset.rights === "licensed";
  const peopleCleared =
    asset.identifiablePeople !== true || asset.peopleConsentConfirmed === true;
  return rightsCleared && peopleCleared;
}

/** Current tag stamp — an asset is "untagged" when its stamp mismatches. */
export function isTaggedWith(
  asset: Doc<"assets">,
  promptVersion: string,
  model: string
): boolean {
  return (
    asset.taggedAt !== undefined &&
    asset.tagPromptVersion === promptVersion &&
    asset.tagModel === model
  );
}

/** Catalogue assets of an institution still needing the current tag pass. */
export const listUntaggedAssets = internalQuery({
  args: {
    institutionId: v.id("institutions"),
    promptVersion: v.string(),
    model: v.string(),
  },
  handler: async (ctx, args) => {
    const assets = await ctx.db
      .query("assets")
      .withIndex("by_institution", (q) =>
        q.eq("institutionId", args.institutionId)
      )
      .take(2000);
    return assets
      .filter(
        (asset) =>
          isCatalogueAsset(asset) &&
          !isTaggedWith(asset, args.promptVersion, args.model)
      )
      .map((asset) => ({ _id: asset._id }));
  },
});

/** One asset with everything the tagging action needs. */
export const getAssetForTagging = internalQuery({
  args: { assetId: v.id("assets") },
  handler: async (ctx, args) => {
    const asset = await ctx.db.get(args.assetId);
    if (!asset) appError(AppErrorCode.ASSET_NOT_FOUND);
    return asset;
  },
});

/**
 * The ONLY write path for tag output. Code floors live here, not in the
 * prompt: `rights` is untouchable (not even an arg), and the model can
 * raise `identifiablePeople` but never lower a true — only the admin
 * mutation (with a human behind it) can do that.
 */
export const saveAssetTags = internalMutation({
  args: {
    assetId: v.id("assets"),
    caption: v.string(),
    tags: v.array(v.string()),
    subjects: v.array(v.string()),
    setting: v.optional(v.string()),
    textInImage: v.optional(v.string()),
    qualityScore: v.number(),
    identifiablePeople: v.boolean(),
    suggestedUses: v.array(v.string()),
    tagPromptVersion: v.string(),
    tagModel: v.string(),
    taggedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const asset = await ctx.db.get(args.assetId);
    if (!asset) appError(AppErrorCode.ASSET_NOT_FOUND);
    await ctx.db.patch(args.assetId, {
      caption: args.caption,
      tags: args.tags,
      subjects: args.subjects,
      setting: args.setting,
      textInImage: args.textInImage,
      qualityScore: args.qualityScore,
      // Ratchet: true stays true regardless of what the model said.
      identifiablePeople:
        asset.identifiablePeople === true ? true : args.identifiablePeople,
      suggestedUses: args.suggestedUses,
      tagPromptVersion: args.tagPromptVersion,
      tagModel: args.tagModel,
      taggedAt: args.taggedAt,
    });
    return null;
  },
});
