"use client";

import { useEffect } from "react";
import { usePostHog } from "posthog-react-native";
import { bindPostHogClient } from "./posthog-client-ref.native";

export function PostHogClientBinder() {
  const posthog = usePostHog();

  useEffect(() => {
    bindPostHogClient(posthog);
    return () => bindPostHogClient(null);
  }, [posthog]);

  return null;
}
