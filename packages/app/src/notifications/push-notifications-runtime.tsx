"use client";

import { useNotificationResponse } from "./use-notification-response";
import { useSyncPushToken } from "./use-sync-push-token";

/** Mount once in the native app shell to keep push tokens and tap routing in sync. */
export function PushNotificationsRuntime() {
  useSyncPushToken();
  useNotificationResponse();
  return null;
}
