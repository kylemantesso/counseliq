import Constants from "expo-constants";
import * as Updates from "expo-updates";
import { APP_VERSION_NUMBER } from "./app-version";
import type { UpdateInfo } from "./update-info.types";

export type { UpdateInfo };

function formatOtaLabel(): string {
  if (!Updates.isEnabled) {
    return "Disabled";
  }

  if (Updates.isEmbeddedLaunch) {
    return "Bundled";
  }

  const parts: string[] = [];

  if (Updates.updateId) {
    parts.push(Updates.updateId.slice(0, 8));
  }

  if (Updates.createdAt) {
    parts.push(
      Updates.createdAt.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    );
  }

  return parts.length > 0 ? parts.join(" · ") : "Applied";
}

export function getUpdateInfo(): UpdateInfo {
  return {
    appVersion: APP_VERSION_NUMBER,
    buildNumber: Constants.nativeBuildVersion ?? null,
    channel: Updates.channel ?? null,
    runtimeVersion: Updates.runtimeVersion ?? null,
    otaLabel: formatOtaLabel(),
  };
}
