import { internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { getUserForIdentity } from "./auth";
import { AppErrorCode, appError } from "./errors";

export type ResolvedNotificationPreferences = {
  emailEnabled: boolean;
  pushEnabled: boolean;
};

const preferencesValidator = v.object({
  emailEnabled: v.boolean(),
  pushEnabled: v.boolean(),
});

export async function resolveNotificationPreferences(
  ctx: QueryCtx,
  userId: Id<"users">
): Promise<ResolvedNotificationPreferences> {
  const row = await ctx.db
    .query("notificationPreferences")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .first();

  return {
    emailEnabled: row?.emailEnabled ?? true,
    pushEnabled: row?.pushEnabled ?? true,
  };
}

export const getMyPreferences = query({
  args: {},
  returns: preferencesValidator,
  handler: async (ctx) => {
    const user = await getUserForIdentity(ctx);
    if (!user) {
      appError(AppErrorCode.UNAUTHORIZED);
    }
    return await resolveNotificationPreferences(ctx, user._id);
  },
});

export const updateMyPreferences = mutation({
  args: {
    emailEnabled: v.boolean(),
    pushEnabled: v.boolean(),
  },
  returns: preferencesValidator,
  handler: async (ctx, args) => {
    const user = await getUserForIdentity(ctx);
    if (!user) {
      appError(AppErrorCode.UNAUTHORIZED);
    }

    const now = Date.now();
    const existing = await ctx.db
      .query("notificationPreferences")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        emailEnabled: args.emailEnabled,
        pushEnabled: args.pushEnabled,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("notificationPreferences", {
        userId: user._id,
        emailEnabled: args.emailEnabled,
        pushEnabled: args.pushEnabled,
        updatedAt: now,
      });
    }

    return {
      emailEnabled: args.emailEnabled,
      pushEnabled: args.pushEnabled,
    };
  },
});

export const getPreferencesForUser = internalQuery({
  args: { userId: v.id("users") },
  returns: preferencesValidator,
  handler: async (ctx, args) => {
    return await resolveNotificationPreferences(ctx, args.userId);
  },
});

export async function userHasPushTokens(
  ctx: QueryCtx,
  userId: Id<"users">
): Promise<boolean> {
  const token = await ctx.db
    .query("pushTokens")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .first();
  return token !== null;
}

export async function userHasEmail(
  ctx: QueryCtx,
  user: Pick<Doc<"users">, "email">
): Promise<boolean> {
  return user.email.trim().length > 0;
}
