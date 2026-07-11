import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { Platform } from "react-native";
import { api } from "../db/api";
import { APP_VERSION_NUMBER } from "./app-version";
import { isVersionBelow } from "./compare-versions";
import type { RequiredVersions } from "./required-versions";
import {
  readCachedRequiredVersions,
  writeCachedRequiredVersions,
} from "./min-version-cache";

export type ForceUpgradeState =
  /** Cached floor still being read from disk (near-instant, never a network wait). */
  | "loading"
  /** Either no minimum is enforced or the running build satisfies it. */
  | "ok"
  /** Running build is below the platform minimum — block with the upgrade screen. */
  | "required";

function decide(required: RequiredVersions | null): "ok" | "required" {
  if (!required) return "ok";
  const minimum = Platform.OS === "ios" ? required.ios : required.android;
  if (!minimum) return "ok";
  return isVersionBelow(APP_VERSION_NUMBER, minimum) ? "required" : "ok";
}

/**
 * Decides whether the running native build is too old to keep using.
 *
 * Reads the per-platform minimum version from Convex (public query, no auth)
 * and compares it against the build's own version. To avoid a Convex/network
 * outage stranding users on the splash, it falls back to the last value it
 * successfully persisted:
 *
 * - Live query resolved → decide from it (freshest) and write it through to the cache.
 * - Live still pending → use the cached floor; if nothing is cached, fail open.
 *
 * The only "loading" state is the (local, sub-frame) disk read — never a
 * network wait — so the gate never hangs because the backend is unreachable.
 *
 * Force-upgrade is native-only: on web there is no store and the deployed
 * bundle is always current, so this always returns "ok".
 */
export function useForceUpgradeState(): ForceUpgradeState {
  const live = useQuery(api.appConfig.getRequiredVersions, {});

  // `undefined` = disk read in flight; `null` = read finished, nothing cached.
  const [cached, setCached] = useState<RequiredVersions | null | undefined>(
    undefined
  );

  useEffect(() => {
    let active = true;
    void readCachedRequiredVersions().then((value) => {
      if (active) setCached(value);
    });
    return () => {
      active = false;
    };
  }, []);

  // Write every successful fetch through to disk for future cold starts.
  // Depend on the primitive fields so this only runs when the floor changes.
  useEffect(() => {
    if (live === undefined) return;
    void writeCachedRequiredVersions(live);
  }, [live?.ios, live?.android]);

  if (Platform.OS !== "ios" && Platform.OS !== "android") {
    return "ok";
  }

  if (live !== undefined) {
    return decide(live);
  }

  if (cached === undefined) {
    return "loading";
  }

  return decide(cached);
}
