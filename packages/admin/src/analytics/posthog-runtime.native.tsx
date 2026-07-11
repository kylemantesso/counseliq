"use client";

import type { ReactNode } from "react";
import { PostHogProvider } from "posthog-react-native";
import { POSTHOG_HOST } from "./analytics-config";
import { AnalyticsNavigationSync } from "./analytics-navigation-sync";
import { PostHogAuthSync } from "./posthog-auth-sync";
import { PostHogClientBinder } from "./posthog-client-binder";

const posthogApiKey = process.env.EXPO_PUBLIC_POSTHOG_PROJECT_TOKEN;

export function PostHogRuntime({ children }: { children: ReactNode }) {
  if (!posthogApiKey) {
    return <>{children}</>;
  }

  return (
    <PostHogProvider
      apiKey={posthogApiKey}
      options={{
        host: process.env.EXPO_PUBLIC_POSTHOG_HOST ?? POSTHOG_HOST,
        personProfiles: "identified_only",
      }}
      autocapture={false}
    >
      <PostHogClientBinder />
      <PostHogAuthSync />
      <AnalyticsNavigationSync />
      {children}
    </PostHogProvider>
  );
}
