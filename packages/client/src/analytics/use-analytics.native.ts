"use client";

import { useMemo } from "react";
import { usePostHog } from "posthog-react-native";
import type { AnalyticsProperties } from "./analytics-config";

function toPostHogProperties(properties?: AnalyticsProperties) {
  if (!properties) {
    return undefined;
  }

  return properties as Record<string, string | number | boolean | null>;
}

export function useAnalytics() {
  const posthog = usePostHog();

  return useMemo(
    () => ({
      isConfigured: Boolean(process.env.EXPO_PUBLIC_POSTHOG_PROJECT_TOKEN),
      capture: (event: string, properties?: AnalyticsProperties) => {
        posthog?.capture(event, toPostHogProperties(properties));
      },
      identify: (distinctId: string, properties?: AnalyticsProperties) => {
        posthog?.identify(distinctId, toPostHogProperties(properties));
      },
      register: (properties: AnalyticsProperties) => {
        posthog?.register(toPostHogProperties(properties) ?? {});
      },
      reset: () => {
        posthog?.reset();
      },
    }),
    [posthog]
  );
}
