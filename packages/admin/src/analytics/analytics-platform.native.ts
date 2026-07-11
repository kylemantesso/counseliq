import { Platform } from "react-native";
import type { AnalyticsPlatform } from "./analytics-config";

export function getAnalyticsPlatform(): AnalyticsPlatform {
  if (Platform.OS === "ios") {
    return "ios";
  }

  if (Platform.OS === "android") {
    return "android";
  }

  return "expo-web";
}
