"use client";

import type { ReactNode } from "react";
import { AnalyticsNavigationSync } from "./analytics-navigation-sync";
import { PostHogAuthSync } from "./posthog-auth-sync";

export function PostHogRuntime({ children }: { children: ReactNode }) {
  return (
    <>
      <PostHogAuthSync />
      <AnalyticsNavigationSync />
      {children}
    </>
  );
}
