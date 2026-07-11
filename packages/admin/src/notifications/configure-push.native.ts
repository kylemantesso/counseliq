import { Platform } from "react-native";
import * as Notifications from "expo-notifications";

const ANDROID_CHANNEL_ID = "default";

/** One-time native setup (Android notification channel). Safe to call repeatedly. */
export async function configurePushNotifications(): Promise<void> {
  if (Platform.OS !== "android") {
    return;
  }

  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: "Match updates",
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: "#BFFF00",
  });
}
