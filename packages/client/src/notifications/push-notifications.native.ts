import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";

export type PushPermissionStatus =
  | "undetermined"
  | "granted"
  | "denied"
  | "unsupported";

export type RequestPushNotificationsResult = {
  status: PushPermissionStatus;
  token: string | null;
};

function mapPermissionStatus(
  status: Notifications.PermissionStatus
): PushPermissionStatus {
  switch (status) {
    case Notifications.PermissionStatus.GRANTED:
      return "granted";
    case Notifications.PermissionStatus.DENIED:
      return "denied";
    default:
      return "undetermined";
  }
}

export async function getPushPermissionStatus(): Promise<PushPermissionStatus> {
  if (Platform.OS !== "ios" && Platform.OS !== "android") {
    return "unsupported";
  }
  const { status } = await Notifications.getPermissionsAsync();
  return mapPermissionStatus(status);
}

async function resolveExpoPushToken(): Promise<string | null> {
  if (!Device.isDevice) {
    return null;
  }

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId;

  if (!projectId || typeof projectId !== "string") {
    return null;
  }

  const tokenResult = await Notifications.getExpoPushTokenAsync({ projectId });
  return tokenResult.data;
}

/**
 * Request OS notification permission and return an Expo push token when granted.
 * Simulators return granted permission but no token.
 */
export async function requestPushNotifications(): Promise<RequestPushNotificationsResult> {
  if (Platform.OS !== "ios" && Platform.OS !== "android") {
    return { status: "unsupported", token: null };
  }

  const existing = await Notifications.getPermissionsAsync();
  let finalStatus = existing.status;

  if (existing.status !== Notifications.PermissionStatus.GRANTED) {
    const requested = await Notifications.requestPermissionsAsync();
    finalStatus = requested.status;
  }

  const status = mapPermissionStatus(finalStatus);
  if (status !== "granted") {
    return { status, token: null };
  }

  const token = await resolveExpoPushToken();
  return { status, token };
}

export function pushPlatform(): "ios" | "android" {
  return Platform.OS === "ios" ? "ios" : "android";
}
