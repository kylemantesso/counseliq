"use client";

import { useEffect, useRef } from "react";
import { useAuth } from "../auth";
import { AnalyticsEvent } from "./events";
import { getAnalyticsEnvironment } from "./analytics-environment";
import { getAnalyticsPlatform } from "./analytics-platform";
import { trackProductEvent } from "./track-product-event";
import { useAnalytics } from "./use-analytics";

export function PostHogAuthSync() {
  const { user, loading } = useAuth();
  const analytics = useAnalytics();
  const previousUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!analytics.isConfigured) {
      return;
    }

    analytics.register({
      platform: getAnalyticsPlatform(),
      environment: getAnalyticsEnvironment(),
    });
  }, [analytics]);

  useEffect(() => {
    if (!analytics.isConfigured || loading) {
      return;
    }

    const nextUserId = user?.userId ?? null;

    if (nextUserId && user) {
      analytics.identify(nextUserId, {
        email: user.email,
        name: user.name,
        platform: getAnalyticsPlatform(),
        environment: getAnalyticsEnvironment(),
      });
    } else if (previousUserIdRef.current) {
      trackProductEvent(AnalyticsEvent.AUTH_SIGN_OUT, "auth");
      analytics.reset();
    }

    previousUserIdRef.current = nextUserId;
  }, [analytics, loading, user]);

  return null;
}
