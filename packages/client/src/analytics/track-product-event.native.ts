import type { AnalyticsProperties } from "./analytics-config";
import type { AnalyticsCategory, AnalyticsEventName } from "./events";
import { buildAnalyticsProperties } from "./events";
import { getPostHogClient } from "./posthog-client-ref.native";

function toPostHogProperties(properties: AnalyticsProperties) {
  return properties as Record<string, string | number | boolean | null>;
}

export function trackProductEvent(
  event: AnalyticsEventName,
  category: AnalyticsCategory,
  properties?: AnalyticsProperties
): void {
  const client = getPostHogClient();
  if (!client) {
    return;
  }

  client.capture(
    event,
    toPostHogProperties(buildAnalyticsProperties(category, properties))
  );
}
