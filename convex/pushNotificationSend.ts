"use node";

import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { Expo, type ExpoPushMessage } from "expo-server-sdk";

const pushDataValidator = v.optional(
  v.record(v.string(), v.union(v.string(), v.number(), v.boolean()))
);

const sendResultValidator = v.object({
  attempted: v.number(),
  sent: v.number(),
  failed: v.number(),
});

/**
 * Send a push notification to every registered device for a user via the Expo
 * Push API. Call from other internal actions/mutations when product events
 * should notify someone (fixture changes, availability nudges, etc.).
 */
export const sendToUser = internalAction({
  args: {
    userId: v.id("users"),
    title: v.string(),
    body: v.string(),
    data: pushDataValidator,
  },
  returns: sendResultValidator,
  handler: async (ctx, args) => {
    const tokenRows = await ctx.runQuery(
      internal.pushNotifications.listTokensForUser,
      { userId: args.userId }
    );

    if (tokenRows.length === 0) {
      return { attempted: 0, sent: 0, failed: 0 };
    }

    const expo = new Expo();
    const messages: ExpoPushMessage[] = [];

    for (const row of tokenRows) {
      if (!Expo.isExpoPushToken(row.token)) {
        continue;
      }

      messages.push({
        to: row.token,
        sound: "default",
        title: args.title,
        body: args.body,
        data: args.data,
        channelId: row.platform === "android" ? "default" : undefined,
      });
    }

    if (messages.length === 0) {
      return { attempted: 0, sent: 0, failed: 0 };
    }

    const chunks = expo.chunkPushNotifications(messages);
    let sent = 0;
    let failed = 0;

    for (const chunk of chunks) {
      const tickets = await expo.sendPushNotificationsAsync(chunk);
      for (const ticket of tickets) {
        if (ticket.status === "ok") {
          sent += 1;
        } else {
          failed += 1;
        }
      }
    }

    return { attempted: messages.length, sent, failed };
  },
});
