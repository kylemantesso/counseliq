"use client";

import { useMemo } from "react";
import type { AnalyticsProperties } from "./analytics-config";

export function useAnalytics() {
  return useMemo(
    () => ({
      isConfigured: false,
      capture: (_event: string, _properties?: AnalyticsProperties) => {},
      identify: (_distinctId: string, _properties?: AnalyticsProperties) => {},
      register: (_properties: AnalyticsProperties) => {},
      reset: () => {},
    }),
    []
  );
}
