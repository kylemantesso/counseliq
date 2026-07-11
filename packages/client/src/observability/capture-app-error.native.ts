import { Platform } from "react-native";
import * as Sentry from "@sentry/react-native";
import type { AppErrorContext } from "./app-error-context";
import { normalizeError } from "./normalize-error";

const mobileSurface =
  Platform.OS === "ios"
    ? "ios"
    : Platform.OS === "android"
      ? "android"
      : "expo-web";

export function captureAppError(
  error: unknown,
  context?: AppErrorContext
): void {
  const normalized = normalizeError(error);
  const tags = context
    ? Object.fromEntries(
        Object.entries(context).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string"
        )
      )
    : undefined;

  Sentry.captureException(normalized, {
    tags: {
      surface: mobileSurface,
      runtime: Platform.OS === "web" ? "expo-web" : "react-native",
      ...tags,
    },
    extra: error !== normalized ? { rawError: error } : undefined,
  });
}
