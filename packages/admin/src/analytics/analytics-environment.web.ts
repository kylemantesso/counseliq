import type { AnalyticsEnvironment } from "./analytics-config";

export function getAnalyticsEnvironment(): AnalyticsEnvironment {
  const vercelEnv =
    process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.VERCEL_ENV;

  if (vercelEnv === "preview") {
    return "preview";
  }

  if (process.env.NODE_ENV === "development") {
    return "development";
  }

  return "production";
}
