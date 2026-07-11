export const POSTHOG_HOST = "https://us.i.posthog.com";

export type AnalyticsEnvironment = "development" | "preview" | "production";

export type AnalyticsPlatform = "web" | "ios" | "android" | "expo-web";

export type AnalyticsProperties = Record<
  string,
  string | number | boolean | null | undefined
>;
