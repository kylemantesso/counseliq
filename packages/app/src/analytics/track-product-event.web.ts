import posthog from "posthog-js";
import type { AnalyticsProperties } from "./analytics-config";
import type { AnalyticsCategory, AnalyticsEventName } from "./events";
import { buildAnalyticsProperties } from "./events";
import { isPostHogConfigured } from "./initialize-posthog.web";

export function trackProductEvent(
  event: AnalyticsEventName,
  category: AnalyticsCategory,
  properties?: AnalyticsProperties
): void {
  if (!isPostHogConfigured()) {
    return;
  }

  posthog.capture(event, buildAnalyticsProperties(category, properties));
}
