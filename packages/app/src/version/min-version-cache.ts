import type { RequiredVersions } from "./required-versions";

/**
 * Web no-op cache. Force-upgrade is native-only (no store to send users to and
 * the deployed bundle is always current), so the web build never reads or
 * writes a cached floor. Native ships `.native.ts` backed by expo-secure-store.
 */
export async function readCachedRequiredVersions(): Promise<RequiredVersions | null> {
  return null;
}

export async function writeCachedRequiredVersions(
  _value: RequiredVersions
): Promise<void> {
  // no-op
}
