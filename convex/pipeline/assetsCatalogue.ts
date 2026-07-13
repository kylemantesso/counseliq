import { v } from "convex/values";
import {
  MEDIA_ASSET_KINDS,
  type CompactCatalogueAsset,
} from "@counseliq/course-schema";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { requireAdmin } from "../admin";
import {
  assetFitsTemplate,
  validateAssetRefs,
  validateMediaPacing,
  BACKGROUND_MEDIA_TEMPLATES,
  MEDIA_CARD_TEMPLATES,
  type CatalogueAssetInfo,
} from "./compiler/rules";
import { getCourseRowsForRun } from "./courses";
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

/** Null means the legacy institution-wide catalogue; a Set is explicit selection. */
export async function getExplicitRunAssetIds(
  ctx: QueryCtx | MutationCtx,
  run: Doc<"runs">
): Promise<Set<Id<"assets">> | null> {
  if (run.hasExplicitAssetSelection !== true) return null;
  const rows = await ctx.db
    .query("runAssetSelections")
    .withIndex("by_run", (q) => q.eq("runId", run._id))
    .take(2000);
  return new Set(rows.map((row) => row.assetId));
}

/** Explicit runs load selected rows directly; legacy runs use the institution catalogue. */
export async function getRunCatalogueAssets(
  ctx: QueryCtx | MutationCtx,
  run: Doc<"runs">
): Promise<Doc<"assets">[]> {
  const explicitAssetIds = await getExplicitRunAssetIds(ctx, run);
  if (explicitAssetIds === null) {
    return await ctx.db
      .query("assets")
      .withIndex("by_institution", (q) =>
        q.eq("institutionId", run.institutionId)
      )
      .take(2000);
  }

  const assets = await Promise.all(
    [...explicitAssetIds].map((assetId) => ctx.db.get(assetId))
  );
  return assets.filter(
    (asset): asset is Doc<"assets"> =>
      asset !== null && asset.institutionId === run.institutionId
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
// Compiler-facing catalogue (M6 asset-aware compilation)
// ---------------------------------------------------------------------------

/** Prompt-size cap: the compact catalogue never exceeds this many assets. */
export const CATALOGUE_PROMPT_CAP = 150;

/** Deck page number from a `doc:{id}:page:{n}` provenance id. */
export function deckPageFromProvenance(
  sourceProvenance: string | undefined
): number | undefined {
  const match = sourceProvenance?.match(/:page:(\d+)$/);
  return match ? Number(match[1]) : undefined;
}

/** Compact prompt form of one CLEARED, TAGGED asset. Pure. */
export function toCompactCatalogueAsset(
  asset: Doc<"assets">
): CompactCatalogueAsset | null {
  if (
    asset.caption === undefined ||
    asset.aspect === undefined ||
    (asset.kind !== "image" && asset.kind !== "video")
  ) {
    return null;
  }
  const deckPage = deckPageFromProvenance(asset.sourceProvenance);
  return {
    id: asset._id,
    kind: asset.kind,
    caption: asset.caption,
    tags: asset.tags ?? [],
    aspect: asset.aspect as CompactCatalogueAsset["aspect"],
    ...(asset.durationMs !== undefined ? { durationMs: asset.durationMs } : {}),
    suggestedUses:
      (asset.suggestedUses as CompactCatalogueAsset["suggestedUses"]) ?? [],
    ...(deckPage !== undefined ? { deckPage } : {}),
  };
}

/**
 * The cleared catalogue the authoring pass sees for a run's institution.
 * Filtered IN CODE to cleared + tagged assets — an unknown-rights asset id
 * can never reach the model. Deterministically ordered (quality desc, id)
 * and capped so re-compiles hash identically for an unchanged library.
 */
export const getClearedCatalogueForRun = internalQuery({
  args: { runId: v.id("runs") },
  handler: async (ctx, args): Promise<CompactCatalogueAsset[]> => {
    const run = await ctx.db.get(args.runId);
    if (!run) appError(AppErrorCode.RUN_NOT_FOUND);
    const assets = await getRunCatalogueAssets(ctx, run);
    const qualityById = new Map(
      assets.map((asset) => [String(asset._id), asset.qualityScore ?? 0])
    );
    return assets
      .filter(
        (asset) =>
          isCatalogueAsset(asset) &&
          isAssetCleared(asset)
      )
      .map(toCompactCatalogueAsset)
      .filter((entry): entry is CompactCatalogueAsset => entry !== null)
      .sort((a, b) => {
        const qa = qualityById.get(a.id) ?? 0;
        const qb = qualityById.get(b.id) ?? 0;
        return qb - qa || (a.id < b.id ? -1 : 1);
      })
      .slice(0, CATALOGUE_PROMPT_CAP);
  },
});

/** Captions for the assetRefs used in a compiled course (judge input). */
export const getAssetCaptions = internalQuery({
  args: { assetIds: v.array(v.string()) },
  handler: async (ctx, args): Promise<Record<string, string>> => {
    const out: Record<string, string> = {};
    for (const id of new Set(args.assetIds)) {
      const normalized = ctx.db.normalizeId("assets", id);
      if (!normalized) continue;
      const asset = await ctx.db.get(normalized);
      if (asset?.caption !== undefined) out[id] = asset.caption;
    }
    return out;
  },
});

// ---------------------------------------------------------------------------
// Script/eval support (internal — the admin page is the human path)
// ---------------------------------------------------------------------------

/**
 * Bulk rights declaration for scripts/eval. Same audited fields as the
 * admin mutation — declaredBy makes the automation visible ("eval:auto").
 */
export const declareAssetRightsInternal = internalMutation({
  args: {
    institutionId: v.id("institutions"),
    rights: v.union(v.literal("institution_owned"), v.literal("licensed")),
    declaredBy: v.string(),
  },
  handler: async (ctx, args) => {
    const assets = await ctx.db
      .query("assets")
      .withIndex("by_institution", (q) =>
        q.eq("institutionId", args.institutionId)
      )
      .take(2000);
    const declaredAt = Date.now();
    let declared = 0;
    for (const asset of assets) {
      if (!isCatalogueAsset(asset)) continue;
      await ctx.db.patch(asset._id, {
        rights: args.rights,
        rightsDeclaredBy: args.declaredBy,
        rightsDeclaredAt: declaredAt,
        // Fixture media shows no real people; automation may confirm.
        ...(asset.identifiablePeople === true
          ? { peopleConsentConfirmed: true, peopleConsentBy: args.declaredBy }
          : {}),
      });
      declared += 1;
    }
    return { declared };
  },
});

/** Tagging progress for scripts/eval polling. */
export const getTaggingStatusInternal = internalQuery({
  args: { institutionId: v.id("institutions") },
  handler: async (ctx, args) => {
    const assets = await ctx.db
      .query("assets")
      .withIndex("by_institution", (q) =>
        q.eq("institutionId", args.institutionId)
      )
      .take(2000);
    const catalogue = assets.filter(isCatalogueAsset);
    return {
      total: catalogue.length,
      tagged: catalogue.filter((asset) => asset.taggedAt !== undefined).length,
      cleared: catalogue.filter(isAssetCleared).length,
      videos: catalogue.filter((asset) => asset.kind === "video").length,
    };
  },
});

/**
 * Media compliance report for eval:compile — re-runs the SAME validators
 * the compiler enforced, against the live catalogue (cleared flags real,
 * so an unknown-rights ref shows up as a violation = leakage). Also the
 * source of the printed media stats.
 */
export const getRunMediaReport = internalQuery({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    const rows = await getCourseRowsForRun(ctx, args.runId);
    if (!rows) appError(AppErrorCode.COURSE_NOT_FOUND);
    const run = await ctx.db.get(args.runId);
    if (!run) appError(AppErrorCode.RUN_NOT_FOUND);

    const assets = await ctx.db
      .query("assets")
      .withIndex("by_institution", (q) =>
        q.eq("institutionId", run.institutionId)
      )
      .take(2000);
    const catalogueById = new Map<string, CatalogueAssetInfo>(
      assets.filter(isCatalogueAsset).map((asset) => [
        String(asset._id),
        {
          kind: asset.kind as "image" | "video",
          ...(asset.aspect !== undefined ? { aspect: asset.aspect } : {}),
          cleared: isAssetCleared(asset),
        },
      ])
    );
    const availability = {
      images: [...catalogueById.values()].filter(
        (a) => a.cleared && a.kind === "image"
      ).length,
      videos: [...catalogueById.values()].filter(
        (a) => a.cleared && a.kind === "video"
      ).length,
    };

    const distinctAssets = new Set<string>();
    let mediaCards = 0;
    let videoCards = 0;
    const units: Array<{
      unitKey: string;
      refViolations: string[];
      pacingViolations: string[];
      mediaCardCount: number;
    }> = [];
    for (const unit of rows.units) {
      const cards = (unit.cards ?? []) as Array<{
        template: string;
        props: Record<string, unknown>;
      }>;
      const meta = unit.meta as
        | { anchor?: { template: string; props: Record<string, unknown> } }
        | undefined;
      const withAnchor = meta?.anchor ? [...cards, meta.anchor] : cards;
      for (const card of withAnchor) {
        const refs = [card.props.assetRef, card.props.bgAssetRef].filter(
          (value): value is string => typeof value === "string"
        );
        for (const ref of refs) distinctAssets.add(ref);
        const isMedia =
          (MEDIA_CARD_TEMPLATES.includes(card.template) &&
            typeof card.props.assetRef === "string") ||
          (BACKGROUND_MEDIA_TEMPLATES.includes(card.template) &&
            typeof card.props.bgAssetRef === "string");
        if (isMedia) {
          mediaCards += 1;
          if (card.template === "video-card") videoCards += 1;
        }
      }
      units.push({
        unitKey: unit.unitKey,
        refViolations: validateAssetRefs(withAnchor, catalogueById),
        pacingViolations: validateMediaPacing(cards, availability),
        mediaCardCount: cards.filter(
          (card) =>
            (MEDIA_CARD_TEMPLATES.includes(card.template) &&
              typeof card.props.assetRef === "string") ||
            (BACKGROUND_MEDIA_TEMPLATES.includes(card.template) &&
              typeof card.props.bgAssetRef === "string")
        ).length,
      });
    }
    return { availability, units, mediaCards, videoCards, distinctAssets: distinctAssets.size };
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
    return institutions.map((inst) => ({
      _id: inst._id,
      _creationTime: inst._creationTime,
      name: inst.name,
      market: inst.market,
      brandTokens: inst.brandTokens,
      websiteUrl: inst.websiteUrl ?? null,
    }));
  },
});

function normalizeInstitutionName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

function normalizedMatch(name: string): string {
  return normalizeInstitutionName(name).toLowerCase();
}

export function normalizeWebsiteUrl(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;
  const withProtocol = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    const parsed = new URL(withProtocol);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

export const adminCreateInstitution = mutation({
  args: {
    name: v.string(),
    market: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const name = normalizeInstitutionName(args.name);
    if (!name) {
      appError(AppErrorCode.INSTITUTION_NAME_REQUIRED);
    }

    const existing = await ctx.db.query("institutions").take(400);
    const duplicate = existing.find(
      (institution) => normalizedMatch(institution.name) === normalizedMatch(name)
    );
    if (duplicate) {
      appError(AppErrorCode.INSTITUTION_ALREADY_EXISTS);
    }

    const institutionId = await ctx.db.insert("institutions", {
      name,
      brandTokens: {
        primaryColor: "#1a365d",
        secondaryColor: "#c53030",
        titleFontFamily: "system-ui",
        bodyFontFamily: "system-ui",
      },
      pronunciationLexicon: { placeholder: true },
      market: args.market?.trim() || "AU",
      websiteUrl: null,
    });

    return { institutionId };
  },
});

export const adminUpdateInstitution = mutation({
  args: {
    institutionId: v.id("institutions"),
    name: v.string(),
    market: v.optional(v.string()),
    brandTokens: v.optional(v.any()),
    websiteUrl: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const institution = await ctx.db.get(args.institutionId);
    if (!institution) {
      appError(AppErrorCode.INSTITUTION_NOT_FOUND);
    }

    const name = normalizeInstitutionName(args.name);
    if (!name) {
      appError(AppErrorCode.INSTITUTION_NAME_REQUIRED);
    }

    const existing = await ctx.db.query("institutions").take(400);
    const duplicate = existing.find(
      (row) =>
        row._id !== args.institutionId &&
        normalizedMatch(row.name) === normalizedMatch(name)
    );
    if (duplicate) {
      appError(AppErrorCode.INSTITUTION_ALREADY_EXISTS);
    }

    const normalizedWebsiteUrl =
      args.websiteUrl === undefined
        ? undefined
        : args.websiteUrl === null
          ? null
          : normalizeWebsiteUrl(args.websiteUrl);
    if (args.websiteUrl !== undefined && args.websiteUrl !== null && !normalizedWebsiteUrl) {
      appError(AppErrorCode.INSTITUTION_WEBSITE_URL_INVALID);
    }

    await ctx.db.patch(args.institutionId, {
      name,
      ...(args.market ? { market: args.market.trim() || institution.market } : {}),
      ...(args.brandTokens !== undefined ? { brandTokens: args.brandTokens } : {}),
      ...(normalizedWebsiteUrl !== undefined
        ? { websiteUrl: normalizedWebsiteUrl }
        : {}),
    });

    return { institutionId: args.institutionId };
  },
});

export const adminGenerateInstitutionLogoUploadUrl = mutation({
  args: {
    institutionId: v.id("institutions"),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const institution = await ctx.db.get(args.institutionId);
    if (!institution) {
      appError(AppErrorCode.INSTITUTION_NOT_FOUND);
    }
    return { uploadUrl: await ctx.storage.generateUploadUrl() };
  },
});

export const adminResolveInstitutionLogoStorageUrl = mutation({
  args: {
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const logoUrl = await ctx.storage.getUrl(args.storageId);
    if (!logoUrl) {
      appError(AppErrorCode.INSTITUTION_LOGO_NOT_FOUND);
    }
    return { logoUrl, logoStorageId: args.storageId };
  },
});

export const getInstitutionThemeExtractionContext = internalQuery({
  args: {
    institutionId: v.id("institutions"),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const institution = await ctx.db.get(args.institutionId);
    if (!institution) {
      appError(AppErrorCode.INSTITUTION_NOT_FOUND);
    }
    return {
      institutionId: institution._id,
      name: institution.name,
      websiteUrl: institution.websiteUrl ?? null,
    };
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

/** Effective media selection and rights status for one run. */
export const adminGetRunMediaSelection = query({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const run = await ctx.db.get(args.runId);
    if (!run) appError(AppErrorCode.RUN_NOT_FOUND);

    const catalogueAssets = await getRunCatalogueAssets(ctx, run);
    const assets = catalogueAssets
      .filter(isCatalogueAsset)
      .map((asset) => {
        const cleared = isAssetCleared(asset);
        return {
          _id: asset._id,
          kind: asset.kind,
          caption: asset.caption ?? null,
          thumbKey:
            asset.thumbKey ?? (asset.kind === "image" ? asset.objectKey : null),
          rights: asset.rights ?? "unknown",
          identifiablePeople: asset.identifiablePeople ?? false,
          peopleConsentConfirmed: asset.peopleConsentConfirmed ?? false,
          tagged: asset.taggedAt !== undefined,
          cleared,
          needsRights: !cleared,
        };
      });
    const cleared = assets.filter((asset) => asset.cleared).length;

    return {
      runId: run._id,
      institutionId: run.institutionId,
      explicitSelection: run.hasExplicitAssetSelection === true,
      counts: {
        selected: assets.length,
        cleared,
        needsRights: assets.length - cleared,
      },
      assets,
    };
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

/**
 * Cleared assets that could replace the asset on a media card of the
 * given template (gate-2/3 swap picker). Same predicates as the compiler
 * filter and the swap mutation — the picker can never offer an asset the
 * swap would reject.
 */
export const adminListSwappableAssets = query({
  args: { runId: v.id("runs"), template: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const run = await ctx.db.get(args.runId);
    if (!run) appError(AppErrorCode.RUN_NOT_FOUND);
    const assets = await getRunCatalogueAssets(ctx, run);
    return assets
      .filter(
        (asset) =>
          isCatalogueAsset(asset) &&
          isAssetCleared(asset) &&
          assetFitsTemplate(args.template, {
            kind: asset.kind as "image" | "video",
            ...(asset.aspect !== undefined ? { aspect: asset.aspect } : {}),
          }) === null
      )
      .map((asset) => ({
        _id: asset._id,
        kind: asset.kind,
        aspect: asset.aspect,
        caption: asset.caption,
        thumbKey: asset.thumbKey ?? (asset.kind === "image" ? asset.objectKey : undefined),
        durationMs: asset.durationMs,
      }));
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

/**
 * Consent confirmation for assets showing identifiable people (single or
 * bulk). Only assets actually flagged `identifiablePeople` are touched —
 * confirming a mixed selection quietly skips the rest, so "select all →
 * confirm consent" is safe.
 */
export const adminConfirmPeopleConsent = mutation({
  args: { assetIds: v.array(v.id("assets")), confirmed: v.boolean() },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    let updated = 0;
    for (const assetId of args.assetIds) {
      const asset = await ctx.db.get(assetId);
      if (!asset || !isCatalogueAsset(asset)) {
        appError(AppErrorCode.ASSET_NOT_FOUND);
      }
      if (asset.identifiablePeople !== true) continue;
      await ctx.db.patch(assetId, {
        peopleConsentConfirmed: args.confirmed,
        peopleConsentBy: admin.email,
      });
      updated += 1;
    }
    return { updated };
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
