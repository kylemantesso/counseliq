import { useEffect } from "react";
import * as Updates from "expo-updates";

/**
 * On native release builds, check for a newer OTA on launch and apply it
 * immediately. Expo's default is download-then-apply-on-next-launch; this
 * makes TestFlight / store builds pick up JS updates in a single cold start.
 */
export function useOtaUpdates() {
  useEffect(() => {
    if (!Updates.isEnabled || __DEV__) return;

    let cancelled = false;

    void (async () => {
      try {
        const check = await Updates.checkForUpdateAsync();
        if (cancelled || !check.isAvailable) return;

        await Updates.fetchUpdateAsync();
        if (cancelled) return;

        await Updates.reloadAsync();
      } catch {
        // Network or server errors should never block app launch.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);
}
