"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "solito/navigation";
import { AnalyticsEvent } from "./events";
import { getAnalyticsPlatform } from "./analytics-platform";
import { trackProductEvent } from "./track-product-event";

export function AnalyticsNavigationSync() {
  const pathname = usePathname();
  const previousPathRef = useRef<string | null>(null);

  useEffect(() => {
    if (getAnalyticsPlatform() === "web") {
      return;
    }

    if (!pathname || pathname === previousPathRef.current) {
      return;
    }

    previousPathRef.current = pathname;
    trackProductEvent(AnalyticsEvent.SCREEN_VIEWED, "navigation", {
      screen: pathname,
    });
  }, [pathname]);

  return null;
}
