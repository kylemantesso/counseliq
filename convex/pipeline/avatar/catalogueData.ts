import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "../../_generated/server";
import { requireAdmin } from "../../admin";
import { AppErrorCode, appError } from "../../errors";

const groupValidator = v.object({
  id: v.string(), name: v.string(), previewImageUrl: v.union(v.string(), v.null()), looksCount: v.number(), status: v.union(v.string(), v.null()), consentStatus: v.union(v.string(), v.null()),
});
const lookValidator = v.object({
  groupId: v.string(), lookId: v.string(), name: v.string(), previewImageUrl: v.union(v.string(), v.null()), preferredOrientation: v.union(v.literal("portrait"), v.literal("landscape"), v.literal("square"), v.null()), supportedEngines: v.array(v.string()), tags: v.array(v.string()), avatarType: v.string(), status: v.union(v.string(), v.null()), sourceHash: v.string(),
});

export const upsertAvatarCatalog = internalMutation({
  args: { groups: v.array(groupValidator), looks: v.array(lookValidator) },
  handler: async (ctx, args) => {
    const now = Date.now();
    const providerGroupIds = new Set(args.groups.map((group) => group.id));
    const providerLookIds = new Set(args.looks.map((look) => look.lookId));
    const cachedGroups = await ctx.db.query("avatarGroups").take(500);
    const cachedLooks = await ctx.db.query("avatarLooks").take(1000);
    let removedGroups = 0;
    let removedLooks = 0;
    for (const look of cachedLooks) {
      if (look.provider === "heygen" && !providerLookIds.has(look.lookId)) {
        await ctx.db.delete(look._id);
        removedLooks += 1;
      }
    }
    for (const group of cachedGroups) {
      if (group.provider === "heygen" && !providerGroupIds.has(group.groupId)) {
        await ctx.db.delete(group._id);
        removedGroups += 1;
      }
    }
    for (const group of args.groups) {
      const existing = await ctx.db.query("avatarGroups").withIndex("by_provider_and_group", (q) => q.eq("provider", "heygen").eq("groupId", group.id)).first();
      const next = { provider: "heygen" as const, groupId: group.id, name: group.name, previewImageUrl: group.previewImageUrl, looksCount: group.looksCount, status: group.status, consentStatus: group.consentStatus, syncedAt: now };
      if (existing) await ctx.db.patch(existing._id, next); else await ctx.db.insert("avatarGroups", next);
    }
    const evaluateIds: string[] = [];
    for (const look of args.looks) {
      const existing = await ctx.db.query("avatarLooks").withIndex("by_provider_and_look", (q) => q.eq("provider", "heygen").eq("lookId", look.lookId)).first();
      const changed = !existing || existing.sourceHash !== look.sourceHash;
      const next = { provider: "heygen" as const, lookId: look.lookId, groupId: look.groupId, name: look.name, previewImageUrl: look.previewImageUrl, preferredOrientation: look.preferredOrientation, supportedEngines: look.supportedEngines, tags: look.tags, avatarType: look.avatarType, status: look.status, sourceHash: look.sourceHash, syncedAt: now, ...(changed ? { evaluation: undefined, evaluationPromptVersion: undefined, evaluationModel: undefined, evaluatedAt: undefined } : {}) };
      if (existing) await ctx.db.patch(existing._id, next); else await ctx.db.insert("avatarLooks", next);
      if (changed && look.previewImageUrl) evaluateIds.push(look.lookId);
    }
    return {
      groups: args.groups.length,
      looks: args.looks.length,
      removedGroups,
      removedLooks,
      evaluateIds,
    };
  },
});

export const getAvatarLookForEvaluation = internalQuery({
  args: { lookId: v.string() },
  handler: async (ctx, args) => await ctx.db.query("avatarLooks").withIndex("by_provider_and_look", (q) => q.eq("provider", "heygen").eq("lookId", args.lookId)).first(),
});

export const getAvatarLooksForGroup = internalQuery({
  args: { groupId: v.string() },
  handler: async (ctx, args) =>
    (
      await ctx.db
        .query("avatarLooks")
        .withIndex("by_provider_and_group", (q) =>
          q.eq("provider", "heygen").eq("groupId", args.groupId)
        )
        .take(100)
    ).map((look) => ({
      ...look,
      evaluation: look.evaluationOverrides ?? look.evaluation,
    })),
});

export const saveAvatarLookEvaluation = internalMutation({
  args: { lookId: v.string(), evaluation: v.object({ description: v.string(), setting: v.string(), attire: v.string(), framing: v.string(), tone: v.string(), suitableTopics: v.array(v.string()), visualTags: v.array(v.string()) }), promptVersion: v.string(), model: v.string() },
  handler: async (ctx, args) => {
    const look = await ctx.db.query("avatarLooks").withIndex("by_provider_and_look", (q) => q.eq("provider", "heygen").eq("lookId", args.lookId)).first();
    if (!look) appError(AppErrorCode.AVATAR_LOOK_INVALID);
    await ctx.db.patch(look._id, { evaluation: args.evaluation, evaluationPromptVersion: args.promptVersion, evaluationModel: args.model, evaluatedAt: Date.now() });
    return null;
  },
});

const evaluationValidator = v.object({
  description: v.string(),
  setting: v.string(),
  attire: v.string(),
  framing: v.string(),
  tone: v.string(),
  suitableTopics: v.array(v.string()),
  visualTags: v.array(v.string()),
});

export const adminUpdateAvatarLookEvaluation = mutation({
  args: {
    lookId: v.string(),
    evaluation: v.optional(evaluationValidator),
    reset: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const look = await ctx.db
      .query("avatarLooks")
      .withIndex("by_provider_and_look", (q) =>
        q.eq("provider", "heygen").eq("lookId", args.lookId)
      )
      .first();
    if (!look) appError(AppErrorCode.AVATAR_LOOK_INVALID);
    if (args.reset) {
      await ctx.db.patch(look._id, {
        evaluationOverrides: undefined,
        evaluationEditedAt: undefined,
        evaluationEditedBy: undefined,
      });
      return null;
    }
    if (!args.evaluation) appError(AppErrorCode.AVATAR_LOOK_INVALID);
    await ctx.db.patch(look._id, {
      evaluationOverrides: args.evaluation,
      evaluationEditedAt: Date.now(),
      evaluationEditedBy: admin.email,
    });
    return null;
  },
});

export const adminListAvatarCatalog = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const [groups, looks] = await Promise.all([ctx.db.query("avatarGroups").take(100), ctx.db.query("avatarLooks").take(500)]);
    return {
      groups,
      looks: looks.map((look) => ({
        ...look,
        aiEvaluation: look.evaluation,
        evaluation: look.evaluationOverrides ?? look.evaluation,
        manuallyEdited: look.evaluationOverrides !== undefined,
      })),
    };
  },
});
