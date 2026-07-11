"use client";

import { useOtaUpdates } from "../version/use-ota-updates";

/** Mount once in the native app shell to fetch and apply EAS OTAs on launch. */
export function OtaUpdateRuntime() {
  useOtaUpdates();
  return null;
}
