export type PushPermissionStatus =
  | "undetermined"
  | "granted"
  | "denied"
  | "unsupported";

export type RequestPushNotificationsResult = {
  status: PushPermissionStatus;
  token: string | null;
};

export async function getPushPermissionStatus(): Promise<PushPermissionStatus> {
  return "unsupported";
}

export async function requestPushNotifications(): Promise<RequestPushNotificationsResult> {
  return { status: "unsupported", token: null };
}

export function pushPlatform(): "ios" | "android" {
  return "ios";
}
