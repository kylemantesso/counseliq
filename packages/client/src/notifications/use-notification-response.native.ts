"use client";

import { useEffect } from "react";
import * as Notifications from "expo-notifications";
import { useRouter } from "solito/navigation";

function routeFromNotificationData(
  data: Record<string, unknown> | undefined
): string | null {
  if (!data) return null;
  const url = data.url;
  if (typeof url !== "string" || url.length === 0) return null;
  return url.startsWith("/") ? url : `/${url}`;
}

export function useNotificationResponse(): void {
  const router = useRouter();

  useEffect(() => {
    const navigateFromResponse = (
      response: Notifications.NotificationResponse | null
    ) => {
      if (!response) return;
      const path = routeFromNotificationData(
        response.notification.request.content.data as
          | Record<string, unknown>
          | undefined
      );
      if (path) {
        router.push(path);
      }
    };

    const last = Notifications.getLastNotificationResponse();
    navigateFromResponse(last);

    const subscription =
      Notifications.addNotificationResponseReceivedListener(navigateFromResponse);
    return () => subscription.remove();
  }, [router]);
}
