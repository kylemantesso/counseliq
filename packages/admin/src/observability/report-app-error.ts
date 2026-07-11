import type { AppErrorContext } from "./app-error-context";
import { captureAppError } from "./capture-app-error";
import { shouldReportError } from "./should-report-error";

export type { AppErrorContext };

/** Report unexpected errors to Sentry; skips expected app/Clerk/user-cancel errors. */
export function reportAppError(
  error: unknown,
  context?: AppErrorContext
): void {
  if (!shouldReportError(error)) return;
  captureAppError(error, context);
}
