"use node";

import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { EmailTemplateId } from "./emailTemplateMeta";

const deliverResultValidator = v.object({
  outcome: v.union(
    v.literal("sent"),
    v.literal("skipped"),
    v.literal("failed")
  ),
  lastError: v.optional(v.string()),
});

type DeliveryPayload = {
  templateId?: EmailTemplateId;
  props?: unknown;
  title?: string;
  body?: string;
  pushTitle?: string;
  pushBody?: string;
  pushUrl?: string;
  data?: Record<string, string | number | boolean>;
};

export const deliver = internalAction({
  args: { deliveryId: v.id("notificationDeliveries") },
  returns: deliverResultValidator,
  handler: async (ctx, args) => {
    const row = await ctx.runQuery(internal.notificationQueries.getDeliveryById, {
      deliveryId: args.deliveryId,
    });
    if (!row) {
      return { outcome: "skipped" as const, lastError: "Delivery row not found" };
    }

    const isAdminTest = row.type === "admin_test";

    if (!isAdminTest) {
      const prefs = await ctx.runQuery(
        internal.notificationPreferences.getPreferencesForUser,
        { userId: row.userId }
      );

      if (row.channel === "email" && !prefs.emailEnabled) {
        return { outcome: "skipped" as const, lastError: "Email notifications disabled" };
      }
      if (row.channel === "push" && !prefs.pushEnabled) {
        return { outcome: "skipped" as const, lastError: "Push notifications disabled" };
      }
    }

    const payload = row.payload as DeliveryPayload;

    if (row.channel === "email") {
      const templateId = payload.templateId;
      if (!templateId) {
        return { outcome: "failed" as const, lastError: "Missing email template" };
      }

      const props = payload.props;
      if (!props) {
        return { outcome: "skipped" as const, lastError: "Could not build email props" };
      }

      const result = await ctx.runAction(internal.emailSend.sendToUser, {
        userId: row.userId,
        templateId,
        props,
      });

      if (result.attempted === 0) {
        return { outcome: "skipped" as const, lastError: "No email recipient" };
      }
      if (result.sent === 0) {
        return { outcome: "failed" as const, lastError: "Email send failed" };
      }
      return { outcome: "sent" as const };
    }

    const hasTokens = await ctx.runQuery(
      internal.pushNotifications.listTokensForUser,
      { userId: row.userId }
    );
    if (hasTokens.length === 0) {
      return { outcome: "skipped" as const, lastError: "No push tokens" };
    }

    const title = payload.pushTitle ?? payload.title;
    const body = payload.pushBody ?? payload.body;
    const url = payload.pushUrl ?? payload.data?.url;

    if (!title || !body) {
      return { outcome: "failed" as const, lastError: "Missing push copy" };
    }

    const result = await ctx.runAction(internal.pushNotificationSend.sendToUser, {
      userId: row.userId,
      title,
      body,
      data: url !== undefined ? { url: String(url) } : undefined,
    });

    if (result.attempted === 0) {
      return { outcome: "skipped" as const, lastError: "No valid push tokens" };
    }
    if (result.sent === 0) {
      return { outcome: "failed" as const, lastError: "Push send failed" };
    }
    return { outcome: "sent" as const };
  },
});
