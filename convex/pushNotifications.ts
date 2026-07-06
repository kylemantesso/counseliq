import { internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getUserForIdentity } from "./auth";
import { AppErrorCode, appError } from "./errors";

const pushPlatformValidator = v.union(v.literal("ios"), v.literal("android"));

/**
 * Upsert an Expo push token for the signed-in user. Re-assigns the token if
 * another user previously registered the same device.
 */
export const registerToken = mutation({
  args: {
    token: v.string(),
    platform: pushPlatformValidator,
  },
  handler: async (ctx, args) => {
    const user = await getUserForIdentity(ctx);
    if (!user) {
      appError(AppErrorCode.UNAUTHORIZED);
    }

    const trimmed = args.token.trim();
    if (!trimmed) {
      appError(AppErrorCode.PUSH_TOKEN_INVALID);
    }

    const existingByToken = await ctx.db
      .query("pushTokens")
      .withIndex("by_token", (q) => q.eq("token", trimmed))
      .first();

    const now = Date.now();

    if (existingByToken) {
      await ctx.db.patch(existingByToken._id, {
        userId: user._id,
        platform: args.platform,
        updatedAt: now,
      });
      return { registered: true as const };
    }

    const existingForUser = await ctx.db
      .query("pushTokens")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    const samePlatform = existingForUser.find(
      (row) => row.platform === args.platform
    );
    if (samePlatform) {
      await ctx.db.patch(samePlatform._id, {
        token: trimmed,
        updatedAt: now,
      });
      return { registered: true as const };
    }

    await ctx.db.insert("pushTokens", {
      userId: user._id,
      token: trimmed,
      platform: args.platform,
      updatedAt: now,
    });

    return { registered: true as const };
  },
});

/** Whether the caller has at least one registered push token. */
export const getRegistrationStatus = query({
  args: {},
  handler: async (ctx) => {
    const user = await getUserForIdentity(ctx);
    if (!user) {
      return { registered: false as const };
    }

    const token = await ctx.db
      .query("pushTokens")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();

    return { registered: token !== null };
  },
});

/** Registered Expo push tokens for a user — used by send actions. */
export const listTokensForUser = internalQuery({
  args: {
    userId: v.id("users"),
  },
  returns: v.array(
    v.object({
      token: v.string(),
      platform: pushPlatformValidator,
    })
  ),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("pushTokens")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    return rows.map((row) => ({
      token: row.token,
      platform: row.platform,
    }));
  },
});
