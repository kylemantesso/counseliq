"use client";

import { useCallback, useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { useConvexAuth } from "convex/react";
import { useMutation } from "convex/react";
import { api } from "../db/api";
import { configurePushNotifications } from "./configure-push";
import { syncPushTokenIfGranted } from "./sync-push-token";

/**
 * Silently registers the Expo push token when the user is signed in and has
 * already granted notification permission. Re-syncs when the app returns to
 * the foreground in case the token rotated.
 */
export function useSyncPushToken(): void {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const registerToken = useMutation(api.pushNotifications.registerToken);
  const syncingRef = useRef(false);

  const sync = useCallback(async () => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    try {
      const result = await syncPushTokenIfGranted();
      if (!result.synced) return;
      await registerToken({ token: result.token, platform: result.platform });
    } catch {
      // Best-effort background sync — user can retry from Profile.
    } finally {
      syncingRef.current = false;
    }
  }, [registerToken]);

  useEffect(() => {
    void configurePushNotifications();
  }, []);

  useEffect(() => {
    if (isLoading || !isAuthenticated) return;
    void sync();
  }, [isAuthenticated, isLoading, sync]);

  useEffect(() => {
    const onAppStateChange = (next: AppStateStatus) => {
      if (next !== "active" || isLoading || !isAuthenticated) return;
      void sync();
    };

    const subscription = AppState.addEventListener("change", onAppStateChange);
    return () => subscription.remove();
  }, [isAuthenticated, isLoading, sync]);
}
