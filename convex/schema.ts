import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const notificationTypeValidator = v.union(
  v.literal("admin_test"),
  v.literal("welcome")
);

export const notificationChannelValidator = v.union(
  v.literal("email"),
  v.literal("push")
);

export const notificationDeliveryStatusValidator = v.union(
  v.literal("pending"),
  v.literal("processing"),
  v.literal("sent"),
  v.literal("failed"),
  v.literal("skipped")
);

export default defineSchema({
  users: defineTable({
    tokenIdentifier: v.string(),
    name: v.string(),
    email: v.string(),
    createdAt: v.number(),
    isAdmin: v.optional(v.boolean()),
  })
    .index("by_token_identifier", ["tokenIdentifier"])
    .index("by_email", ["email"]),

  tasks: defineTable({
    userId: v.id("users"),
    title: v.string(),
    done: v.boolean(),
    createdAt: v.number(),
  }).index("by_user", ["userId"]),

  pushTokens: defineTable({
    userId: v.id("users"),
    token: v.string(),
    platform: v.union(v.literal("ios"), v.literal("android")),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_token", ["token"]),

  notificationPreferences: defineTable({
    userId: v.id("users"),
    emailEnabled: v.boolean(),
    pushEnabled: v.boolean(),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),

  notificationDeliveries: defineTable({
    userId: v.id("users"),
    type: notificationTypeValidator,
    channel: notificationChannelValidator,
    status: notificationDeliveryStatusValidator,
    idempotencyKey: v.string(),
    scheduledFor: v.number(),
    payload: v.any(),
    attempts: v.number(),
    lastError: v.optional(v.string()),
    processingStartedAt: v.optional(v.number()),
    sentAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_idempotency", ["idempotencyKey"])
    .index("by_status_scheduled", ["status", "scheduledFor"])
    .index("by_status_created", ["status", "createdAt"])
    .index("by_user", ["userId"]),

  appConfig: defineTable({
    minimumVersionIos: v.optional(v.string()),
    minimumVersionAndroid: v.optional(v.string()),
    updatedAt: v.number(),
  }),
});
