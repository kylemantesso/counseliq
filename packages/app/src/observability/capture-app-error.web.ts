import * as Sentry from "@sentry/nextjs";
import type { AppErrorContext } from "./app-error-context";
import { normalizeError } from "./normalize-error";

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
      surface: "web",
      runtime: "browser",
      ...tags,
    },
    extra: error !== normalized ? { rawError: error } : undefined,
  });
}
