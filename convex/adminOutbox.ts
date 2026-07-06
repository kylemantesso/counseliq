import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

export const adminTestEnqueueResultValidator = v.object({
  deliveryId: v.id("notificationDeliveries"),
  status: v.literal("pending"),
});

/** Enqueue an admin test delivery — bypasses user notification preferences. */
export const enqueueTestDelivery = internalMutation({
  args: {
    userId: v.id("users"),
    channel: v.union(v.literal("email"), v.literal("push")),
    idempotencyKey: v.string(),
    payload: v.any(),
  },
  returns: adminTestEnqueueResultValidator,
  handler: async (ctx, args) => {
    const now = Date.now();
    const deliveryId = await ctx.db.insert("notificationDeliveries", {
      userId: args.userId,
      type: "admin_test",
      channel: args.channel,
      status: "pending",
      idempotencyKey: args.idempotencyKey,
      scheduledFor: now,
      payload: args.payload,
      attempts: 0,
      createdAt: now,
    });
    return { deliveryId, status: "pending" as const };
  },
});
