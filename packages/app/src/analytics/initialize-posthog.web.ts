import posthog from "posthog-js";
import { POSTHOG_HOST } from "./analytics-config";

export function isPostHogConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN);
}

export function initializePostHog(): void {
  const apiKey = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
  if (!apiKey || posthog.__loaded) {
    return;
  }

  posthog.init(apiKey, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? POSTHOG_HOST,
    person_profiles: "identified_only",
    capture_pageview: "history_change",
  });
}
