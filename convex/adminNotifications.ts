import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { getUserForIdentity } from "./auth";
import { requireAdmin } from "./admin";
import { isAdminUser } from "./adminAccess";
import { AppErrorCode, appError } from "./errors";

const tokenPreviewValidator = v.object({
  platform: v.union(v.literal("ios"), v.literal("android")),
  tokenPreview: v.string(),
  updatedAt: v.number(),
});

const testPageValidator = v.union(
  v.null(),
  v.object({
    userId: v.id("users"),
    email: v.string(),
    name: v.string(),
    tokens: v.array(tokenPreviewValidator),
  })
);

const sendResultValidator = v.object({
  deliveryId: v.id("notificationDeliveries"),
  status: v.literal("pending"),
});

/** Admin-only context for the notification test page. */
export const getNotificationTestPage = query({
  args: {},
  returns: testPageValidator,
  handler: async (ctx) => {
    const user = await getUserForIdentity(ctx);
    if (!user || !isAdminUser(user)) {
      return null;
    }

    const tokens = await ctx.db
      .query("pushTokens")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    return {
      userId: user._id,
      email: user.email,
      name: user.name,
      tokens: tokens.map((row) => ({
        platform: row.platform,
        tokenPreview: `${row.token.slice(0, 24)}…`,
        updatedAt: row.updatedAt,
      })),
    };
  },
});

/**
 * Queue a test push via the notification outbox. Defaults to the admin's own
 * devices; pass `targetEmail` to send to another user's registered devices.
 */
export const listRecentDeliveries = query({
  args: {},
  handler: async (ctx) => {
    const user = await getUserForIdentity(ctx);
    if (!user || !isAdminUser(user)) {
      return [];
    }

    return await ctx.db
      .query("notificationDeliveries")
      .order("desc")
      .take(50);
  },
});

export const sendTestPush = mutation({
  args: {
    title: v.optional(v.string()),
    body: v.optional(v.string()),
    url: v.optional(v.string()),
    targetEmail: v.optional(v.string()),
  },
  returns: sendResultValidator,
  handler: async (ctx, args): Promise<{
    deliveryId: Id<"notificationDeliveries">;
    status: "pending";
  }> => {
    const admin = await requireAdmin(ctx);
    const title = (args.title ?? "Test notification").trim();
    const body = (args.body ?? "This is a test push from App Template admin.").trim();

    if (!title || !body) {
      appError(AppErrorCode.PUSH_TOKEN_INVALID);
    }

    let targetUserId: Id<"users"> = admin._id;
    const targetEmail = args.targetEmail?.trim().toLowerCase();

    if (targetEmail) {
      const target = await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", targetEmail))
        .first();
      if (!target) {
        appError(AppErrorCode.USER_NOT_FOUND);
      }
      targetUserId = target._id;
    }

    const url = args.url?.trim();
    const now = Date.now();
    const result = await ctx.runMutation(internal.adminOutbox.enqueueTestDelivery, {
      userId: targetUserId,
      channel: "push",
      idempotencyKey: `admin_test:push:${targetUserId}:${now}`,
      payload: {
        pushTitle: title,
        pushBody: body,
        pushUrl: url && url.length > 0 ? url : undefined,
      },
    });

    await ctx.runMutation(internal.notificationOutbox.processPendingBatch, {});
    return result;
  },
});
