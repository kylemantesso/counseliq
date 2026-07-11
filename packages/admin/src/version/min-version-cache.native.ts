import * as SecureStore from "expo-secure-store";
import type { RequiredVersions } from "./required-versions";

/**
 * Persists the last successfully-fetched minimum versions so a Convex/network
 * outage on a later boot can fall back to the last-known floor instead of
 * hanging on the version check. Best-effort: any failure is swallowed and the
 * gate fails open (see `useForceUpgradeState`).
 *
 * Web ships a no-op `.ts` variant — force-upgrade is native-only.
 */
const STORAGE_KEY = "rovr_min_app_versions";

export async function readCachedRequiredVersions(): Promise<RequiredVersions | null> {
  try {
    const raw = await SecureStore.getItemAsync(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RequiredVersions>;
    return {
      ios: typeof parsed.ios === "string" ? parsed.ios : null,
      android: typeof parsed.android === "string" ? parsed.android : null,
    };
  } catch {
    return null;
  }
}

export async function writeCachedRequiredVersions(
  value: RequiredVersions
): Promise<void> {
  try {
    await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // ignore — the fail-open cache is best-effort.
  }
}
