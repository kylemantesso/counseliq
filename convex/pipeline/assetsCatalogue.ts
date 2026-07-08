import { v } from "convex/values";
import { MEDIA_ASSET_KINDS } from "@counseliq/course-schema";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { requireAdmin } from "../admin";
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

// ---------------------------------------------------------------------------
// Admin library surface (the rights-declaration session happens here)
// ---------------------------------------------------------------------------

export const adminListInstitutions = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const institutions = await ctx.db.query("institutions").take(200);
    return institutions.map((inst) => ({ _id: inst._id, name: inst.name }));
  },
});

/** The institution's media catalogue with the usable verdict precomputed. */
export const adminListAssets = query({
  args: { institutionId: v.id("institutions") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const assets = await ctx.db
      .query("assets")
      .withIndex("by_institution", (q) =>
        q.eq("institutionId", args.institutionId)
      )
      .order("desc")
      .take(2000);
    return assets
      .filter(isCatalogueAsset)
      .map((asset) => ({ ...asset, cleared: isAssetCleared(asset) }));
  },
});

/** Recent upload jobs for the institution (progress + rejection reasons). */
export const adminListIngestJobs = query({
  args: { institutionId: v.id("institutions") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    return await ctx.db
      .query("assetIngestJobs")
      .withIndex("by_institution", (q) =>
        q.eq("institutionId", args.institutionId)
      )
      .order("desc")
      .take(20);
  },
});

export const adminUpdateAssetMeta = mutation({
  args: {
    assetId: v.id("assets"),
    caption: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const asset = await ctx.db.get(args.assetId);
    if (!asset || !isCatalogueAsset(asset)) {
      appError(AppErrorCode.ASSET_NOT_FOUND);
    }
    await ctx.db.patch(args.assetId, {
      ...(args.caption !== undefined ? { caption: args.caption } : {}),
      ...(args.tags !== undefined ? { tags: args.tags } : {}),
    });
    return null;
  },
});

/**
 * THE rights declaration path (single or bulk) — the only way any asset
 * ever leaves "unknown". Stamped with the declaring admin and time.
 */
export const adminDeclareAssetRights = mutation({
  args: {
    assetIds: v.array(v.id("assets")),
    rights: v.union(
      v.literal("institution_owned"),
      v.literal("licensed"),
      v.literal("unknown")
    ),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const declaredAt = Date.now();
    for (const assetId of args.assetIds) {
      const asset = await ctx.db.get(assetId);
      if (!asset || !isCatalogueAsset(asset)) {
        appError(AppErrorCode.ASSET_NOT_FOUND);
      }
      await ctx.db.patch(assetId, {
        rights: args.rights,
        rightsDeclaredBy: admin.email,
        rightsDeclaredAt: declaredAt,
      });
    }
    return null;
  },
});

/** Consent confirmation for assets showing identifiable people. */
export const adminConfirmPeopleConsent = mutation({
  args: { assetId: v.id("assets"), confirmed: v.boolean() },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const asset = await ctx.db.get(args.assetId);
    if (!asset || !isCatalogueAsset(asset)) {
      appError(AppErrorCode.ASSET_NOT_FOUND);
    }
    await ctx.db.patch(args.assetId, {
      peopleConsentConfirmed: args.confirmed,
      peopleConsentBy: admin.email,
    });
    return null;
  },
});

/**
 * Human-only override of the identifiablePeople flag. This is the ONLY
 * path that can lower it — the tagging pass ratchets upward only.
 */
export const adminSetIdentifiablePeople = mutation({
  args: { assetId: v.id("assets"), value: v.boolean() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const asset = await ctx.db.get(args.assetId);
    if (!asset || !isCatalogueAsset(asset)) {
      appError(AppErrorCode.ASSET_NOT_FOUND);
    }
    await ctx.db.patch(args.assetId, { identifiablePeople: args.value });
    return null;
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
