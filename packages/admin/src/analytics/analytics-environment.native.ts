import * as Updates from "expo-updates";
import type { AnalyticsEnvironment } from "./analytics-config";

export function getAnalyticsEnvironment(): AnalyticsEnvironment {
  if (__DEV__) {
    return "development";
  }

  const channel = Updates.channel;
  if (channel === "development" || channel === "develop") {
    return "preview";
  }

  return "production";
}
