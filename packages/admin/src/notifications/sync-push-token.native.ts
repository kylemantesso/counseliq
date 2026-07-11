import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { pushPlatform } from "./push-notifications";

export type SyncPushTokenResult =
  | { synced: true; token: string; platform: "ios" | "android" }
  | { synced: false; reason: "unsupported" | "simulator" | "permission" | "no_project_id" };

/**
 * Returns an Expo push token when the user already granted permission.
 * Does not prompt for permission.
 */
export async function syncPushTokenIfGranted(): Promise<SyncPushTokenResult> {
  if (Platform.OS !== "ios" && Platform.OS !== "android") {
    return { synced: false, reason: "unsupported" };
  }

  if (!Device.isDevice) {
    return { synced: false, reason: "simulator" };
  }

  const { status } = await Notifications.getPermissionsAsync();
  if (status !== Notifications.PermissionStatus.GRANTED) {
    return { synced: false, reason: "permission" };
  }

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId;

  if (!projectId || typeof projectId !== "string") {
    return { synced: false, reason: "no_project_id" };
  }

  const tokenResult = await Notifications.getExpoPushTokenAsync({ projectId });
  return {
    synced: true,
    token: tokenResult.data,
    platform: pushPlatform(),
  };
}
