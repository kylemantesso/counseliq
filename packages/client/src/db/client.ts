import { ConvexReactClient } from "convex/react";

/** Keep in sync with EXPECTED_AUTH_CONVEX_LOG in src/errors/get-user-facing-message.ts */
const EXPECTED_AUTH_CONVEX_LOG = /\[CONVEX [MA]\(auth:/;

type ConvexLogger = {
  logVerbose: (...args: unknown[]) => void;
  log: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

/**
 * Suppress console.error for expected auth failures — React Native LogBox
 * treats console.error as a dev overlay, but login/signup errors belong in UI.
 */
function createAppConvexLogger(): ConvexLogger {
  return {
    logVerbose: () => {},
    log: (...args: unknown[]) => console.log(...args),
    warn: (...args: unknown[]) => console.warn(...args),
    error: (...args: unknown[]) => {
      const message = typeof args[0] === "string" ? args[0] : "";
      if (EXPECTED_AUTH_CONVEX_LOG.test(message)) return;
      console.error(...args);
    },
  };
}

/**
 * Create a Convex React client for use with ConvexProvider.
 * Use the same deployment URL for web (NEXT_PUBLIC_CONVEX_URL) and mobile (EXPO_PUBLIC_CONVEX_URL).
 */
export function createConvexClient(deploymentUrl: string): ConvexReactClient {
  return new ConvexReactClient(deploymentUrl, {
    logger: createAppConvexLogger(),
  });
}
