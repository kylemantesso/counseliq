import { APP_VERSION_NUMBER } from "./app-version";
import type { UpdateInfo } from "./update-info.types";

export type { UpdateInfo };

/** Web has no OTA bundle — only the deployed app version is shown. */
export function getUpdateInfo(): UpdateInfo {
  return {
    appVersion: APP_VERSION_NUMBER,
    buildNumber: null,
    channel: null,
    runtimeVersion: null,
    otaLabel: null,
  };
}
