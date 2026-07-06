import { Linking, Platform } from "react-native";

/**
 * App Store listing for ROVR. The numeric id is the App Store Connect
 * `ascAppId` (see `apps/mobile/eas.json`). The https form opens the native
 * App Store app on device and the web listing elsewhere.
 */
export const IOS_APP_STORE_URL = "https://apps.apple.com/app/id6773954200";

/**
 * Play Store listing for ROVR, keyed by the Android package name
 * (`apps/mobile/app.json` → `expo.android.package`).
 */
export const ANDROID_PLAY_STORE_URL =
  "https://play.google.com/store/apps/details?id=com.rovr.mobile";

/** Store URL for the current platform, or null on web / unknown platforms. */
export function getStoreUrl(): string | null {
  if (Platform.OS === "ios") return IOS_APP_STORE_URL;
  if (Platform.OS === "android") return ANDROID_PLAY_STORE_URL;
  return null;
}

/** Open the current platform's store listing. No-op when there is no URL. */
export function openStoreListing(): void {
  const url = getStoreUrl();
  if (!url) return;
  void Linking.openURL(url);
}
