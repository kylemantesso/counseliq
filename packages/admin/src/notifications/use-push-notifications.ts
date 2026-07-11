"use client";

import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../db/api";
import { handleCaughtError } from "../observability/handle-caught-error";
import { AnalyticsEvent } from "../analytics/events";
import { trackProductEvent } from "../analytics/track-product-event";
import {
  getPushPermissionStatus,
  pushPlatform,
  requestPushNotifications,
  type PushPermissionStatus,
} from "./push-notifications";

type EnablePushOptions = {
  source?: "profile" | "onboarding";
};

type EnablePushResult =
  | { ok: true; registered: boolean }
  | { ok: false; error: string; status: PushPermissionStatus };

export function usePushNotifications() {
  const registration = useQuery(api.pushNotifications.getRegistrationStatus);
  const registerToken = useMutation(api.pushNotifications.registerToken);
  const [permissionStatus, setPermissionStatus] =
    useState<PushPermissionStatus>("undetermined");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void getPushPermissionStatus().then(setPermissionStatus);
  }, []);

  const registered = registration?.registered ?? false;
  const enabled =
    registered ||
    permissionStatus === "granted";

  const refreshPermission = useCallback(async () => {
    const status = await getPushPermissionStatus();
    setPermissionStatus(status);
    return status;
  }, []);

  const enable = useCallback(async (options?: EnablePushOptions): Promise<EnablePushResult> => {
    setLoading(true);
    try {
      const result = await requestPushNotifications();
      setPermissionStatus(result.status);

      if (result.status === "denied") {
        return { ok: false, error: "Notifications are turned off.", status: result.status };
      }

      if (result.status !== "granted") {
        return {
          ok: false,
          error: "Notifications aren't available on this device.",
          status: result.status,
        };
      }

      if (!result.token) {
        trackProductEvent(AnalyticsEvent.NOTIFICATION_PUSH_ENABLED, "notification", {
          source: options?.source ?? "profile",
          registered: false,
        });
        return { ok: true, registered: false };
      }

      await registerToken({ token: result.token, platform: pushPlatform() });
      trackProductEvent(AnalyticsEvent.NOTIFICATION_PUSH_ENABLED, "notification", {
        source: options?.source ?? "profile",
        registered: true,
      });
      return { ok: true, registered: true };
    } catch (error: unknown) {
      return {
        ok: false,
        error: handleCaughtError(error, {
          fallback: "Could not turn on notifications. Please try again.",
          context: { feature: "push-notifications", action: "enable" },
        }),
        status: permissionStatus,
      };
    } finally {
      setLoading(false);
    }
  }, [permissionStatus, registerToken]);

  return {
    enabled,
    registered,
    permissionStatus,
    loading,
    enable,
    refreshPermission,
    checking: registration === undefined,
  };
}
