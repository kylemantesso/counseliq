import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { Workpool, vOnCompleteArgs } from "@convex-dev/workpool";
import { components, internal } from "./_generated/api";
import {
  MAX_DELIVERY_ATTEMPTS,
  OUTBOX_BATCH_SIZE,
  OUTBOX_CLEANUP_BATCH_SIZE,
  OUTBOX_RETENTION_FAILED_MS,
  OUTBOX_RETENTION_SENT_SKIPPED_MS,
  PROCESSING_STALE_MS,
} from "./notificationConstants";
import {
  resolveNotificationPreferences,
  userHasEmail,
  userHasPushTokens,
} from "./notificationPreferences";
import { notificationTypeValidator } from "./schema";

export const notificationPool = new Workpool(components.notificationPool, {
  maxParallelism: 10,
  retryActionsByDefault: true,
  defaultRetryBehavior: {
    maxAttempts: 3,
    initialBackoffMs: 1000,
    base: 2,
  },
});

const deliverySpecValidator = v.object({
  userId: v.id("users"),
  type: notificationTypeValidator,
  channel: v.union(v.literal("email"), v.literal("push")),
  idempotencyKey: v.string(),
  scheduledFor: v.number(),
  payload: v.any(),
});

const deliverResultValidator = v.object({
  outcome: v.union(
    v.literal("sent"),
    v.literal("skipped"),
    v.literal("failed")
  ),
  lastError: v.optional(v.string()),
});

export const enqueueDeliveries = internalMutation({
  args: {
    deliveries: v.array(deliverySpecValidator),
  },
  returns: v.object({
    inserted: v.number(),
    skippedExisting: v.number(),
    skippedPrefs: v.number(),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();
    let inserted = 0;
    let skippedExisting = 0;
    let skippedPrefs = 0;

    for (const spec of args.deliveries) {
      const existing = await ctx.db
        .query("notificationDeliveries")
        .withIndex("by_idempotency", (q) =>
          q.eq("idempotencyKey", spec.idempotencyKey)
        )
        .first();
      if (existing) {
        skippedExisting += 1;
        continue;
      }

      const prefs = await resolveNotificationPreferences(ctx, spec.userId);
      const user = await ctx.db.get(spec.userId);
      if (!user) continue;

      let status: "pending" | "skipped" = "pending";
      let lastError: string | undefined;

      if (spec.channel === "email") {
        if (!prefs.emailEnabled) {
          status = "skipped";
          lastError = "Email notifications disabled";
          skippedPrefs += 1;
        } else if (!(await userHasEmail(ctx, user))) {
          status = "skipped";
          lastError = "No email address";
          skippedPrefs += 1;
        }
      } else if (spec.channel === "push") {
        if (!prefs.pushEnabled) {
          status = "skipped";
          lastError = "Push notifications disabled";
          skippedPrefs += 1;
        } else if (!(await userHasPushTokens(ctx, spec.userId))) {
          status = "skipped";
          lastError = "No push tokens registered";
          skippedPrefs += 1;
        }
      }

      await ctx.db.insert("notificationDeliveries", {
        userId: spec.userId,
        type: spec.type,
        channel: spec.channel,
        status,
        idempotencyKey: spec.idempotencyKey,
        scheduledFor: spec.scheduledFor,
        payload: spec.payload,
        attempts: 0,
        lastError,
        sentAt: status === "skipped" ? now : undefined,
        createdAt: now,
      });
      inserted += 1;
    }

    return { inserted, skippedExisting, skippedPrefs };
  },
});

export const reclaimStaleProcessing = internalMutation({
  args: {},
  returns: v.object({ reclaimed: v.number(), failed: v.number() }),
  handler: async (ctx) => {
    const cutoff = Date.now() - PROCESSING_STALE_MS;
    const stale = await ctx.db
      .query("notificationDeliveries")
      .withIndex("by_status_scheduled", (q) => q.eq("status", "processing"))
      .take(OUTBOX_BATCH_SIZE);

    let reclaimed = 0;
    let failed = 0;

    for (const row of stale) {
      if (!row.processingStartedAt || row.processingStartedAt >= cutoff) {
        continue;
      }

      if (row.attempts >= MAX_DELIVERY_ATTEMPTS) {
        await ctx.db.patch(row._id, {
          status: "failed",
          lastError: "Max delivery attempts exceeded",
          processingStartedAt: undefined,
        });
        failed += 1;
      } else {
        await ctx.db.patch(row._id, {
          status: "pending",
          processingStartedAt: undefined,
          attempts: row.attempts + 1,
        });
        reclaimed += 1;
      }
    }

    return { reclaimed, failed };
  },
});

export const processPendingBatch = internalMutation({
  args: {},
  returns: v.object({ enqueued: v.number(), hasMore: v.boolean() }),
  handler: async (ctx) => {
    await ctx.runMutation(internal.notificationOutbox.reclaimStaleProcessing, {});

    const now = Date.now();
    const due = await ctx.db
      .query("notificationDeliveries")
      .withIndex("by_status_scheduled", (q) =>
        q.eq("status", "pending").lte("scheduledFor", now)
      )
      .take(OUTBOX_BATCH_SIZE);

    let enqueued = 0;

    for (const row of due) {
      await ctx.db.patch(row._id, {
        status: "processing",
        processingStartedAt: now,
      });

      await notificationPool.enqueueAction(
        ctx,
        internal.notificationDeliver.deliver,
        { deliveryId: row._id },
        {
          onComplete: internal.notificationOutbox.onDeliverComplete,
          context: { deliveryId: row._id },
          retry: true,
        }
      );
      enqueued += 1;
    }

    if (due.length === OUTBOX_BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, internal.notificationOutbox.processPendingBatch, {});
    }

    return { enqueued, hasMore: due.length === OUTBOX_BATCH_SIZE };
  },
});

