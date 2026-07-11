"use client";

import { useMemo } from "react";
import posthog from "posthog-js";
import type { AnalyticsProperties } from "./analytics-config";
import { isPostHogConfigured } from "./initialize-posthog.web";

export function useAnalytics() {
  return useMemo(
    () => ({
      isConfigured: isPostHogConfigured(),
      capture: (event: string, properties?: AnalyticsProperties) => {
        posthog.capture(event, properties);
      },
      identify: (distinctId: string, properties?: AnalyticsProperties) => {
        posthog.identify(distinctId, properties);
      },
      register: (properties: AnalyticsProperties) => {
        posthog.register(properties);
      },
      reset: () => {
        posthog.reset();
      },
    }),
    []
  );
}
