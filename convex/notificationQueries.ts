import { internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { notificationTypeValidator } from "./schema";

export const deliveryRowValidator = v.object({
  _id: v.id("notificationDeliveries"),
  userId: v.id("users"),
  type: notificationTypeValidator,
  channel: v.union(v.literal("email"), v.literal("push")),
  status: v.union(
    v.literal("pending"),
    v.literal("processing"),
    v.literal("sent"),
    v.literal("failed"),
    v.literal("skipped")
  ),
  idempotencyKey: v.string(),
  scheduledFor: v.number(),
  payload: v.any(),
  attempts: v.number(),
  lastError: v.optional(v.string()),
  sentAt: v.optional(v.number()),
  createdAt: v.number(),
  processingStartedAt: v.optional(v.number()),
});

export const getDeliveryById = internalQuery({
  args: { deliveryId: v.id("notificationDeliveries") },
  returns: v.union(v.null(), deliveryRowValidator),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.deliveryId);
    if (!row) return null;
    const { _creationTime: _, ...delivery } = row;
    return delivery;
  },
});