export const onDeliverComplete = internalMutation({
  args: vOnCompleteArgs(
    v.object({
      deliveryId: v.id("notificationDeliveries"),
    })
  ),
  returns: v.null(),
  handler: async (ctx, args) => {
    const deliveryId = args.context.deliveryId as Id<"notificationDeliveries">;
    const row = await ctx.db.get(deliveryId);
    if (!row) return null;

    const now = Date.now();

    if (args.result.kind === "success") {
      const value = args.result.returnValue as {
        outcome: "sent" | "skipped" | "failed";
        lastError?: string;
      };
      await ctx.db.patch(deliveryId, {
        status: value.outcome === "failed" ? "failed" : value.outcome,
        lastError: value.lastError,
        sentAt: value.outcome === "sent" ? now : row.sentAt,
        processingStartedAt: undefined,
      });
      return null;
    }

    if (args.result.kind === "failed") {
      await ctx.db.patch(deliveryId, {
        status: "failed",
        lastError: args.result.error,
        processingStartedAt: undefined,
      });
      return null;
    }

    await ctx.db.patch(deliveryId, {
      status: "pending",
      processingStartedAt: undefined,
    });
    return null;
  },
});

export const cleanupOldDeliveries = internalMutation({
  args: {},
  returns: v.object({ deleted: v.number(), hasMore: v.boolean() }),
  handler: async (ctx) => {
    const now = Date.now();
    const sentCutoff = now - OUTBOX_RETENTION_SENT_SKIPPED_MS;
    const failedCutoff = now - OUTBOX_RETENTION_FAILED_MS;
    let deleted = 0;

    for (const status of ["sent", "skipped"] as const) {
      const rows = await ctx.db
        .query("notificationDeliveries")
        .withIndex("by_status_created", (q) => q.eq("status", status))
        .take(OUTBOX_CLEANUP_BATCH_SIZE);

      for (const row of rows) {
        if (row.createdAt >= sentCutoff) continue;
        await ctx.db.delete(row._id);
        deleted += 1;
      }
    }

    const failedRows = await ctx.db
      .query("notificationDeliveries")
      .withIndex("by_status_created", (q) => q.eq("status", "failed"))
      .take(OUTBOX_CLEANUP_BATCH_SIZE);

    for (const row of failedRows) {
      if (row.createdAt >= failedCutoff) continue;
      await ctx.db.delete(row._id);
      deleted += 1;
    }

    const hasMore = deleted >= OUTBOX_CLEANUP_BATCH_SIZE;
    if (hasMore) {
      await ctx.scheduler.runAfter(
        0,
        internal.notificationOutbox.cleanupOldDeliveries,
        {}
      );
    }

    return { deleted, hasMore };
  },
});
