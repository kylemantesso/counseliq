import type { AnalyticsProperties } from "./analytics-config";
import type { AnalyticsCategory, AnalyticsEventName } from "./events";
import { buildAnalyticsProperties } from "./events";

export function trackProductEvent(
  _event: AnalyticsEventName,
  _category: AnalyticsCategory,
  _properties?: AnalyticsProperties
): void {}
